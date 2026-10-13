//! The kinds of document a domain holds, as one closed enum: everything that
//! differs between them (where they live, where their files live, whether
//! verify reads them) is answered here, so code that serves several kinds
//! takes a kind instead of copying itself per kind.

/// One kind of document a domain holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ContentKind {
    /// An engram: markdown anywhere in the domain outside the reserved
    /// folders, parsed and verified.
    Engram,
    /// A page under `reflections/`: never parsed as an engram and never
    /// verified.
    Reflection,
}

impl ContentKind {
    /// The folder the kind's documents live under, as a domain-relative
    /// prefix: empty for engrams, which live at the domain root.
    pub fn root(self) -> &'static str {
        match self {
            ContentKind::Engram => "",
            ContentKind::Reflection => "reflections/",
        }
    }

    /// The domain-relative folder the kind's files (attachments) live under.
    pub fn assets_dir(self) -> &'static str {
        match self {
            ContentKind::Engram => crate::attachment::ASSETS_PREFIX,
            ContentKind::Reflection => "reflections/assets/",
        }
    }

    /// Whether verify and the engram parser read documents of this kind.
    pub fn verified(self) -> bool {
        match self {
            ContentKind::Engram => true,
            ContentKind::Reflection => false,
        }
    }

    /// The links a document of this kind uses for its references.
    pub fn link_dialect(self) -> crate::relink::LinkDialect {
        match self {
            ContentKind::Engram => crate::relink::LinkDialect::Addressed,
            ContentKind::Reflection => crate::relink::LinkDialect::Relative,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_engram_lives_at_the_root_beside_its_assets_and_is_verified() {
        assert_eq!(ContentKind::Engram.root(), "");
        assert_eq!(
            ContentKind::Engram.assets_dir(),
            crate::attachment::ASSETS_PREFIX
        );
        assert!(ContentKind::Engram.verified());
        assert_eq!(
            ContentKind::Engram.link_dialect(),
            crate::relink::LinkDialect::Addressed
        );
    }

    #[test]
    fn a_reflection_lives_under_reflections_and_is_never_verified() {
        assert_eq!(ContentKind::Reflection.root(), "reflections/");
        assert_eq!(ContentKind::Reflection.assets_dir(), "reflections/assets/");
        assert!(!ContentKind::Reflection.verified());
        assert_eq!(
            ContentKind::Reflection.link_dialect(),
            crate::relink::LinkDialect::Relative
        );
    }
}
