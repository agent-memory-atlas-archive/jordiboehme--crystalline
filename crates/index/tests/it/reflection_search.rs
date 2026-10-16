//! Reflection chunks on the engram embedding pipeline, and the wall between
//! them and every engram reader.

use std::path::Path;
use std::sync::Mutex;

use async_trait::async_trait;
use crystalline_index::{
    ChunkTable, EmbeddingProvider, EmbeddingRow, IndexError, Result, SearchMode, SearchQuery,
    Store, TursoStore, run_embedding_pass, run_embedding_pass_with_page, sync_domain,
};

// --- harness, copied from `lead_vectors` -------------------------------------

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
                if let Some(scratch) = crate::pg::scratch("rs") {
                    let store = crystalline_index::PostgresStore::open_in_schema(
                        scratch.url(),
                        scratch.name(),
                    )
                    .await
                    .expect("open the postgres test schema");
                    $body(&store).await;
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
        2,
        "one lead vector per engram (the MANIFEST and notes/n), none for the page: {leads:?}"
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

/// The vector half of a reflection search: the closest section of one
/// domain's pages, nothing of another domain, and a refusal (not an empty
/// answer) when the stored vectors cannot be compared with the query.
async fn vector_hits_name_the_closest_section_of_one_domain(store: &dyn Store) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(root, "MANIFEST.md", &manifest_on());
    write(
        root,
        "reflections/a.md",
        "# A\n\n## Pager\n<!-- r:aaaa1111 -->\n\npager rings loudly\n\n## Tea\n<!-- r:bbbb2222 -->\n\nbrew green tea\n",
    );
    let other = tempfile::tempdir().unwrap();
    write(other.path(), "MANIFEST.md", &manifest_on());
    write(
        other.path(),
        "reflections/b.md",
        "# B\n\n## Pager\n<!-- r:cccc3333 -->\n\npager rings loudly\n",
    );
    sync_domain(store, "eng", root).await.unwrap();
    sync_domain(store, "ops", other.path()).await.unwrap();
    run_embedding_pass(store, &FakeProvider::new("fake"), |_, _| {})
        .await
        .unwrap();
    let did = store.domain_id("eng").await.unwrap().unwrap();
    let hits = store
        .reflection_vector_hits(did, &embed_one("pager rings loudly"), "fake")
        .await
        .unwrap();
    assert_eq!(
        (hits[0].path.as_str(), hits[0].section_ord),
        ("a.md", 1),
        "{hits:?}"
    );
    assert!(
        hits.iter().all(|h| h.path == "a.md"),
        "one domain only: {hits:?}"
    );
    assert!(
        hits.windows(2).all(|w| w[0].similarity >= w[1].similarity),
        "best first: {hits:?}"
    );
    // Nothing is embedded by that model while another model's vectors are
    // stored: the staleness gate answers before the statement runs.
    let unknown = store
        .reflection_vector_hits(did, &embed_one("pager"), "other-model")
        .await;
    assert!(
        matches!(unknown, Err(IndexError::StaleEmbeddings { .. })),
        "nothing of that model: {unknown:?}"
    );
    let stale = store.reflection_vector_hits(did, &[0.0; 4], "fake").await;
    assert!(
        matches!(stale, Err(IndexError::StaleEmbeddings { .. })),
        "a width the stored vectors do not have: {stale:?}"
    );
}
parity!(
    vector_hits_name_the_closest_section_of_one_domain_on_both_backends,
    vector_hits_name_the_closest_section_of_one_domain
);

/// A hit read back from the store carries its heading on its own and no
/// snippet repeats the `## heading` line, in text, semantic and hybrid.
async fn no_snippet_repeats_the_heading_line(store: &dyn Store) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(root, "MANIFEST.md", &manifest_on());
    write(
        root,
        "reflections/a.md",
        "# A\n\n## Pager rings\n<!-- r:aaaa1111 -->\n\npager rings loudly\n",
    );
    sync_domain(store, "eng", root).await.unwrap();
    run_embedding_pass(store, &FakeProvider::new("fake"), |_, _| {})
        .await
        .unwrap();
    let did = store.domain_id("eng").await.unwrap().unwrap();
    let rows = store.list_reflections(did).await.unwrap();
    let vectors = store
        .reflection_vector_hits(did, &embed_one("pager rings"), "fake")
        .await
        .unwrap();
    for mode in [SearchMode::Text, SearchMode::Semantic, SearchMode::Hybrid] {
        let page = crystalline_index::reflection::rank_sections(
            &rows,
            "pager rings",
            mode,
            &vectors,
            0.78,
            10,
            1,
        );
        let hit = &page.items[0];
        assert_eq!(
            (hit.heading.as_str(), hit.snippet.as_str()),
            ("Pager rings", "pager rings loudly"),
            "{mode:?}"
        );
    }
}
parity!(
    no_snippet_repeats_the_heading_line_on_both_backends,
    no_snippet_repeats_the_heading_line
);

/// Coverage is counted per domain: one domain's embedded pages never make
/// another domain's pages, not embedded yet, look searchable by vector, and
/// a domain with nothing embedded answers the vector statement with nothing,
/// never a refusal, whatever the query's width.
async fn reflection_coverage_is_counted_per_domain(store: &dyn Store) {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "MANIFEST.md", &manifest_on());
    write(
        dir.path(),
        "reflections/a.md",
        "# A\n\n## Pager\n<!-- r:aaaa1111 -->\n\npager rings loudly\n",
    );
    sync_domain(store, "eng", dir.path()).await.unwrap();
    run_embedding_pass(store, &FakeProvider::new("fake"), |_, _| {})
        .await
        .unwrap();
    let other = tempfile::tempdir().unwrap();
    write(other.path(), "MANIFEST.md", &manifest_on());
    write(
        other.path(),
        "reflections/b.md",
        "# B\n\n## Pager\n<!-- r:cccc3333 -->\n\npager rings loudly\n",
    );
    sync_domain(store, "ops", other.path()).await.unwrap();
    let eng = store.domain_id("eng").await.unwrap().unwrap();
    let ops = store.domain_id("ops").await.unwrap().unwrap();

    assert!(
        store
            .embedding_coverage_of(ChunkTable::Reflection)
            .await
            .unwrap()
            .has_active_embeddings("fake"),
        "precondition: the table holds vectors of the active model"
    );
    let embedded = store.reflection_coverage(eng).await.unwrap();
    assert!(
        embedded.total_chunks > 0 && embedded.embedded_for("fake") == embedded.total_chunks,
        "{embedded:?}"
    );
    assert_eq!(embedded.models.len(), 1, "{embedded:?}");
    assert_eq!(
        (embedded.models[0].model.as_str(), embedded.models[0].dims),
        ("fake", 8)
    );
    let waiting = store.reflection_coverage(ops).await.unwrap();
    assert!(
        waiting.total_chunks > 0
            && waiting.embedded_chunks == 0
            && !waiting.has_active_embeddings("fake"),
        "the ops pages wait, whatever eng holds: {waiting:?}"
    );
    assert!(
        waiting.models.is_empty(),
        "chunks without a vector are no model entry: {waiting:?}"
    );

    for query in [embed_one("pager rings loudly"), vec![0.5; 4]] {
        let hits = store.reflection_vector_hits(ops, &query, "fake").await;
        assert!(
            matches!(&hits, Ok(h) if h.is_empty()),
            "nothing embedded in ops, nothing to compare ({} dims): {hits:?}",
            query.len()
        );
    }
}
parity!(
    reflection_coverage_is_counted_per_domain_on_both_backends,
    reflection_coverage_is_counted_per_domain
);

/// The vector statement reads the active model's vectors only: a section
/// whose chunk holds another model's vector of the same width, the closest
/// one to the query, is never a hit. Same width, so the staleness gate lets
/// the statement run and only its model predicate keeps the section out.
async fn vector_hits_read_the_active_model_only(store: &dyn Store) {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "MANIFEST.md", &manifest_on());
    write(
        dir.path(),
        "reflections/a.md",
        "# A\n\n## Pager\n<!-- r:aaaa1111 -->\n\npager rings loudly\n\n## Tea\n<!-- r:bbbb2222 -->\n\nbrew green tea\n",
    );
    sync_domain(store, "eng", dir.path()).await.unwrap();
    run_embedding_pass(store, &FakeProvider::new("fake"), |_, _| {})
        .await
        .unwrap();
    let did = store.domain_id("eng").await.unwrap().unwrap();
    let query = embed_one("brew green tea");
    let before = store
        .reflection_vector_hits(did, &query, "fake")
        .await
        .unwrap();
    assert_eq!(
        (before[0].path.as_str(), before[0].section_ord),
        ("a.md", 2),
        "precondition: the tea section is the closest: {before:?}"
    );
    let tea: Vec<EmbeddingRow> = store
        .chunks_needing_embedding_in(ChunkTable::Reflection, "other", None, 100, None)
        .await
        .unwrap()
        .into_iter()
        .filter(|j| j.text.contains("tea"))
        .map(|j| EmbeddingRow {
            chunk_id: j.chunk_id,
            embedding: query.clone(),
            dims: 8,
        })
        .collect();
    assert_eq!(tea.len(), 1, "one chunk for the tea section");
    store
        .store_embeddings_in(ChunkTable::Reflection, &tea, "other")
        .await
        .unwrap();
    let hits = store
        .reflection_vector_hits(did, &query, "fake")
        .await
        .unwrap();
    assert!(
        !hits.is_empty() && hits.iter().all(|h| h.section_ord != 2),
        "the other model's vector of the tea section is no hit: {hits:?}"
    );
}
parity!(
    vector_hits_read_the_active_model_only_on_both_backends,
    vector_hits_read_the_active_model_only
);
