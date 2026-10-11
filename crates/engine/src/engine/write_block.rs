//! Why a caller cannot write one domain, as one answer every surface asks.
//!
//! The write gates (MCP `refuse_unwritable`, REST `require_domain_write`) and
//! the domain rows that say `read_only: true` all need the same question
//! answered the same way: may this caller write here, and if not, which of
//! the reasons is it. The reasons are ordered. A locked domain refuses
//! everybody, so the lock is named first, even to an account whose write list
//! names the domain.

use super::{Engine, OVERLAY_NEEDS_IDENTITY, Result, read_only_sentence};
use crate::scope::{DomainRight, Scope};

/// Why a write into one domain is refused for one caller.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum WriteBlock {
    /// The domain's MANIFEST says `read_only: on`.
    DomainLocked,
    /// The caller's role or membership allows reading only.
    Role,
    /// The caller's write list does not name the domain, and nothing else
    /// would refuse the write.
    WriteList {
        /// The account whose list it is, as `crystalline users writes` takes it.
        account: String,
    },
    /// The open tier (anonymous, `auth.mcp` off) on a domain that reviews
    /// changes: a draft needs an identity to belong to.
    Reviewing,
}

impl WriteBlock {
    /// The sentence a surface refuses with, naming `domain`.
    pub fn sentence(&self, domain: &str) -> String {
        match self {
            WriteBlock::DomainLocked => read_only_sentence(domain),
            // Visible and not writable means Read: the resolver never answers
            // None for a domain the caller can see, so the level word is
            // always "viewer". Byte for byte the MCP gate's old sentence.
            WriteBlock::Role => format!(
                "your access to '{domain}' is viewer, and editor access is required to change it"
            ),
            WriteBlock::WriteList { account } => format!(
                "'{domain}' is not on the write list of '{account}'; an instance admin changes it \
                 with crystalline users writes"
            ),
            WriteBlock::Reviewing => OVERLAY_NEEDS_IDENTITY.to_string(),
        }
    }
}

impl Engine {
    /// Why `scope` cannot write `domain`, or `None` when it can.
    ///
    /// Asked of a domain the caller may see; the surface's `require_domain`
    /// runs first. In order: the domain lock; the open tier (anonymous with
    /// `auth.mcp` off), which writes through the MCP carve-out wherever
    /// `edit_engram` writes and so is refused only by a reviewing domain;
    /// then the capped write right, with the write list named only when it is
    /// the reason ([`crate::scope::DomainAccess::write_list_excludes`]). A
    /// domain listing marks a row `read_only: true` exactly when this is
    /// `Some`.
    ///
    /// The machine owner ([`Scope::Unrestricted`]) and an engine with no
    /// resolver installed are answered `None` or [`WriteBlock::DomainLocked`],
    /// never an error: both resolve to Own on every domain.
    pub async fn write_block(&self, scope: &Scope, domain: &str) -> Result<Option<WriteBlock>> {
        if self.domain_is_read_only(domain).await {
            return Ok(Some(WriteBlock::DomainLocked));
        }
        if matches!(scope, Scope::Anonymous) && !self.auth_mcp() {
            return Ok(self
                .reviews_changes(domain)
                .then_some(WriteBlock::Reviewing));
        }
        if self.write_right(scope, domain).await? >= DomainRight::Write {
            return Ok(None);
        }
        Ok(Some(
            match self.write_list_refusal(scope, domain, None).await? {
                Some(account) => WriteBlock::WriteList { account },
                None => WriteBlock::Role,
            },
        ))
    }
}
