//! Kept texts for the people who may handle them (the layout is in
//! [`crystalline_core::kept`]).
//!
//! A kept text holds what a person typed into a page or an engram, so it
//! goes only to somebody who may write that source: a Reflection text needs
//! `curate` on the domain's Reflection, an engram text needs the right to
//! write engrams there. Each entry is decided by its own kind, and a text
//! kept from a review draft goes to the draft's owner only. Neither right
//! asks the Reflection's state: it is often off exactly because a switch-off
//! is why the text was kept.

use crystalline_core::kept::{self, KeptKind, KeptText};

use super::*;
use crate::scope::{DomainRight, ReflectionCaller, ReflectionRight, Scope};

/// The refusal for a caller who may handle neither kind of kept text.
const NO_KEPT_RIGHT: &str = "kept texts need write access to this domain's engrams or curate \
                             access to its Reflection";

/// Which kinds of kept text a caller may handle on one domain.
#[derive(Clone, Copy, Debug)]
struct KeptRights {
    engram: bool,
    reflection: bool,
}

impl KeptRights {
    fn allows(self, kind: KeptKind) -> bool {
        match kind {
            KeptKind::Engram => self.engram,
            KeptKind::Reflection => self.reflection,
        }
    }
}

impl Engine {
    /// The kept texts of `domain` that `scope` may handle, oldest first.
    /// [`EngineError::Forbidden`] when it may handle neither kind, and the
    /// usual unknown-domain answer for a domain it may not see.
    pub async fn kept_texts(&self, domain: &str, scope: &Scope) -> Result<Vec<KeptText>> {
        let rights = self.kept_rights(domain, scope).await?;
        Ok(self.kept_of(domain, scope, rights))
    }

    /// One kept text of `domain` with its text. [`EngineError::NotFound`]
    /// for an id that names none, and for one of a kind `scope` may not
    /// handle, so a refusal tells nothing about what is kept.
    pub async fn kept_text(
        &self,
        domain: &str,
        id: &str,
        scope: &Scope,
    ) -> Result<(KeptText, String)> {
        let found = self.kept_entry(domain, id, scope).await?;
        let text = kept::read(&found).map_err(|source| EngineError::Io {
            path: found.file.display().to_string(),
            source,
        })?;
        Ok((found, text))
    }

    /// Delete one kept text of `domain`, with the same rights and answers
    /// as [`Engine::kept_text`]. Only ever on a person's request.
    pub async fn drop_kept_text(&self, domain: &str, id: &str, scope: &Scope) -> Result<()> {
        let found = self.kept_entry(domain, id, scope).await?;
        let root = self.kept_root()?;
        kept::remove(&root, &found).map_err(|source| EngineError::Io {
            path: found.file.display().to_string(),
            source,
        })
    }

    async fn kept_entry(&self, domain: &str, id: &str, scope: &Scope) -> Result<KeptText> {
        let rights = self.kept_rights(domain, scope).await?;
        self.kept_of(domain, scope, rights)
            .into_iter()
            .find(|k| k.id == id)
            .ok_or_else(|| {
                EngineError::NotFound(format!("no kept text '{id}' in domain '{domain}'"))
            })
    }

    /// What `scope` may handle on `domain`: refuses a domain it may not see
    /// first (one it reaches only through the Reflection counts as seen, as
    /// on every Reflection route), then a caller with neither right.
    async fn kept_rights(&self, domain: &str, scope: &Scope) -> Result<KeptRights> {
        let caller = ReflectionCaller::person(scope.clone(), "");
        let (reflection, engrams_visible) = self.caller_reflection_right(domain, &caller).await?;
        let rights = KeptRights {
            engram: engrams_visible && self.write_right(scope, domain).await? >= DomainRight::Write,
            reflection: reflection >= ReflectionRight::Curate,
        };
        if !rights.engram && !rights.reflection {
            return Err(EngineError::Forbidden(NO_KEPT_RIGHT.to_string()));
        }
        Ok(rights)
    }

    /// `domain`'s kept texts of the kinds `rights` allows: the domain's
    /// own, and the ones kept from `scope`'s own review drafts. Another
    /// person's draft is theirs alone, whatever the rights. None when this
    /// process knows no state folder.
    fn kept_of(&self, domain: &str, scope: &Scope, rights: KeptRights) -> Vec<KeptText> {
        let Some(root) = self.kept_dir() else {
            return Vec::new();
        };
        let mine = crate::scope::overlay_actor(scope);
        kept::scan(&root)
            .into_iter()
            .filter(|k| {
                k.domain == domain
                    && !k.removed
                    && rights.allows(k.kind)
                    && (k.owner.is_none() || k.owner == mine)
            })
            .collect()
    }

    /// Move a removed domain's kept texts aside, so a domain registered
    /// later under the same name never reaches them; `crystalline kept list`
    /// still shows them, marked as from a removed domain. Best effort, like
    /// the journal sweep beside it: a failure is logged.
    pub(crate) fn set_aside_kept(&self, name: &str) {
        let Some(root) = self.kept_dir() else {
            return;
        };
        match kept::set_aside(&root, name, chrono::Utc::now()) {
            Ok(Some(to)) => tracing::info!(
                domain = name,
                kept = %to.display(),
                "the removed domain's kept texts are set aside here"
            ),
            Ok(None) => {}
            Err(err) => tracing::warn!(
                domain = name,
                %err,
                "the removed domain's kept texts could not be set aside; a domain registered under this name would reach them"
            ),
        }
    }

    fn kept_root(&self) -> Result<std::path::PathBuf> {
        self.kept_dir()
            .ok_or_else(|| EngineError::Internal("this process knows no state folder".to_string()))
    }
}
