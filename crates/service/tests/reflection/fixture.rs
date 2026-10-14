//! A file domain `eng` on a temporary root, an in-memory index, a scratch
//! state directory, and helpers to write engrams and reflections.

// Later tasks use the helpers; until then some are unused.
#![allow(dead_code)]

use std::path::PathBuf;
use std::sync::Arc;

use crystalline_core::config::{DomainEntry, EmbeddingsConfig, GlobalConfig};
use crystalline_index::{EmbeddingProvider, Store, TursoStore};
use crystalline_service::Engine;
use crystalline_service::params::{DeleteParams, MoveParams, WriteParams};
use tokio::sync::Mutex;
use tokio::sync::mpsc::UnboundedSender;

pub struct Fx {
    pub tmp: tempfile::TempDir,
    pub engine: Arc<Engine>,
    /// The `eng` domain root.
    pub root: PathBuf,
}

/// A MANIFEST for `eng` with extra frontmatter lines (each ending in `\n`).
pub fn manifest(extra: &str) -> String {
    format!(
        "---\ntype: manifest\ntitle: eng\npermalink: manifest\ntags:\n  - manifest\nstatus: stable\nrecorded_at: 2026-01-01\n{extra}---\n\n# eng\n\n## Scope\n\n- Everything about eng\n\n## When to Use\n\n- Route here for eng questions\n"
    )
}

/// An engram file.
pub fn engram(title: &str, permalink: &str, body: &str) -> String {
    format!(
        "---\ntype: engram\ntitle: {title}\npermalink: {permalink}\ntags:\n  - eng\nstatus: stable\nrecorded_at: 2026-09-01\n---\n\n# {title}\n\n{body}\n"
    )
}

/// A reflection page: a section with an id line, the page marker that keeps
/// the file the Reflection's rather than an engram waiting to move out.
pub fn page(title: &str) -> String {
    format!("# {title}\n\nFor people.\n\n## Part\n<!-- r:aaaa1111 -->\n\nText.\n")
}

pub fn write_params(title: &str, folder: Option<&str>, content: &str) -> WriteParams {
    WriteParams {
        domain: "eng".into(),
        title: title.into(),
        content: content.into(),
        folder: folder.map(str::to_string),
        engram_type: None,
        tags: Vec::new(),
        status: None,
        metadata: None,
        overwrite: false,
        model: None,
        share_link: None,
    }
}

pub fn move_params(identifier: &str, destination: &str) -> MoveParams {
    MoveParams {
        identifier: identifier.into(),
        domain: "eng".into(),
        destination: destination.into(),
        destination_domain: None,
        permalink: None,
        update_links: None,
    }
}

pub fn delete_params(identifier: &str) -> DeleteParams {
    DeleteParams {
        identifier: identifier.into(),
        domain: "eng".into(),
        expected_checksum: None,
    }
}

/// `files` are domain-relative paths and contents; a `MANIFEST.md` among
/// them replaces the default (Reflection off).
pub async fn fixture(files: &[(&str, &str)]) -> Fx {
    fixture_with(files, |_, _| {}).await
}

pub async fn fixture_with(
    files: &[(&str, &str)],
    tweak: impl FnOnce(&mut GlobalConfig, &std::path::Path),
) -> Fx {
    fixture_wired_with(files, tweak, None, None, None).await
}

/// [`fixture_with`]'s body with an embedding provider and the worker channels
/// wired, so a test sees what a write and the tick ask for.
pub async fn fixture_wired(
    files: &[(&str, &str)],
    provider: Option<Arc<dyn EmbeddingProvider>>,
    embed_tx: Option<UnboundedSender<()>>,
    contradiction_tx: Option<UnboundedSender<()>>,
) -> Fx {
    fixture_wired_with(files, |_, _| {}, provider, embed_tx, contradiction_tx).await
}

/// [`fixture`] with the bag-of-words provider, configured as the active
/// model, so writes chunk and `embed_pending` embeds them. What the sync
/// indexed is embedded before the fixture returns, so both backlogs start
/// empty.
pub async fn fixture_with_provider(files: &[(&str, &str)]) -> Fx {
    fixture_with_provider_and(files, |_, _| {}).await
}

/// [`fixture_with_provider`] with a config tweak.
pub async fn fixture_with_provider_and(
    files: &[(&str, &str)],
    tweak: impl FnOnce(&mut GlobalConfig, &std::path::Path),
) -> Fx {
    let provider = Arc::new(BagOfWords::new("fake"));
    let fx = fixture_wired_with(
        files,
        |cfg, base| {
            cfg.embeddings = Some(EmbeddingsConfig {
                provider: "openai-compatible".into(),
                model: "fake".into(),
                endpoint: None,
                api_key_env: None,
            });
            tweak(cfg, base);
        },
        Some(provider),
        None,
        None,
    )
    .await;
    fx.engine.embed_pending().await.unwrap();
    fx
}

/// [`fixture_wired`] with a config tweak: the one builder every fixture
/// here delegates to.
pub async fn fixture_wired_with(
    files: &[(&str, &str)],
    tweak: impl FnOnce(&mut GlobalConfig, &std::path::Path),
    provider: Option<Arc<dyn EmbeddingProvider>>,
    embed_tx: Option<UnboundedSender<()>>,
    contradiction_tx: Option<UnboundedSender<()>>,
) -> Fx {
    let store = TursoStore::open_in_memory().await.unwrap();
    fixture_on(
        Arc::new(Mutex::new(store)),
        files,
        tweak,
        provider,
        embed_tx,
        contradiction_tx,
    )
    .await
}

/// [`fixture_wired_with`] over a store the caller opened, so one body can
/// run on Turso and on Postgres.
pub async fn fixture_on(
    store: Arc<Mutex<dyn Store>>,
    files: &[(&str, &str)],
    tweak: impl FnOnce(&mut GlobalConfig, &std::path::Path),
    provider: Option<Arc<dyn EmbeddingProvider>>,
    embed_tx: Option<UnboundedSender<()>>,
    contradiction_tx: Option<UnboundedSender<()>>,
) -> Fx {
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path().to_path_buf();
    let root = base.join("eng");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("MANIFEST.md"), manifest("")).unwrap();
    for (rel, body) in files {
        let abs = root.join(rel);
        std::fs::create_dir_all(abs.parent().unwrap()).unwrap();
        std::fs::write(abs, body).unwrap();
    }
    let mut cfg = GlobalConfig::default();
    cfg.domains
        .insert("eng".to_string(), DomainEntry::file(root.clone()));
    tweak(&mut cfg, &base);
    let config_path = base.join("config.yaml");
    crystalline_core::config::save_yaml(&config_path, &cfg).unwrap();
    let mut engine = Engine::new(store, cfg, provider, Some(config_path))
        .with_state_dir(base.join("state"))
        // Origin state (base snapshots, the backup state) lands in the
        // temp dir, never in the developer's own state directory.
        .with_origins_dir(base.join("origins"));
    if let Some(tx) = embed_tx {
        engine = engine.with_embed_channel(tx);
    }
    if let Some(tx) = contradiction_tx {
        engine = engine.with_contradiction_channel(tx);
    }
    let engine = Arc::new(engine);
    engine.sync(None).await.unwrap();
    Fx { tmp, engine, root }
}

/// The Postgres URL the parity legs run against, or `None` with a note
/// when `CRYSTALLINE_TEST_POSTGRES_URL` is unset.
#[cfg(feature = "postgres")]
pub fn pg_url() -> Option<String> {
    use std::sync::Once;
    static NOTE: Once = Once::new();
    match std::env::var("CRYSTALLINE_TEST_POSTGRES_URL") {
        Ok(u) if !u.is_empty() => Some(u),
        _ => {
            NOTE.call_once(|| {
                eprintln!(
                    "note: skipping the postgres reflection leg (CRYSTALLINE_TEST_POSTGRES_URL is unset); turso only"
                )
            });
            None
        }
    }
}

/// A distinct schema name per call, salted so a recycled pid never adopts
/// a schema a panicking run left behind.
#[cfg(feature = "postgres")]
pub fn unique_schema() -> String {
    use std::hash::{BuildHasher, RandomState};
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!(
        "refl_{}_{}_{:x}",
        std::process::id(),
        n,
        RandomState::new().hash_one(n)
    )
}

/// A deterministic provider over eight hashed word buckets: texts sharing
/// words land near each other, so a semantic query finds the section that
/// uses its words.
pub struct BagOfWords {
    model: String,
}

impl BagOfWords {
    pub fn new(model: &str) -> BagOfWords {
        BagOfWords {
            model: model.to_string(),
        }
    }
}

/// [`BagOfWords`]'s vector for one text.
pub fn bag_of_words(text: &str) -> Vec<f32> {
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

#[async_trait::async_trait]
impl EmbeddingProvider for BagOfWords {
    async fn embed(&self, texts: &[String]) -> crystalline_index::Result<Vec<Vec<f32>>> {
        Ok(texts.iter().map(|t| bag_of_words(t)).collect())
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
