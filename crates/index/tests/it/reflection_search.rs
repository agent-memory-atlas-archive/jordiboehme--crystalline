//! Reflection chunks on the engram embedding pipeline, and the wall between
//! them and every engram reader.

use std::path::Path;
use std::sync::Mutex;

use async_trait::async_trait;
use crystalline_index::{
    ChunkTable, EmbeddingProvider, Result, SearchMode, SearchQuery, Store, TursoStore,
    run_embedding_pass, run_embedding_pass_with_page, sync_domain,
};

// --- harness, copied from `lead_vectors` -------------------------------------

#[cfg(feature = "postgres")]
fn pg_url() -> Option<String> {
    use std::sync::Once;
    static NOTE: Once = Once::new();
    match std::env::var("CRYSTALLINE_TEST_POSTGRES_URL") {
        Ok(u) if !u.is_empty() => Some(u),
        _ => {
            NOTE.call_once(|| {
                eprintln!(
                    "note: skipping the postgres parity leg (CRYSTALLINE_TEST_POSTGRES_URL is unset); turso only"
                )
            });
            None
        }
    }
}

/// A distinct schema name per test invocation, salted so a recycled pid never
/// adopts a schema a panicking run left behind.
#[cfg(feature = "postgres")]
fn unique_schema() -> String {
    use std::hash::{BuildHasher, RandomState};
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!(
        "rs_{}_{}_{:x}",
        std::process::id(),
        n,
        RandomState::new().hash_one(n)
    )
}

/// Run a parity body against Turso (always) and Postgres (when configured),
/// giving each backend a fresh, isolated store.
macro_rules! parity {
    ($name:ident, $body:path) => {
        #[tokio::test]
        async fn $name() {
            {
                let store = TursoStore::open_in_memory().await.unwrap();
                $body(&store).await;
            }
            #[cfg(feature = "postgres")]
            {
                if let Some(url) = pg_url() {
                    let schema = unique_schema();
                    let store = crystalline_index::PostgresStore::open_in_schema(&url, &schema)
                        .await
                        .expect("open the postgres test schema");
                    $body(&store).await;
                    store
                        .drop_schema()
                        .await
                        .expect("drop the postgres test schema");
                }
            }
        }
    };
}

// --- providers, copied from `embed` ------------------------------------------

/// A deterministic, network-free provider: each word hashes into one of eight
/// buckets, then the vector is L2-normalized.
struct FakeProvider {
    model: String,
}

impl FakeProvider {
    fn new(model: &str) -> FakeProvider {
        FakeProvider {
            model: model.to_string(),
        }
    }
}

fn embed_one(text: &str) -> Vec<f32> {
    let mut v = [0f32; 8];
    for tok in text
        .split(|c: char| !c.is_alphanumeric())
        .filter(|s| !s.is_empty())
    {
        let mut h: u64 = 0;
        for byte in tok.to_lowercase().bytes() {
            h = h.wrapping_mul(31).wrapping_add(byte as u64);
        }
        v[(h % 8) as usize] += 1.0;
    }
    let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm == 0.0 {
        let mut z = [0f32; 8];
        z[0] = 1.0;
        return z.to_vec();
    }
    v.iter().map(|x| x / norm).collect()
}

#[async_trait]
impl EmbeddingProvider for FakeProvider {
    async fn embed(&self, texts: &[String]) -> Result<Vec<Vec<f32>>> {
        Ok(texts.iter().map(|t| embed_one(t)).collect())
    }
    fn model_id(&self) -> &str {
        &self.model
    }
    fn dims(&self) -> usize {
        8
    }
    fn max_input_tokens(&self) -> usize {
        512
    }
}

/// A [`FakeProvider`] that also records every text it was handed.
struct RecordingProvider {
    model: String,
    calls: Mutex<Vec<Vec<String>>>,
}

impl RecordingProvider {
    fn new(model: &str) -> RecordingProvider {
        RecordingProvider {
            model: model.to_string(),
            calls: Mutex::new(Vec::new()),
        }
    }

    /// Every text embedded so far, in call order.
    fn seen(&self) -> Vec<String> {
        self.calls.lock().unwrap().concat()
    }
}

#[async_trait]
impl EmbeddingProvider for RecordingProvider {
    async fn embed(&self, texts: &[String]) -> Result<Vec<Vec<f32>>> {
        self.calls.lock().unwrap().push(texts.to_vec());
        Ok(texts.iter().map(|t| embed_one(t)).collect())
    }
    fn model_id(&self) -> &str {
        &self.model
    }
    fn dims(&self) -> usize {
        8
    }
    fn max_input_tokens(&self) -> usize {
        512
    }
}

// --- files, copied from `store` ----------------------------------------------

fn write(dir: &Path, rel: &str, content: &str) {
    let path = dir.join(rel);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
    std::fs::write(path, content).unwrap();
}

/// A minimal engram markdown block.
fn engram(title: &str, permalink: &str, ftype: &str, extra_fm: &str, body: &str) -> String {
    format!(
        "---\ntype: {ftype}\ntitle: {title}\npermalink: {permalink}\ntags:\n  - t\nstatus: current\nrecorded_at: 2026-01-01\n{extra_fm}---\n\n# {title}\n\n{body}\n"
    )
}

const MANIFEST_OFF: &str = "---\ntype: manifest\ntitle: eng\npermalink: manifest\ntags: [manifest]\nstatus: stable\n---\n\n## Scope\n\n- s\n\n## When to Use\n\n- w\n";

fn manifest_on() -> String {
    MANIFEST_OFF.replace("status: stable\n", "status: stable\nreflection: on\n")
}

// --- tests -------------------------------------------------------------------

async fn a_reflection_chunk_never_reaches_engram_search(store: &dyn Store) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(root, "MANIFEST.md", &manifest_on());
    write(
        root,
        "notes/n.md",
        &engram(
            "N",
            "notes/n",
            "engram",
            "",
            "an ordinary engram about tea\n",
        ),
    );
    write(
        root,
        "reflections/a.md",
        "# Zebra\n\n## Stripes\n<!-- r:aaaa1111 -->\n\nzebraonlyterm stripes and more zebraonlyterm\n",
    );
    sync_domain(store, "eng", root).await.unwrap();
    let provider = FakeProvider::new("fake");
    run_embedding_pass(store, &provider, |_, _| {})
        .await
        .unwrap();
    assert!(
        store
            .embedding_coverage_of(ChunkTable::Reflection)
            .await
            .unwrap()
            .embedded_for("fake")
            > 0
    );
    for mode in [SearchMode::Text, SearchMode::Semantic, SearchMode::Hybrid] {
        let mut q = SearchQuery::text("zebraonlyterm stripes");
        q.mode = mode;
        q.min_similarity = Some(0.0);
        q.query_embedding = Some(embed_one("zebraonlyterm stripes"));
        q.active_model = Some("fake".into());
        let page = store.search(&q).await.unwrap();
        assert!(
            page.items
                .iter()
                .all(|h| h.permalink == "notes/n" || h.permalink == "manifest"),
            "{mode:?}: {:?}",
            page.items
        );
    }
    let did = store.domain_id("eng").await.unwrap().unwrap();
    let leads = store.lead_vectors(did, "fake", None).await.unwrap();
    assert_eq!(
        leads.len(),
        store
            .embedding_coverage()
            .await
            .unwrap()
            .embedded_for("fake"),
        "one lead vector per engram chunk embedded, none for the page: {leads:?}"
    );
}
parity!(
    a_reflection_chunk_never_reaches_engram_search_on_both_backends,
    a_reflection_chunk_never_reaches_engram_search
);

async fn the_embed_pass_reaches_reflection_chunks_after_engram_chunks(store: &dyn Store) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(root, "MANIFEST.md", &manifest_on());
    for i in 0..3 {
        write(
            root,
            &format!("notes/n{i}.md"),
            &engram(
                &format!("N{i}"),
                &format!("notes/n{i}"),
                "engram",
                "",
                "engram body\n",
            ),
        );
        write(
            root,
            &format!("reflections/p{i}.md"),
            &format!("# Pagemark P{i}\n\n## S\n<!-- r:aaaa111{i} -->\n\npage body {i}\n"),
        );
    }
    sync_domain(store, "eng", root).await.unwrap();
    let provider = RecordingProvider::new("fake");
    // A page size of 2 forces several pages per table, so a shared cursor
    // would skip rows of the second table.
    run_embedding_pass_with_page(store, &provider, 2, |_, _| {})
        .await
        .unwrap();
    let seen = provider.seen();
    // Every reflection chunk leads with its page title, so each carries the
    // mark; no engram chunk does.
    let first_page = seen.iter().position(|t| t.contains("Pagemark")).unwrap();
    assert!(
        seen[first_page..].iter().all(|t| t.contains("Pagemark")),
        "engram chunks first: {seen:?}"
    );
    assert_eq!(
        seen[first_page..].len(),
        6,
        "two chunks per page, each embedded once: {seen:?}"
    );
    for table in ChunkTable::ALL {
        let cov = store.embedding_coverage_of(*table).await.unwrap();
        assert_eq!(
            cov.embedded_for("fake"),
            cov.total_chunks,
            "{table:?}: {cov:?}"
        );
    }
}
parity!(
    the_embed_pass_reaches_reflection_chunks_after_engram_chunks_on_both_backends,
    the_embed_pass_reaches_reflection_chunks_after_engram_chunks
);

/// Postgres only: the reflection column takes the provider's width the way
/// the engram column does (the fake is 8 wide, the table starts at 384). The
/// engram note is embedded first, so the engram column is resized before the
/// reflection one: a width kept for one table would skip the second's resize.
async fn reflection_vectors_take_the_providers_width(store: &dyn Store) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(root, "MANIFEST.md", &manifest_on());
    write(
        root,
        "notes/n.md",
        &engram("N", "notes/n", "engram", "", "engram body\n"),
    );
    write(
        root,
        "reflections/a.md",
        "# A\n\n## S\n<!-- r:aaaa1111 -->\n\nwidth test\n",
    );
    sync_domain(store, "eng", root).await.unwrap();
    run_embedding_pass(store, &FakeProvider::new("fake"), |_, _| {})
        .await
        .unwrap();
    for table in ChunkTable::ALL {
        let cov = store.embedding_coverage_of(*table).await.unwrap();
        assert_eq!(
            cov.models.first().map(|m| m.dims),
            Some(8),
            "{table:?}: {cov:?}"
        );
        assert_eq!(
            cov.embedded_for("fake"),
            cov.total_chunks,
            "{table:?}: {cov:?}"
        );
    }
}
parity!(
    reflection_vectors_take_the_providers_width_on_postgres,
    reflection_vectors_take_the_providers_width
);

/// Each table keeps its own coverage snapshot: a warm read of one never
/// answers for the other, and a write to one shows in its own next read.
async fn each_table_keeps_its_own_coverage(store: &dyn Store) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(root, "MANIFEST.md", &manifest_on());
    write(
        root,
        "notes/n.md",
        &engram("N", "notes/n", "engram", "", "engram body\n"),
    );
    write(
        root,
        "reflections/a.md",
        "# A\n\n## S\n<!-- r:aaaa1111 -->\n\nsection one\n\n## T\n<!-- r:bbbb2222 -->\n\nsection two\n",
    );
    sync_domain(store, "eng", root).await.unwrap();
    // Warm both snapshots, engram first, then reflection first.
    let engram = store.embedding_coverage().await.unwrap();
    let reflection = store
        .embedding_coverage_of(ChunkTable::Reflection)
        .await
        .unwrap();
    assert_eq!(reflection.total_chunks, 3, "{reflection:?}");
    assert_ne!(
        engram.total_chunks, reflection.total_chunks,
        "the fixture tells the two tables apart"
    );
    assert_eq!(store.embedding_coverage().await.unwrap(), engram);
    assert_eq!(
        store
            .embedding_coverage_of(ChunkTable::Reflection)
            .await
            .unwrap(),
        reflection
    );
}
parity!(
    each_table_keeps_its_own_coverage_on_both_backends,
    each_table_keeps_its_own_coverage
);
