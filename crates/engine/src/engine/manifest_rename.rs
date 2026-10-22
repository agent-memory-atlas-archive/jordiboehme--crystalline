//! A rename a domain's MANIFEST made, answered: finished (the links that
//! still use an old name are respelled, as a journaled respell-only rename)
//! or kept (the question is closed and the alias stays), and the question
//! that closes on its own once no link here uses an old name any more.

use crystalline_core::config::{RenameAnswer, RenameQuestion};
use crystalline_core::relink::BodyGate;

use super::rename_domain::{
    RESPELL_HINT, distinct_without, finish_elsewhere_hint, finish_hint, io_error,
    may_see_server_paths, rename_caller, respell_old,
};
use super::*;
use crate::rename::RenameJournal;

impl Engine {
    /// Finish a rename the domain's MANIFEST made: the domain keeps its local
    /// name and its configuration, and every link and `crystalline://` URL
    /// that spells it by the name the question started from, an alias or a
    /// local name only this machine uses is respelled to the name the
    /// MANIFEST declares now, in every domain the caller can write, its
    /// Reflection pages included ([`Engine::rename_domain`]'s relink step,
    /// alone). A team domain takes the rewrites as local changes for its next
    /// share, a reviewing domain as the caller's drafts. The step runs under
    /// the rename journal, so a crash in the middle is finished at the next
    /// start, and the question is answered "finished" before the journal
    /// goes.
    ///
    /// Gated as a rename: an instance admin, or the owner of a private
    /// domain. Refused on a read-only instance, for a domain with no open
    /// question, while the name the MANIFEST declares reaches another domain
    /// here, and for everything a rename refuses before it looks at a domain.
    ///
    /// The report: `{ domain, from, to, rewritten: [{domain, engrams,
    /// references}], left_behind: [{domain, path, references}] }`.
    pub async fn finish_manifest_rename(
        &self,
        domain: &str,
        scope: &crate::scope::Scope,
    ) -> Result<Value> {
        let (local, question) = self.open_rename_question(domain, scope).await?;
        self.refuse_rename_off_machine(scope).await?;
        let privacy_hidden = self.hidden_domains(scope).await?.unwrap_or_default();
        let table = self.name_table_now().await;
        let to = question.to.clone();
        if table.resolve(&to) != Some(local.as_str()) {
            return Err(EngineError::Conflict(format!(
                "'{to}' does not reach domain '{local}' here (another domain answers to it), so \
                 its links keep their spelling; rename one of the two domains first"
            )));
        }
        let _slot =
            self.take_rename_slot(&local, &to, RESPELL_HINT.to_string(), &privacy_hidden)?;
        let _admin = self.domain_admin().await;
        let _fence = self.fence_joins().await;
        let state_dir = self.journal_state_dir()?;
        let nobody = || DomainAudience::Accounts(HashSet::new());
        let mut pending = RenameJournal::load(&state_dir).map_err(io_error)?;
        if let Some(journal) = pending.take() {
            if journal.respell_only && journal.old == local {
                // Another index's journal is neither run nor dropped here.
                if let Some(why) = self.foreign_journal(&journal, &state_dir).await? {
                    return Err(EngineError::Conflict(format!(
                        "the rename of '{local}' to '{to}' that has not finished belongs to \
                         another index{}; {}",
                        if may_see_server_paths(scope) {
                            format!(" ({why})")
                        } else {
                            String::new()
                        },
                        finish_elsewhere_hint(&journal)
                    )));
                }
                if journal.new == to {
                    let _origins = self.lock_rename_origins(&journal).await;
                    return self
                        .finish_rename(journal, &state_dir, false, nobody())
                        .await;
                }
                // A respell for another name than the question asks about
                // now: dropped, and a fresh one is written below.
                self.drop_respell_journal(&state_dir, &journal);
            } else {
                pending = Some(journal);
            }
        }
        if let Some(journal) = pending {
            return Err(EngineError::Conflict(
                if privacy_hidden.contains(&journal.old) || privacy_hidden.contains(&journal.new) {
                    "a rename is still finishing; try again in a moment".to_string()
                } else {
                    format!(
                        "the rename of '{}' to '{}' has not finished; {}, then try again",
                        journal.old,
                        journal.new,
                        finish_hint(&journal)
                    )
                },
            ));
        }
        // The answer is written into the configuration at the end.
        self.refuse_a_config_that_does_not_parse()?;
        let entry = self.domain_entry(&local)?;
        let (old_spellings, relink_spellings) =
            respell_spellings(&local, &entry, &question, &table);
        let journal = RenameJournal {
            version: 1,
            old: local.clone(),
            new: to.clone(),
            local_only: false,
            respell_only: true,
            origin: entry.name_origin.unwrap_or(NameOrigin::Explicit),
            old_spellings,
            relink_spellings,
            canonical: Some(to),
            caller: rename_caller(scope),
            writable: self.writable_domains(scope).await?,
            manifest_draft: false,
            manifest_kept: false,
            relinked: None,
            owner: Some(self.rename_owner(&state_dir).await?),
            done: Vec::new(),
        };
        let _origins = self.lock_rename_origins(&journal).await;
        journal.save(&state_dir).map_err(io_error)?;
        self.finish_rename(journal, &state_dir, false, nobody())
            .await
    }

    /// Keep the links of a rename the domain's MANIFEST made as they are:
    /// the question is answered "keep", the old name stays an alias here, and
    /// nothing else changes. Gated and refused as
    /// [`Engine::finish_manifest_rename`] is, apart from the checks only a
    /// journaled step needs. The answer: `{ domain, from, to, answered:
    /// "keep" }`.
    pub async fn keep_manifest_rename(
        &self,
        domain: &str,
        scope: &crate::scope::Scope,
    ) -> Result<Value> {
        let (local, question) = self.open_rename_question(domain, scope).await?;
        if !self.answer_rename_question(&local, RenameAnswer::Keep, Some(&question.to))? {
            return Err(EngineError::Conflict(format!(
                "the rename of domain '{local}' was answered or changed meanwhile; look again"
            )));
        }
        // A respell a failed finish left behind is not run after a keep.
        self.drop_stale_respell_journal().await;
        Ok(json!({
            "domain": local,
            "from": question.from,
            "to": question.to,
            "answered": "keep",
        }))
    }

    /// Finish every open MANIFEST rename on this instance as the machine
    /// owner, for `crystalline doctor --fix`. A domain whose finish is
    /// refused or fails is listed with the reason and the rest go on. The
    /// answer: `{ finished: [the report of each], failed: [{domain, error}]
    /// }`, in name order.
    pub async fn finish_rename_questions(&self) -> Result<Value> {
        if self.read_only {
            return Err(EngineError::ReadOnly);
        }
        self.drop_stale_respell_journal().await;
        let mut open: Vec<String> = self
            .config
            .read()
            .unwrap()
            .domains
            .iter()
            .filter(|(_, entry)| {
                entry
                    .rename_question
                    .as_ref()
                    .is_some_and(|question| question.answered.is_none())
            })
            .map(|(name, _)| name.clone())
            .collect();
        open.sort();
        let (mut finished, mut failed) = (Vec::new(), Vec::new());
        for name in open {
            match self
                .finish_manifest_rename(&name, &crate::scope::Scope::Unrestricted)
                .await
            {
                Ok(report) => finished.push(report),
                Err(e) => failed.push(json!({ "domain": name, "error": e.to_string() })),
            }
        }
        Ok(json!({ "finished": finished, "failed": failed }))
    }

    /// The local name `domain` resolves to for `scope` and its open rename
    /// question, after the gate both answers to a question pass: a writable
    /// instance, a caller who may rename the domain, and a question to
    /// answer.
    async fn open_rename_question(
        &self,
        domain: &str,
        scope: &crate::scope::Scope,
    ) -> Result<(String, RenameQuestion)> {
        if self.read_only {
            return Err(EngineError::ReadOnly);
        }
        self.refuse_hidden_admin(domain, scope).await?;
        let hidden = self.hidden_for(scope).await?;
        let table = self.name_table_now().await;
        let local = names::localize_in(&table, domain, &hidden);
        self.require_domain_owner_refusing(&local, scope, Engine::rename_refusal(&local))
            .await?;
        let question = self.rename_question(&local).ok_or_else(|| {
            EngineError::Conflict(format!(
                "domain '{local}' has no rename from its MANIFEST waiting for an answer"
            ))
        })?;
        Ok((local, question))
    }

    /// Whether `scope` may rename `domain` (its local name): the gate
    /// [`Engine::rename_domain`] and the two answers to a rename question
    /// pass.
    pub(super) async fn may_rename(&self, domain: &str, scope: &crate::scope::Scope) -> bool {
        self.require_domain_owner_refusing(domain, scope, Engine::rename_refusal(domain))
            .await
            .is_ok()
    }

    /// Every open rename question, as `(local name, entry, question)`.
    fn open_rename_questions(&self) -> Vec<(String, DomainEntry, RenameQuestion)> {
        self.config
            .read()
            .unwrap()
            .domains
            .iter()
            .filter_map(|(name, entry)| {
                let question = entry.rename_question.clone()?;
                question
                    .answered
                    .is_none()
                    .then(|| (name.clone(), entry.clone(), question))
            })
            .collect()
    }

    /// The domains whose open rename question still has links here under an
    /// old name: what a pull is measured against. Asked before a pull, so
    /// the pull settles only a question whose old spellings the pulled files
    /// took away, never one whose links were respelled here (by a person's
    /// edit or an agent's). Empty, and no scan, while no question is open. A
    /// scan that fails counts the domain as still spelled, as it does at
    /// the settle.
    pub async fn rename_questions_still_spelled(&self) -> HashSet<String> {
        let open = self.open_rename_questions();
        let mut spelled = HashSet::new();
        if open.is_empty() {
            return spelled;
        }
        let table = self.name_table_now().await;
        for (local, entry, question) in open {
            let (_, spellings) = respell_spellings(&local, &entry, &question, &table);
            if self
                .spells_any(&spellings, &question.to)
                .await
                .unwrap_or(true)
            {
                spelled.insert(local);
            }
        }
        spelled
    }

    /// Close every open rename question among `spelled_before` whose links
    /// now match: no engram and no Reflection page here spells the domain by
    /// a name the respell would replace any more, which is the state a
    /// teammate's finished rename leaves once its respelled files arrive
    /// with a pull. `spelled_before` is
    /// [`Engine::rename_questions_still_spelled`] from before that pull. The
    /// question is answered "finished" and its nudges forgotten. A domain in
    /// `busy` (a rename holds it) is left for a later pass.
    pub(super) async fn close_settled_rename_questions(
        &self,
        busy: &HashSet<String>,
        spelled_before: &HashSet<String>,
    ) -> Result<()> {
        let open: Vec<(String, DomainEntry, RenameQuestion)> = self
            .open_rename_questions()
            .into_iter()
            .filter(|(name, _, _)| !busy.contains(name) && spelled_before.contains(name))
            .collect();
        if open.is_empty() {
            return Ok(());
        }
        let table = self.name_table_now().await;
        for (local, entry, question) in open {
            let (_, spellings) = respell_spellings(&local, &entry, &question, &table);
            if self.spells_any(&spellings, &question.to).await? {
                continue;
            }
            if self.answer_rename_question(&local, RenameAnswer::Finished, Some(&question.to))? {
                tracing::info!(
                    "the rename of domain '{local}' from '{}' to '{}' is settled: no link here \
                     uses the old name any more",
                    question.from,
                    question.to
                );
            }
        }
        Ok(())
    }

    /// Whether any engram's own text or any Reflection page here still
    /// spells a domain as one of `spellings`, counted with the rewrite a
    /// respell to `to` applies. An engram that cannot be read, or a domain
    /// whose pages cannot be, counts as still spelling them, so nothing is
    /// closed on a guess.
    async fn spells_any(&self, spellings: &[String], to: &str) -> Result<bool> {
        if spellings.is_empty() {
            return Ok(false);
        }
        let found = {
            let store = self.store.lock().await;
            store.engrams_referencing_domains(spellings).await?
        };
        for (domain, path) in found {
            // An engram the index names but that cannot be read counts as
            // still spelling them, as an unreadable page set does.
            let Ok(Some((_, _, text))) = self.base_text(&domain, &path).await else {
                return Ok(true);
            };
            if respell_old(&text, spellings, to, BodyGate::Lossless).1 > 0 {
                return Ok(true);
            }
        }
        let named = |domain: &str| spellings.iter().any(|s| s == domain);
        for domain in self.registered_domain_entries_now().await.into_keys() {
            if !self.reflection_effective(&domain).await.unwrap_or(false) {
                continue;
            }
            if !matches!(self.read_source(&domain), ContentSource::File { .. }) {
                continue;
            }
            let Ok((_, rows)) = self.reflection_rows(&domain).await else {
                return Ok(true);
            };
            for row in rows {
                if respell_old(&row.content, spellings, to, BodyGate::Split).1 > 0
                    || crystalline_core::reflection::source_domains_named(&row.content, &named) > 0
                {
                    return Ok(true);
                }
            }
        }
        Ok(false)
    }

    /// Whether a respell journal still does what its question asks: the
    /// question is open and names the journal's new name, and the domain's
    /// MANIFEST still declares it.
    pub(super) async fn respell_still_asked(&self, journal: &RenameJournal) -> bool {
        let asked = self
            .rename_question(&journal.old)
            .is_some_and(|question| question.to == journal.new);
        asked && self.name_table_now().await.canonical(&journal.old) == Some(journal.new.as_str())
    }

    /// Delete a respell journal nobody asks for any more. Safe at any point:
    /// a respell moves nothing, and every link it already wrote resolves.
    pub(super) fn drop_respell_journal(&self, state_dir: &Path, journal: &RenameJournal) {
        match RenameJournal::remove(state_dir) {
            Ok(()) => tracing::info!(
                "dropped the unfinished respell of domain '{}' to '{}': its rename question \
                 was answered, dropped or moved on to another name",
                journal.old,
                journal.new
            ),
            Err(e) => tracing::warn!(
                "the unfinished respell of domain '{}' to '{}' is not asked for any more, but \
                 its journal could not be deleted ({e})",
                journal.old,
                journal.new
            ),
        }
    }

    /// Drop the respell journal waiting in the state directory when nobody
    /// asks for it any more ([`Engine::respell_still_asked`]). Nothing while
    /// a rename runs in this process: that rename may be the respell, and its
    /// own end deals with its journal.
    pub(super) async fn drop_stale_respell_journal(&self) {
        if self.rename_slot.lock().unwrap().is_some() {
            return;
        }
        let Ok(state_dir) = self.journal_state_dir() else {
            return;
        };
        let Ok(Some(journal)) = RenameJournal::load(&state_dir) else {
            return;
        };
        if !journal.respell_only
            || !self.holds_state_dir()
            || self.respell_still_asked(&journal).await
        {
            return;
        }
        // Only this machine's own index and configuration drop it, as only
        // they run it: an engine opened with another `--db` or `--config`
        // leaves it for them, with recovery's warning.
        let foreign = match self.off_machine().await {
            Ok(Some(why)) => Some(why),
            Ok(None) => match self.foreign_journal(&journal, &state_dir).await {
                Ok(why) => why,
                Err(e) => Some(e.to_string()),
            },
            Err(e) => Some(e.to_string()),
        };
        if let Some(why) = foreign {
            tracing::warn!(
                "the unfinished respell of domain '{}' to '{}' is not asked for any more, but \
                 it is left alone here: {why}. To drop it, {}",
                journal.old,
                journal.new,
                finish_elsewhere_hint(&journal)
            );
            return;
        }
        self.drop_respell_journal(&state_dir, &journal);
    }

    /// The end of a respell: the question is answered, then the journal
    /// goes. Nothing moved, so the domain keeps its configuration entry, its
    /// origin lock and its name, and nobody is told a name went away.
    pub(super) fn finish_respell(&self, journal: RenameJournal, state_dir: &Path) -> Result<Value> {
        // Before the journal goes: a crash between the two answers it again
        // at the next start, when the step itself is already done.
        self.answer_rename_question(&journal.old, RenameAnswer::Finished, Some(&journal.new))?;
        if let Err(e) = RenameJournal::remove(state_dir) {
            tracing::error!(
                "the links of domain '{}' are respelled to '{}', but the journal could not be \
                 deleted ({e}); the next start finishes it again",
                journal.old,
                journal.new
            );
        }
        let from = journal
            .old_spellings
            .first()
            .cloned()
            .unwrap_or_else(|| journal.old.clone());
        let relinked = journal.relinked.unwrap_or_default();
        Ok(json!({
            "domain": journal.old,
            "from": from,
            "to": journal.new,
            "rewritten": relinked.rewritten,
            "left_behind": relinked.left_behind,
        }))
    }

    /// The refusals every rename meets before it looks at a domain: another
    /// process holds this machine's state directory, this machine's own
    /// index and configuration cannot be named, or this engine opened
    /// another index or configuration (`--db`, `--config`) than this
    /// machine's own.
    pub(super) async fn refuse_rename_off_machine(
        &self,
        scope: &crate::scope::Scope,
    ) -> Result<()> {
        // A rename moves this machine's state folders and writes its
        // configuration under a journal in the state directory: only the
        // process that holds that directory runs one, so no two processes
        // move the same folders or run one journal at once.
        if !self.holds_state_dir() {
            return Err(EngineError::Conflict(
                "another Crystalline process (the daemon) holds this machine's state directory, \
                 which a rename needs; rename through it, or stop it with `crystalline ctl \
                 shutdown` and rename again"
                    .to_string(),
            ));
        }
        // Nor while this machine's own index cannot be named: nothing could
        // tell whether the engine opened it.
        if let Some(crate::rename::MachineOwner::Unknown(reason)) = &self.machine_owner {
            return Err(EngineError::Conflict(format!(
                "this machine's own index and configuration cannot be named ({}), so renames \
                 are off in this Crystalline. Nothing was renamed. Fix the configuration so it \
                 loads, then restart the daemon or the MCP server",
                if may_see_server_paths(scope) {
                    reason.as_str()
                } else {
                    "its configuration does not load"
                }
            )));
        }
        // Not over an index `--db` or `--config` named instead of this
        // machine's own: the steps would move this machine's state folders
        // and write its configuration while its own index keeps the old
        // name.
        if let Some(why) = self.off_machine().await? {
            return Err(EngineError::Conflict(format!(
                "a rename moves this machine's state folders and writes its configuration, so \
                 it runs only against this machine's own index and configuration, and {}. \
                 Nothing was renamed. Rename in a Crystalline started without --db and --config",
                if may_see_server_paths(scope) {
                    why
                } else {
                    "this instance opened another index or configuration".to_string()
                }
            )));
        }
        Ok(())
    }
}

/// The spellings a respell of `local` for `question` replaces: every one
/// (`old_spellings`, the question's `from` first, so a report can name it),
/// and the ones that reach `local` through `table` today, which are the ones
/// it rewrites. The question's `from`, the aliases and the local name, never
/// the name the links get.
pub(super) fn respell_spellings(
    local: &str,
    entry: &DomainEntry,
    question: &RenameQuestion,
    table: &crystalline_core::names::NameTable,
) -> (Vec<String>, Vec<String>) {
    let mut old_spellings = vec![question.from.clone()];
    old_spellings.extend(entry.aliases.iter().cloned());
    old_spellings.push(local.to_string());
    let old_spellings = distinct_without(old_spellings, &question.to);
    let reaching = old_spellings
        .iter()
        .filter(|s| table.resolve(s) == Some(local))
        .cloned()
        .collect();
    (old_spellings, reaching)
}
