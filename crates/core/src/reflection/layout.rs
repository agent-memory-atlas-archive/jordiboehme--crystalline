//! Where a Reflection's files live and what each one is.

use globset::{Glob, GlobBuilder, GlobSet, GlobSetBuilder};

use crate::parse::{body_lines, parse_heading};

/// The folder under a domain root that holds the Reflection.
pub const REFLECTIONS_DIR: &str = "reflections";
/// The domain's agreement on how to talk about it, one per domain.
pub const PACT_FILE: &str = "PACT.md";
/// The hidden folder mirroring the tree with the last reflected text.
pub const BASELINE_DIR: &str = ".reflected";
/// The suffix of a reflection's threads file, beside it.
pub const THREADS_SUFFIX: &str = ".threads.md";

/// Whether a domain-relative path is the reflections folder or under it.
/// The first segment is compared with ASCII case folded, the question
/// [`crate::is_under_assets`] asks, so a spelling that differs only in case
/// cannot smuggle an engram into the folder on a case-folding filesystem.
pub fn is_under_reflections(rel: &str) -> bool {
    rel.trim_start_matches("./")
        .split('/')
        .next()
        .is_some_and(|first| first.eq_ignore_ascii_case(REFLECTIONS_DIR))
}

/// The folders directly under the domain at `root` whose name is
/// `reflections` in any letter case, sorted. More than one cannot be one
/// Reflection (their files would land on the same rows), which only a
/// case-sensitive filesystem allows. A root that cannot be read has none.
pub fn reflection_folders(root: &std::path::Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    let mut folders: Vec<String> = entries
        .flatten()
        .filter(|entry| entry.file_type().is_ok_and(|t| t.is_dir()))
        .filter_map(|entry| entry.file_name().to_str().map(str::to_string))
        .filter(|name| name.eq_ignore_ascii_case(REFLECTIONS_DIR))
        .collect();
    folders.sort();
    folders
}

/// Whether a path inside `reflections/` names the pact. The name is
/// compared with ASCII case folded, the way the folder is: on a case-folding
/// filesystem `pact.md` is the same file as `PACT.md`.
fn is_pact(path: &str) -> bool {
    path.eq_ignore_ascii_case(PACT_FILE)
}

/// A path inside `reflections/` as a domain-relative path.
pub fn domain_rel(path: &str) -> String {
    format!("{REFLECTIONS_DIR}/{path}")
}

/// Why `path` cannot name a reflection, or `Ok`. A reflection path is
/// relative to `reflections/`, forward-slashed, ends in `.md`, has no empty,
/// `.` or `..` segment, no hidden segment, no backslash, is not a threads
/// file, does not take an OKF reserved name and does not spell the pact in
/// another case.
pub fn validate_reflection_path(path: &str) -> Result<(), String> {
    if path.is_empty() {
        return Err("the reflection path is empty".to_string());
    }
    if crate::is_under_assets(path) {
        return Err(format!(
            "'{path}' is inside reflections/assets/, which holds the Reflection's files; a reflection cannot live there"
        ));
    }
    if path.contains('\\') || path.starts_with('/') {
        return Err(format!(
            "'{path}' must be a forward-slashed path inside reflections/"
        ));
    }
    if !path.ends_with(".md") {
        return Err(format!("'{path}' must end in .md"));
    }
    if path.ends_with(THREADS_SUFFIX) {
        return Err(format!(
            "'{path}' ends in {THREADS_SUFFIX}, which holds a reflection's threads"
        ));
    }
    for segment in path.split('/') {
        if segment.is_empty() || segment == "." || segment == ".." {
            return Err(format!("'{path}' has an empty, '.' or '..' segment"));
        }
        if segment.starts_with('.') {
            return Err(format!(
                "'{path}' has a hidden segment; those are Crystalline's own"
            ));
        }
    }
    let name = path.rsplit('/').next().unwrap_or(path);
    if crate::is_reserved_file(name) {
        return Err(format!("'{path}' uses a reserved name ({name})"));
    }
    if is_pact(path) && path != PACT_FILE {
        return Err(format!("'{path}' names the pact; spell it {PACT_FILE}"));
    }
    Ok(())
}

/// The threads file beside a reflection.
pub fn threads_path(path: &str) -> String {
    let stem = path.strip_suffix(".md").unwrap_or(path);
    format!("{stem}{THREADS_SUFFIX}")
}

/// The baseline file mirroring a reflection.
pub fn baseline_path(path: &str) -> String {
    format!("{BASELINE_DIR}/{path}")
}

/// What one file inside `reflections/` is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReflectionFile {
    /// A reflection page, by its own path.
    Page(String),
    /// `PACT.md` at the folder root.
    Pact,
    /// The threads of the reflection at `of`.
    Threads { of: String },
    /// The baseline of the reflection at `of`.
    Baseline { of: String },
    /// A file under `reflections/assets/`, by its canonical path inside
    /// `reflections/` (`assets/<rel>`). Never a reflection.
    Asset(String),
    /// Anything else: a stray file, a reserved name, a temp file.
    Other,
}

/// The page a threads file belongs to, when `path` is one of a valid page.
fn threads_of(path: &str) -> Option<String> {
    let of = format!("{}.md", path.strip_suffix(THREADS_SUFFIX)?);
    validate_reflection_path(&of).is_ok().then_some(of)
}

/// Classify a path inside `reflections/`. A path under `assets/` (the folder
/// matched with ASCII case folded) is never a reflection: an allowlisted file
/// there is the Reflection's own file, anything else is `Other`. The pact's
/// name is matched with
/// ASCII case folded, as the folder is. The baseline prefix is read first,
/// so a baseline of a page or of a threads file is a baseline. A threads
/// file or a baseline whose page could not be a reflection (hidden, reserved,
/// climbing out) is `Other`, like any stray file.
pub fn classify(path: &str) -> ReflectionFile {
    // Nothing under assets/ is a reflection: an allowlisted file is the
    // Reflection's own attachment, everything else there is nobody's.
    if let Some(canonical) = crate::canonical_asset_path(path) {
        return if crate::validate_asset_path(&canonical).is_ok() {
            ReflectionFile::Asset(canonical)
        } else {
            ReflectionFile::Other
        };
    }
    if is_pact(path) {
        return ReflectionFile::Pact;
    }
    if let Some(of) = path.strip_prefix(&format!("{BASELINE_DIR}/")) {
        let mirrors = validate_reflection_path(of).is_ok() || threads_of(of).is_some();
        return if mirrors {
            ReflectionFile::Baseline { of: of.to_string() }
        } else {
            ReflectionFile::Other
        };
    }
    if path.ends_with(THREADS_SUFFIX) {
        return match threads_of(path) {
            Some(of) => ReflectionFile::Threads { of },
            None => ReflectionFile::Other,
        };
    }
    if validate_reflection_path(path).is_ok() {
        ReflectionFile::Page(path.to_string())
    } else {
        ReflectionFile::Other
    }
}

/// The globs a pact's `## Structure` section lists: every zero-indent
/// bullet, backticks stripped, that compiles as a glob. Empty when the pact
/// has no such section.
pub fn structure_globs(pact_source: &str) -> Vec<String> {
    let body = crate::frontmatter::split_frontmatter(pact_source)
        .map(|parts| parts.body)
        .unwrap_or(pact_source);
    let mut inside = false;
    let mut globs = Vec::new();
    for line in body_lines(body, 1) {
        if line.in_fence {
            continue;
        }
        if let Some((level, text)) = parse_heading(line.text) {
            if level <= 2 {
                inside = level == 2 && text.trim().eq_ignore_ascii_case("structure");
            }
            continue;
        }
        if !inside {
            continue;
        }
        let Some(item) = line.text.strip_prefix("- ") else {
            continue;
        };
        let glob = item.trim().trim_matches('`').trim();
        if !glob.is_empty() && Glob::new(glob).is_ok() {
            globs.push(glob.to_string());
        }
    }
    globs
}

/// A pact's structure, compiled once for every path it is asked about.
pub struct Structure {
    /// `None` when the pact agreed no structure: nothing is off it.
    set: Option<GlobSet>,
}

impl Structure {
    /// Compile `globs` (what [`structure_globs`] answers).
    pub fn new(globs: &[String]) -> Structure {
        if globs.is_empty() {
            return Structure { set: None };
        }
        let mut builder = GlobSetBuilder::new();
        // `*` and `?` stay inside one folder (`guides/*.md` is the pages
        // directly in `guides/`); `**` crosses folders.
        let compiled = globs
            .iter()
            .filter_map(|g| GlobBuilder::new(g).literal_separator(true).build().ok());
        for glob in compiled {
            builder.add(glob);
        }
        Structure {
            set: builder.build().ok(),
        }
    }

    /// Whether `path` fits the structure.
    pub fn fits(&self, path: &str) -> bool {
        self.set.as_ref().is_none_or(|set| set.is_match(path))
    }
}

/// Whether one `path` fits the pact's structure. A caller that asks for many
/// paths builds one [`Structure`] instead.
pub fn fits_structure(path: &str, globs: &[String]) -> bool {
    Structure::new(globs).fits(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_folder_is_matched_like_assets() {
        assert!(is_under_reflections("reflections/a.md"));
        assert!(
            is_under_reflections("Reflections/a.md"),
            "APFS and NTFS fold case"
        );
        assert!(is_under_reflections("reflections"));
        assert!(!is_under_reflections("reflection/a.md"));
        assert!(
            !is_under_reflections("notes/reflections/a.md"),
            "only at the root"
        );
        assert_eq!(domain_rel("guides/a.md"), "reflections/guides/a.md");
    }

    #[test]
    fn reflection_paths_are_validated() {
        for ok in [
            "a.md",
            "guides/deploying.md",
            "PACT.md",
            "a/b/c/d.md",
            "guides/pact.md",
        ] {
            assert!(validate_reflection_path(ok).is_ok(), "{ok}");
        }
        for bad in [
            "",
            "a.txt",
            "/a.md",
            "a/../b.md",
            "./a.md",
            "a//b.md",
            ".reflected/a.md",
            "guides/.hidden.md",
            "a.threads.md",
            "a\\b.md",
            "guides/",
            "index.md",
            "log.md",
            "pact.md",
        ] {
            assert!(validate_reflection_path(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn siblings_mirror_the_path() {
        assert_eq!(
            threads_path("guides/deploying.md"),
            "guides/deploying.threads.md"
        );
        assert_eq!(threads_path("PACT.md"), "PACT.threads.md");
        assert_eq!(
            baseline_path("guides/deploying.md"),
            ".reflected/guides/deploying.md"
        );
    }

    #[test]
    fn files_in_the_folder_are_classified() {
        assert_eq!(
            classify("guides/a.md"),
            ReflectionFile::Page("guides/a.md".into())
        );
        assert_eq!(classify("PACT.md"), ReflectionFile::Pact);
        assert_eq!(
            classify("guides/a.threads.md"),
            ReflectionFile::Threads {
                of: "guides/a.md".into()
            }
        );
        assert_eq!(
            classify(".reflected/guides/a.md"),
            ReflectionFile::Baseline {
                of: "guides/a.md".into()
            }
        );
        assert_eq!(
            classify(".reflected/guides/a.threads.md"),
            ReflectionFile::Baseline {
                of: "guides/a.threads.md".into()
            },
            "the baseline prefix is read before the threads suffix"
        );
        assert_eq!(classify("guides/picture.png"), ReflectionFile::Other);
        assert_eq!(
            classify("guides/index.md"),
            ReflectionFile::Other,
            "OKF reserved names stay reserved"
        );
        assert_eq!(
            classify(".tmp-a.md"),
            ReflectionFile::Other,
            "a hidden temp file is nobody's page"
        );
    }

    #[test]
    fn nothing_under_assets_is_a_reflection() {
        assert_eq!(
            classify("assets/flow.png"),
            ReflectionFile::Asset("assets/flow.png".into())
        );
        assert_eq!(
            classify("assets/deep/deck.pdf"),
            ReflectionFile::Asset("assets/deep/deck.pdf".into())
        );
        assert_eq!(
            classify("Assets/flow.png"),
            ReflectionFile::Asset("assets/flow.png".into()),
            "one spelling, as for engram attachments"
        );
        assert_eq!(
            classify("assets/notes.md"),
            ReflectionFile::Other,
            "markdown is never a file here, never a reflection"
        );
        assert_eq!(classify("assets/tool.exe"), ReflectionFile::Other);
        assert_eq!(
            classify("guides/picture.png"),
            ReflectionFile::Other,
            "only the assets folder holds files"
        );
        for bad in ["assets/a.md", "Assets/a.md", "assets/deep/b.md"] {
            let err = validate_reflection_path(bad).unwrap_err();
            assert!(err.contains("reflections/assets/"), "{bad}: {err}");
        }
        assert!(
            validate_reflection_path("assets-notes/a.md").is_ok(),
            "only the folder itself is reserved"
        );
    }

    #[test]
    fn the_pact_name_folds_case_like_the_folder() {
        assert_eq!(classify("pact.md"), ReflectionFile::Pact);
        assert_eq!(classify("Pact.MD"), ReflectionFile::Pact);
        assert_eq!(
            classify("guides/pact.md"),
            ReflectionFile::Page("guides/pact.md".into()),
            "only at the folder root"
        );
    }

    #[test]
    fn threads_and_baselines_belong_to_a_page_that_could_exist() {
        assert_eq!(
            classify("PACT.threads.md"),
            ReflectionFile::Threads {
                of: "PACT.md".into()
            }
        );
        for stray in [
            ".x.threads.md",
            "guides/.x.threads.md",
            "index.threads.md",
            "a.threads.threads.md",
            ".reflected/../x.md",
            ".reflected/.tmp.md",
            ".reflected/index.md",
            ".reflected/.x.threads.md",
        ] {
            assert_eq!(classify(stray), ReflectionFile::Other, "{stray}");
        }
    }

    #[test]
    fn the_pact_structure_is_a_list_of_globs() {
        let pact = "---\ntitle: Pact\n---\n\n# Pact\n\n## Audience\n\n- new team members\n\n## Structure\n<!-- r:0a1b2c3d -->\n\n- guides/*.md\n- `howto/**/*.md`\n- not a glob [\n\n## Other\n\n- x.md\n";
        let globs = structure_globs(pact);
        assert_eq!(
            globs,
            vec!["guides/*.md".to_string(), "howto/**/*.md".to_string()]
        );
        let structure = Structure::new(&globs);
        assert!(structure.fits("guides/a.md"));
        assert!(structure.fits("howto/deep/b.md"));
        assert!(
            !structure.fits("guides/x/y.md"),
            "`*` stays inside one folder"
        );
        assert!(structure.fits("howto/b.md"), "`**/` matches no folder too");
        assert!(!structure.fits("misc/c.md"));
        assert!(fits_structure("guides/a.md", &globs));
        assert!(
            fits_structure("anything.md", &[]),
            "no structure section, nothing is off it"
        );
    }
}
