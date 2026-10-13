//! Where a Reflection's files live and what each one is.

use globset::{Glob, GlobSet, GlobSetBuilder};

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

/// A path inside `reflections/` as a domain-relative path.
pub fn domain_rel(path: &str) -> String {
    format!("{REFLECTIONS_DIR}/{path}")
}

/// Why `path` cannot name a reflection, or `Ok`. A reflection path is
/// relative to `reflections/`, forward-slashed, ends in `.md`, has no empty,
/// `.` or `..` segment, no hidden segment, no backslash, is not a threads
/// file and does not take an OKF reserved name.
pub fn validate_reflection_path(path: &str) -> Result<(), String> {
    if path.is_empty() {
        return Err("the reflection path is empty".to_string());
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
    /// Anything else: a stray file, a reserved name, a temp file.
    Other,
}

/// Classify a path inside `reflections/`. The baseline prefix is read
/// first, so a baseline of anything is a baseline.
pub fn classify(path: &str) -> ReflectionFile {
    if path == PACT_FILE {
        return ReflectionFile::Pact;
    }
    if let Some(of) = path.strip_prefix(&format!("{BASELINE_DIR}/")) {
        return if of.ends_with(".md") {
            ReflectionFile::Baseline { of: of.to_string() }
        } else {
            ReflectionFile::Other
        };
    }
    if let Some(stem) = path.strip_suffix(THREADS_SUFFIX) {
        return ReflectionFile::Threads {
            of: format!("{stem}.md"),
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
        for glob in globs.iter().filter_map(|g| Glob::new(g).ok()) {
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
        for ok in ["a.md", "guides/deploying.md", "PACT.md", "a/b/c/d.md"] {
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
        assert!(!structure.fits("misc/c.md"));
        assert!(fits_structure("guides/a.md", &globs));
        assert!(
            fits_structure("anything.md", &[]),
            "no structure section, nothing is off it"
        );
    }
}
