//! What every path in a domain is, decided in one place.
//!
//! A domain folder holds engrams, the attachment folder `assets/`, the OKF
//! reserved names, hidden files and the artifact folders its MANIFEST
//! provisions from inside the root. Every walk of a domain - the sync,
//! verify, the folder indexes, doctor, export and import, share changes and
//! the watcher - asks [`DomainLayout::classify`] what a path is and keeps its
//! own policy over the answer, so a new kind of content is taught to every
//! walk at once instead of to each walk by hand.

use std::path::Path;

use crate::kind::ContentKind;

/// Whether a domain keeps a Reflection that decides what its `reflections/`
/// folder is. `Off` makes the folder ordinary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ReflectionMode {
    /// The domain keeps no Reflection.
    #[default]
    Off,
}

/// What one domain-relative path is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PathClass {
    /// A markdown file the engram side reads.
    Engram,
    /// A file under the reserved `assets/` folder, whatever its extension.
    EngramAsset,
    /// An OKF reserved name (`index.md`, `log.md`) at any level.
    Reserved,
    /// A path with a hidden segment.
    Hidden,
    /// A path inside an artifact folder the MANIFEST provisions from inside
    /// the domain root.
    Artifact,
    /// Anything else: a file that is not markdown and not under `assets/`.
    Other,
}

impl PathClass {
    /// The kind of document the path belongs to, if any.
    pub fn kind(&self) -> Option<ContentKind> {
        match self {
            PathClass::Engram | PathClass::EngramAsset => Some(ContentKind::Engram),
            PathClass::Reserved | PathClass::Hidden | PathClass::Artifact | PathClass::Other => {
                None
            }
        }
    }

    /// Whether the path may travel with an engram share. Every class here
    /// may; a share's own rules (hidden paths, `log.md`, generated indexes)
    /// narrow the rest.
    pub fn shares(&self) -> bool {
        match self {
            PathClass::Engram
            | PathClass::EngramAsset
            | PathClass::Reserved
            | PathClass::Hidden
            | PathClass::Artifact
            | PathClass::Other => true,
        }
    }

    /// Whether the path belongs in the backup of a domain's own documents,
    /// which is kept apart from the engram share. No class here does.
    pub fn backs_up(&self) -> bool {
        match self {
            PathClass::Engram
            | PathClass::EngramAsset
            | PathClass::Reserved
            | PathClass::Hidden
            | PathClass::Artifact
            | PathClass::Other => false,
        }
    }
}

/// How one domain's folder is laid out: its in-root artifact folders and its
/// Reflection mode.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DomainLayout {
    /// The in-root artifact folders, domain-relative and forward-slashed.
    artifacts: Vec<String>,
    reflection: ReflectionMode,
}

impl DomainLayout {
    /// The layout of the domain rooted at `root`: the artifact folders its
    /// MANIFEST provisions from inside the root (none when the MANIFEST is
    /// missing or unparseable), and the Reflection mode the caller knows.
    pub fn at(root: &Path, reflection: ReflectionMode) -> DomainLayout {
        let artifacts = crate::manifest::in_root_artifact_dirs(root)
            .iter()
            .map(|dir| slash_rel(root, dir))
            .filter(|rel| !rel.is_empty())
            .collect();
        DomainLayout {
            artifacts,
            reflection,
        }
    }

    /// A layout without artifact folders, for a walk whose policy treats them
    /// like the rest of the domain (share changes, the watcher, a walk of a
    /// folder that is not a domain yet). Reads nothing.
    pub fn bare(reflection: ReflectionMode) -> DomainLayout {
        DomainLayout {
            artifacts: Vec::new(),
            reflection,
        }
    }

    /// The Reflection mode this layout was built with.
    pub fn reflection(&self) -> ReflectionMode {
        self.reflection
    }

    /// What `rel` (domain-relative, forward-slashed) is. The precedence is
    /// hidden, reserved, artifact, attachment, markdown: the order every walk
    /// applied its own filters in before they asked here.
    pub fn classify(&self, rel: &str) -> PathClass {
        let rel = rel.trim_start_matches("./");
        if rel.split('/').any(is_hidden_segment) {
            return PathClass::Hidden;
        }
        if crate::index::is_reserved_path(rel) {
            return PathClass::Reserved;
        }
        if self.in_artifact(rel) {
            return PathClass::Artifact;
        }
        if crate::attachment::is_under_assets(rel) {
            return PathClass::EngramAsset;
        }
        if rel.to_ascii_lowercase().ends_with(".md") {
            PathClass::Engram
        } else {
            PathClass::Other
        }
    }

    /// Whether a walk that reads this domain's own files descends into the
    /// directory at `rel`: not into a hidden directory, not into an artifact
    /// folder.
    pub fn enters_dir(&self, rel: &str) -> bool {
        !matches!(self.classify(rel), PathClass::Hidden | PathClass::Artifact)
    }

    /// Whether a walk over the engrams alone (verify, the folder indexes,
    /// doctor) prunes the directory at `rel`.
    pub fn prunes_dir(&self, rel: &str) -> bool {
        !self.enters_dir(rel)
    }

    fn in_artifact(&self, rel: &str) -> bool {
        self.artifacts.iter().any(|dir| {
            rel == dir
                || rel
                    .strip_prefix(dir.as_str())
                    .is_some_and(|rest| rest.starts_with('/'))
        })
    }
}

/// Whether one path segment is hidden: a dot-file or dot-directory.
fn is_hidden_segment(segment: &str) -> bool {
    segment.starts_with('.') && segment != "." && segment != ".."
}

/// `path` relative to `root`, forward-slashed: the key every walker uses.
pub fn slash_rel(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn layout(artifacts: &[&str]) -> DomainLayout {
        DomainLayout {
            artifacts: artifacts.iter().map(|a| a.to_string()).collect(),
            reflection: ReflectionMode::Off,
        }
    }

    /// Today's rules, one row each: the class every walker on main already
    /// derives by hand. Every walker routes through this table, so a row
    /// that moves here moves a walker.
    #[test]
    fn the_classes_of_todays_rules() {
        let layout = layout(&["skills", "deploy/out"]);
        for (rel, class) in [
            ("notes/a.md", PathClass::Engram),
            ("notes/A.MD", PathClass::Engram),
            ("MANIFEST.md", PathClass::Engram),
            ("./notes/a.md", PathClass::Engram),
            ("reflections/a.md", PathClass::Engram),
            ("Index.md", PathClass::Engram),
            ("assets-notes/a.md", PathClass::Engram),
            ("skillset/a.md", PathClass::Engram),
            ("deploy/a.md", PathClass::Engram),
            ("assets/shot.png", PathClass::EngramAsset),
            ("Assets/shot.png", PathClass::EngramAsset),
            ("assets/notes.md", PathClass::EngramAsset),
            ("assets", PathClass::EngramAsset),
            ("index.md", PathClass::Reserved),
            ("runbooks/log.md", PathClass::Reserved),
            ("assets/index.md", PathClass::Reserved),
            ("skills/index.md", PathClass::Reserved),
            (".git/config", PathClass::Hidden),
            ("notes/.draft.md", PathClass::Hidden),
            (".crystalline.yaml", PathClass::Hidden),
            ("assets/.tmp.png", PathClass::Hidden),
            ("skills", PathClass::Artifact),
            ("skills/x/SKILL.md", PathClass::Artifact),
            ("deploy/out/a.md", PathClass::Artifact),
            ("notes/picture.png", PathClass::Other),
        ] {
            assert_eq!(layout.classify(rel), class, "{rel}");
        }
    }

    #[test]
    fn a_walk_enters_every_folder_but_hidden_and_artifact_ones() {
        let layout = layout(&["skills"]);
        for dir in ["notes", "assets", "Assets", "reflections"] {
            assert!(layout.enters_dir(dir), "{dir}");
            assert!(!layout.prunes_dir(dir), "{dir}");
        }
        for dir in [".git", "notes/.trash", "skills", "skills/deep"] {
            assert!(!layout.enters_dir(dir), "{dir}");
            assert!(layout.prunes_dir(dir), "{dir}");
        }
    }

    #[test]
    fn every_class_shares_and_none_backs_up_yet() {
        for class in [
            PathClass::Engram,
            PathClass::EngramAsset,
            PathClass::Reserved,
            PathClass::Hidden,
            PathClass::Artifact,
            PathClass::Other,
        ] {
            assert!(class.shares(), "{class:?}");
            assert!(!class.backs_up(), "{class:?}");
        }
        assert_eq!(PathClass::Engram.kind(), Some(ContentKind::Engram));
        assert_eq!(PathClass::EngramAsset.kind(), Some(ContentKind::Engram));
        assert_eq!(PathClass::Other.kind(), None);
    }

    #[test]
    fn the_layout_reads_the_artifact_folders_from_the_manifest() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        assert_eq!(
            DomainLayout::at(root, ReflectionMode::Off),
            DomainLayout::bare(ReflectionMode::Off),
            "no MANIFEST"
        );
        std::fs::write(
            root.join("MANIFEST.md"),
            "---\ntype: manifest\ntitle: KB\npermalink: manifest\ntags: [manifest]\nstatus: stable\n---\n\n## Scope\n\n- s\n\n## When to Use\n\n- w\n\n## Provisioning\n\n- skills: skills\n- elsewhere: ../outside\n",
        )
        .unwrap();
        let layout = DomainLayout::at(root, ReflectionMode::Off);
        assert_eq!(layout.classify("skills/x/SKILL.md"), PathClass::Artifact);
        assert_eq!(
            layout.classify("notes/a.md"),
            PathClass::Engram,
            "an out-of-root decl names no folder here"
        );
        assert_eq!(
            DomainLayout::bare(ReflectionMode::Off).classify("skills/x/SKILL.md"),
            PathClass::Engram
        );
        assert_eq!(
            slash_rel(root, &root.join("skills").join("x").join("SKILL.md")),
            "skills/x/SKILL.md"
        );
    }
}
