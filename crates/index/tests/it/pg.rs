//! The postgres leg's shared helpers: the database URL and a scratch schema
//! that is dropped even when the test fails.

use crystalline_index::ScratchSchema;

/// The Postgres URL the parity legs run against, or `None` with a note when
/// `CRYSTALLINE_TEST_POSTGRES_URL` is unset.
pub fn pg_url() -> Option<String> {
    use std::sync::Once;
    static NOTE: Once = Once::new();
    match std::env::var("CRYSTALLINE_TEST_POSTGRES_URL") {
        Ok(u) if !u.is_empty() => Some(u),
        _ => {
            NOTE.call_once(|| {
                eprintln!(
                    "note: skipping the postgres legs (CRYSTALLINE_TEST_POSTGRES_URL is unset); turso only"
                )
            });
            None
        }
    }
}

/// A scratch schema named from `prefix`, dropped when it goes out of scope
/// even if the test fails, or `None` without a URL. Declare it before any
/// store opened in it, so it drops last.
pub fn scratch(prefix: &str) -> Option<ScratchSchema> {
    pg_url().map(|url| ScratchSchema::new(&url, prefix))
}
