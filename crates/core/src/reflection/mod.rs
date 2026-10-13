//! The Reflection: a domain's documents for people under `reflections/`.
//!
//! Pure pieces only - paths and file classes, sections and their ids, the
//! provenance a reflection carries in its frontmatter, the baseline and the
//! feedback changes taken against it, and relative links. Deciding who may do
//! what, reading and writing files and the index are the engine's. A
//! reflection is never an engram: nothing here calls `parse_engram`, and a
//! page with no frontmatter at all is valid. What a reflection shares with an
//! engram (the heading walker, the body line walker, the link target scan,
//! the path classifier) lives beside the engram code and is used from here.

pub mod layout;
pub mod links;

pub use layout::{
    BASELINE_DIR, PACT_FILE, REFLECTIONS_DIR, ReflectionFile, Structure, THREADS_SUFFIX,
    baseline_path, classify, domain_rel, fits_structure, is_under_reflections, structure_globs,
    threads_path, validate_reflection_path,
};
pub use links::{rebase_links, relative_to, rewrite_links_to};
