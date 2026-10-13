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
}

impl ContentKind {
    /// The folder the kind's documents live under, as a domain-relative
    /// prefix: empty for engrams, which live at the domain root.
    pub fn root(self) -> &'static str {
        match self {
            ContentKind::Engram => "",
        }
    }

    /// The domain-relative folder the kind's files (attachments) live under.
    pub fn assets_dir(self) -> &'static str {
        match self {
            ContentKind::Engram => crate::attachment::ASSETS_PREFIX,
        }
    }

    /// Whether verify and the engram parser read documents of this kind.
    pub fn verified(self) -> bool {
        match self {
            ContentKind::Engram => true,
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
    }
}
