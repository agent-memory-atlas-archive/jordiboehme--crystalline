//! The Reflection: a domain's documents for people under `reflections/`.
//!
//! Pure pieces only - paths and file classes, sections and their ids, the
//! provenance a reflection carries in its frontmatter, the baseline and the
//! feedback changes taken against it, where a thread's anchor stands, and
//! relative links. Deciding who may do
//! what, reading and writing files and the index are the engine's. A
//! reflection is never an engram: nothing here calls `parse_engram`, and a
//! page with no frontmatter at all is valid. What a reflection shares with an
//! engram (the heading walker, the body line walker, the link target scan,
//! the path classifier) lives beside the engram code and is used from here.

pub mod anchors;
pub mod assets;
pub mod baseline;
pub mod layout;
pub mod links;
pub mod provenance;
pub mod sections;
pub mod state;

/// Why an import leaves out a file under `reflections/` where a Reflection
/// keeps that folder (the receiving domain's switch, or the switch the
/// imported MANIFEST declares): its pages are no engrams, and a Reflection
/// comes back from its backup branch. One sentence for every import road
/// (the engine's two verbs, the archive screen and `crystalline import`).
pub const REFLECTION_NOT_IMPORTED: &str = "under reflections/, which a Reflection keeps; a Reflection is restored from its backup branch, never imported as engrams";

pub use anchors::anchor_state;
pub use assets::{
    AssetTarget, classify_target, engram_attachment_embeds, reflection_asset_refs,
    refuse_engram_attachments,
};
pub use baseline::{
    ChangeKind, Relinked, SectionChange, advance_baseline, baseline_ids, feedback_changes,
    parse_baseline, relink, render_baseline,
};
pub use layout::{
    BASELINE_DIR, PACT_FILE, REFLECTIONS_DIR, ReflectionFile, Structure, THREADS_SUFFIX,
    baseline_path, classify, domain_rel, fits_structure, is_under_reflections, structure_globs,
    threads_path, validate_reflection_path,
};
pub use links::{rebase_links, relative_to, rewrite_asset_links, rewrite_links_to};
pub use provenance::{
    PROVENANCE_KEY, Provenance, SectionRecord, SourceRef, read_provenance, text_changed, title_of,
    write_provenance,
};
pub use sections::{
    Section, TOP_SECTION, assign_ids, edit_section, find_section, id_line, normalize_section_text,
    parse_id_line, random_section_id, reattach_ids, section_hash, split_sections,
};
pub use state::{ReflectionHome, ReflectionState};
