//! The Reflection's engine side: the switch, the home check, the one gate
//! every reflection verb passes, and the verbs themselves.

use std::path::PathBuf;

use crystalline_core::reflection::{ReflectionHome, ReflectionState};

use super::*;
use crate::scope::{ReflectionCaller, ReflectionRight, Scope, reflection_right_word};

/// What the gate hands a reflection verb.
#[derive(Debug, Clone)]
#[allow(dead_code)] // No reader until the reflection verbs land.
pub(crate) struct ReflectionAccess {
    /// The domain root (the Reflection is `root/reflections`).
    pub root: PathBuf,
    /// The domain's index id.
    pub domain_id: DomainId,
    /// The caller's reflection right.
    pub right: ReflectionRight,
    /// Whether the caller may read engrams here; source engrams are stripped
    /// from every answer when not.
    pub engrams_visible: bool,
    /// Where the Reflection lives.
    pub home: ReflectionHome,
}

/// The facts the switch is screened against, gathered before any write lock.
#[derive(Debug, Clone, Default)]
pub(crate) struct SwitchFacts {
    pub virtual_domain: bool,
    /// The folders in the domain root that spell `reflections` in any letter
    /// case, sorted. More than one cannot be one Reflection: their files
    /// would land on the same rows.
    pub folders: Vec<String>,
    /// The engrams under `reflections/` that wait to move out, sorted: the
    /// files [`crystalline_core::is_pending_engram`] calls pending.
    pub engrams: Vec<String>,
    pub origin: bool,
    /// This instance's `service.public_url`, canonical.
    pub own_url: Option<String>,
    /// Paths under `reflections/` the team's copy still holds (the origin
    /// base snapshot), sorted. Empty for a domain with no origin.
    pub team_copy: Vec<String>,
}

fn declares_on(source: &str) -> bool {
    crystalline_core::parse_engram(source)
        .map(|e| crystalline_core::Manifest::from_engram(&e, source).reflection())
        .unwrap_or_default()
        == crystalline_core::ReflectionSwitch::On
}

fn declared_home(source: &str) -> Option<String> {
    let engram = crystalline_core::parse_engram(source).ok()?;
    crystalline_core::Manifest::from_engram(&engram, source)
        .reflection_home()
        .map(str::to_string)
}

/// The refusal of a switch-on for a virtual domain.
pub(crate) fn virtual_refusal() -> EngineError {
    EngineError::Invalid(
        "Reflection needs a domain kept as files; this domain is virtual".to_string(),
    )
}

/// Screen a MANIFEST change that is about to be written. Only a change that
/// switches Reflection ON is screened; switching it off is always allowed
/// (the files stay where they are).
pub(crate) fn screen_switch(before: &str, after: &str, facts: &SwitchFacts) -> Result<()> {
    if declares_on(before) || !declares_on(after) {
        return Ok(());
    }
    if facts.virtual_domain {
        return Err(virtual_refusal());
    }
    if facts.folders.len() > 1 {
        let named: Vec<String> = facts.folders.iter().map(|f| format!("{f}/")).collect();
        return Err(EngineError::Invalid(format!(
            "this domain has {} folders that differ only in letter case: {}. Reflection would read them as one folder and their files would collide. Keep one (move the files of the others out), then switch Reflection on",
            facts.folders.len(),
            named.join(", ")
        )));
    }
    if !facts.engrams.is_empty() {
        return Err(EngineError::Invalid(format!(
            "these engrams live in reflections/, which Reflection would take over: {}. Move them to another folder first (move_engram), then switch Reflection on",
            facts.engrams.join(", ")
        )));
    }
    if !facts.team_copy.is_empty() {
        return Err(EngineError::Invalid(format!(
            "the team's copy of this domain still holds these files in reflections/: {}. Share the change that moves them out first (share_changes), then switch Reflection on",
            facts.team_copy.join(", ")
        )));
    }
    screen_home(after, facts)
}

/// The home half of [`screen_switch`]: a domain connected to GitHub needs
/// this instance's `service.public_url` as its `reflection_home`. Also the
/// whole screen of the home refill, where the switch is already on.
pub(crate) fn screen_home(after: &str, facts: &SwitchFacts) -> Result<()> {
    if facts.origin {
        let Some(own) = facts.own_url.as_deref() else {
            return Err(EngineError::Invalid(
                "switch Reflection on at the team server: this instance has no service.public_url, so it cannot be the home of a shared domain's Reflection".to_string(),
            ));
        };
        // The same rule the stored key meets, so a home this instance writes
        // is always one it reads back as its own.
        if let Err(why) = crystalline_core::validate_reflection_home(own) {
            return Err(EngineError::Invalid(format!(
                "this instance's service.public_url cannot be a Reflection's home: {why}"
            )));
        }
        if declared_home(after).as_deref() != Some(own) {
            return Err(EngineError::Invalid(format!(
                "switch Reflection on in the domain policies at the team server, so its home is filled in (reflection_home: {own})"
            )));
        }
    }
    Ok(())
}

/// The PACT a freshly switched-on Reflection starts with: the three things
/// the pact agrees on, as headings for people and the agent to fill in. Each
/// heading carries its section id line, the page marker that keeps an
/// unedited pact the Reflection's: read as an engram it would hold the
/// switch pending after a rebuild or a switch-off and on again (R48).
pub(crate) fn pact_starter(domain: &str) -> String {
    let text = format!(
        "---\ntitle: How we write about {domain}\n---\n\n# How we write about {domain}\n\nThis is the agreement between the people and the agents who work on this domain's Reflection. Change it like any page; the agent reads every change.\n\n## Audience\n\n- Who reads these pages, and what they already know.\n\n## Level of detail\n\n- How deep the pages go, and what they leave to the engrams.\n\n## Structure\n\n- *.md\n"
    );
    let (with_ids, _) = crystalline_core::reflection::assign_ids(
        &text,
        &BTreeSet::new(),
        &mut crystalline_core::reflection::random_section_id,
    );
    with_ids
}

/// The folders directly under `root` whose name is `reflections` in any
/// letter case, sorted. A root that cannot be read has none.
fn reflection_folders(root: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    let mut folders: Vec<String> = entries
        .flatten()
        .filter(|entry| entry.file_type().is_ok_and(|t| t.is_dir()))
        .filter_map(|entry| entry.file_name().to_str().map(str::to_string))
        .filter(|name| name.eq_ignore_ascii_case(crystalline_core::reflection::REFLECTIONS_DIR))
        .collect();
    folders.sort();
    folders
}

impl Engine {
    /// This instance's `service.public_url` in its canonical spelling (the
    /// origin in ascii, default port dropped, the path with no trailing
    /// slash), the spelling [`crystalline_core::validate_reflection_home`]
    /// holds the stored key to, so a home this instance writes compares
    /// equal to the one it reads back. `None` when unset or not a valid base.
    fn own_public_url(&self) -> Option<String> {
        crate::settings::public_base(&self.config.read().unwrap()).map(|base| base.to_string())
    }

    /// The engrams under `reflections/` that wait to move out, sorted: the
    /// one predicate [`crystalline_core::is_pending_engram`] asked of the
    /// files the sync asks it of ([`crystalline_index::pending_engrams`]), so
    /// what this names and what keeps the switch pending never differ. The
    /// file reads run on the blocking pool, like [`Engine::reflection_mode`].
    async fn pending_engrams(&self, domain: &str) -> Result<Vec<String>> {
        let ContentSource::File { root } = self.read_source(domain) else {
            return Ok(Vec::new());
        };
        let recorded = self.recorded_paths(domain).await?;
        tokio::task::spawn_blocking(move || {
            crystalline_index::pending_engrams(&root, recorded.iter())
        })
        .await
        .map_err(|e| {
            EngineError::Internal(format!(
                "the engrams in the Reflection folder of '{domain}' could not be read: {e}"
            ))
        })
    }

    /// The facts [`screen_switch`] reads, for one domain. Only a switch reads
    /// them: the team copy comes from the origin's base snapshot on disk,
    /// which the gate of every reflection verb has no need for.
    pub(crate) async fn switch_facts(&self, domain: &str) -> Result<SwitchFacts> {
        let entry = self.domain_entry(domain)?;
        let own_url = self.own_public_url();
        let origin = entry.origin.is_some();
        let ContentSource::File { root } = self.read_source(domain) else {
            return Ok(SwitchFacts {
                virtual_domain: true,
                origin,
                own_url,
                ..Default::default()
            });
        };
        let folders = reflection_folders(&root);
        let engrams = self.pending_engrams(domain).await?;
        // The base snapshot is read for a domain with an origin only, and a
        // missing or unreadable one holds nothing.
        let mut team_copy: Vec<String> = Vec::new();
        if origin
            && let Ok(dir) = self.origin_state_dir(domain)
            && let Ok(Some(state)) = crystalline_remote::state::OriginState::load(&dir)
        {
            team_copy = state
                .files
                .keys()
                .filter(|p| crystalline_core::reflection::is_under_reflections(p))
                .cloned()
                .collect();
            team_copy.sort();
        }
        Ok(SwitchFacts {
            virtual_domain: false,
            folders,
            engrams,
            origin,
            own_url,
            team_copy,
        })
    }

    /// Screen a MANIFEST text about to be written to `domain` by a raw
    /// writer (the MANIFEST editor, a save, a restore, a move onto the
    /// MANIFEST) with [`screen_switch`]. `before` is the text it replaces,
    /// read from the domain when `None`. The facts are gathered only for a
    /// text that switches Reflection on, so every other MANIFEST write costs
    /// one parse.
    pub(crate) async fn screen_manifest_write(
        &self,
        domain: &str,
        before: Option<&str>,
        after: &str,
    ) -> Result<()> {
        if !declares_on(after) {
            return Ok(());
        }
        let before = match before {
            Some(text) => text.to_string(),
            None => self.manifest_source(domain).await?.markdown,
        };
        if declares_on(&before) {
            return Ok(());
        }
        let facts = self.switch_facts(domain).await?;
        screen_switch(&before, after, &facts)
    }

    /// Write `reflections/PACT.md` from the starter when the domain has none.
    /// A folder spelled in another letter case is the Reflection's folder
    /// (the classifier's rule), so the pact goes into it rather than beside
    /// it, and a pact spelled in another case counts as the pact.
    pub(crate) async fn seed_pact(&self, domain: &str) -> Result<()> {
        let ContentSource::File { root } = self.read_source(domain) else {
            return Ok(());
        };
        let folder_name = reflection_folders(&root)
            .into_iter()
            .next()
            .unwrap_or_else(|| crystalline_core::reflection::REFLECTIONS_DIR.to_string());
        let folder = root.join(folder_name);
        let has_pact = std::fs::read_dir(&folder).is_ok_and(|entries| {
            entries.flatten().any(|entry| {
                entry.file_name().to_str().is_some_and(|n| {
                    n.eq_ignore_ascii_case(crystalline_core::reflection::PACT_FILE)
                })
            })
        });
        if has_pact {
            return Ok(());
        }
        write_file(
            &folder.join(crystalline_core::reflection::PACT_FILE),
            &pact_starter(domain),
        )
    }

    /// What this domain's Reflection is, seen from this instance.
    pub async fn reflection_state(&self, domain: &str) -> Result<ReflectionState> {
        if self.reflection_switch(domain) == crystalline_core::ReflectionSwitch::Off {
            return Ok(ReflectionState::Off);
        }
        // Asked on every gate, so it reads no snapshot from disk: only the
        // index rows, the files they name, the MANIFEST and the configuration.
        let origin = self.domain_entry(domain)?.origin.is_some();
        let ContentSource::File { root } = self.read_source(domain) else {
            return Ok(ReflectionState::Off);
        };
        let engrams = self.pending_engrams(domain).await?;
        if !engrams.is_empty() {
            return Ok(ReflectionState::Pending { engrams });
        }
        let declared = crystalline_core::reflection_home_at(&root);
        match (declared, origin) {
            (Some(home), _) if self.own_public_url().as_deref() == Some(home.as_str()) => {
                Ok(ReflectionState::On {
                    home: ReflectionHome::Here,
                })
            }
            (Some(home), _) => Ok(ReflectionState::Elsewhere { url: home }),
            (None, true) => Ok(ReflectionState::Homeless),
            (None, false) => Ok(ReflectionState::On {
                home: ReflectionHome::Local,
            }),
        }
    }

    /// The one gate of every reflection verb: right, then state, then the
    /// right this verb needs, in that order.
    #[allow(dead_code)] // No caller until the reflection verbs land.
    pub(crate) async fn require_reflection(
        &self,
        domain: &str,
        caller: &ReflectionCaller,
        need: ReflectionRight,
    ) -> Result<ReflectionAccess> {
        let (right, engrams_visible) = self.caller_reflection_right(domain, caller).await?;
        let home = match self.reflection_state(domain).await? {
            ReflectionState::On { home } => home,
            ReflectionState::Off => {
                return Err(EngineError::Refused(format!(
                    "Reflection is off for '{domain}'; its owner switches it on in the domain policies"
                )));
            }
            ReflectionState::Pending { engrams } if engrams_visible => {
                return Err(EngineError::Refused(format!(
                    "Reflection for '{domain}' waits until these engrams leave reflections/: {}",
                    engrams.join(", ")
                )));
            }
            ReflectionState::Pending { .. } => {
                return Err(EngineError::Refused(format!(
                    "Reflection for '{domain}' waits until the engrams in reflections/ are moved out"
                )));
            }
            ReflectionState::Homeless => {
                return Err(EngineError::Refused(
                    "this domain is connected to GitHub and its Reflection has no home yet: switch Reflection on in the domain policies at the team server".to_string(),
                ));
            }
            ReflectionState::Elsewhere { url } => {
                return Err(EngineError::Refused(format!(
                    "this domain's Reflection lives at {url}"
                )));
            }
        };
        if right < need {
            // When the write list is why the right fell short, say so and
            // name the fix.
            if let Some(account) = self
                .reflection_list_refusal(&caller.scope, domain, need)
                .await?
            {
                return Err(EngineError::Forbidden(
                    WriteBlock::WriteList { account }.sentence(domain),
                ));
            }
            return Err(EngineError::Forbidden(format!(
                "your access to the Reflection of '{domain}' is {}, and {} is needed",
                reflection_right_word(right),
                reflection_right_word(need)
            )));
        }
        let ContentSource::File { root } = self.read_source(domain) else {
            return Err(EngineError::Refused(format!(
                "'{domain}' keeps no files for a Reflection"
            )));
        };
        let (domain_id, _) = self.domain_source(domain).await?;
        Ok(ReflectionAccess {
            root,
            domain_id,
            right,
            engrams_visible,
            home,
        })
    }

    /// The Reflection's status for this caller: never a refusal on the
    /// state, only on the right (a domain the caller has no business with
    /// answers as unknown).
    pub async fn reflection_status(
        &self,
        domain: &str,
        caller: &ReflectionCaller,
    ) -> Result<Value> {
        let (right, engrams_visible) = self.caller_reflection_right(domain, caller).await?;
        let state = self.reflection_state(domain).await?;
        let (home, home_url) = match &state {
            ReflectionState::On { home } => (Some(home.as_str()), None),
            ReflectionState::Elsewhere { url } => (Some("elsewhere"), Some(url.clone())),
            _ => (None, None),
        };
        let pending: Vec<String> = match &state {
            ReflectionState::Pending { engrams } if engrams_visible => engrams.clone(),
            _ => Vec::new(),
        };
        Ok(json!({
            "domain": domain,
            "enabled": !matches!(state, ReflectionState::Off),
            "state": state.word(),
            "home": home,
            "home_url": home_url,
            "right": reflection_right_word(right),
            "engrams_visible": engrams_visible,
            "pending_engrams": pending,
        }))
    }

    /// The caller's reflection right on `domain` and whether it reads the
    /// domain's engrams: the one preamble of the gate and of the status. An
    /// unregistered name answers as one, in the caller's scope, never
    /// "Reflection is off"; a domain the caller may neither read nor reflect
    /// on answers the same way, so a private domain's existence is not
    /// revealed.
    async fn caller_reflection_right(
        &self,
        domain: &str,
        caller: &ReflectionCaller,
    ) -> Result<(ReflectionRight, bool)> {
        if self.domain_entry(domain).is_err() {
            self.require_domain(domain, &caller.scope).await?;
        }
        let engrams_visible = self.engrams_visible(&caller.scope, domain).await?;
        // The MCP open tier curates every domain it can see; a private
        // domain stays as invisible to it as to every anonymous caller.
        let right = if caller.open_tier {
            if engrams_visible {
                ReflectionRight::Curate
            } else {
                ReflectionRight::None
            }
        } else {
            self.reflection_right(&caller.scope, domain).await?
        };
        if right == ReflectionRight::None && !engrams_visible {
            return Err(self
                .require_domain(domain, &caller.scope)
                .await
                .err()
                .unwrap_or_else(|| EngineError::NotFound(format!("no domain '{domain}'"))));
        }
        Ok((right, engrams_visible))
    }

    /// Whether `scope` may read engrams in `domain` (`DomainRight::Read` or
    /// more), without an error for a hidden domain.
    pub(crate) async fn engrams_visible(&self, scope: &Scope, domain: &str) -> Result<bool> {
        Ok(!self.hidden_for(scope).await?.contains(domain))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const OFF: &str = "---\ntype: manifest\ntitle: eng\nstatus: stable\n---\n\n# eng\n";
    const ON: &str =
        "---\ntype: manifest\ntitle: eng\nstatus: stable\nreflection: on\n---\n\n# eng\n";

    /// Two spellings of the folder collide on the Reflection's rows, so the
    /// switch-on names both; a filesystem that folds case (the macOS and
    /// Windows defaults) cannot hold both, so the screen is pinned here.
    #[test]
    fn two_spellings_of_the_folder_refuse_the_switch_and_name_both() {
        let facts = SwitchFacts {
            folders: vec!["Reflections".into(), "reflections".into()],
            ..Default::default()
        };
        let err = screen_switch(OFF, ON, &facts).unwrap_err().to_string();
        assert!(
            err.contains("Reflections/") && err.contains("reflections/"),
            "{err}"
        );
        // One folder in any spelling is the Reflection's folder.
        let one = SwitchFacts {
            folders: vec!["Reflections".into()],
            ..Default::default()
        };
        screen_switch(OFF, ON, &one).unwrap();
        // A switch-off is never screened.
        screen_switch(ON, OFF, &facts).unwrap();
    }

    /// The seeded pact carries a section id line under every heading, so an
    /// unedited pact is a marked page and never holds the switch pending.
    #[test]
    fn the_seeded_pact_is_a_marked_page() {
        let tmp = tempfile::tempdir().unwrap();
        let folder = tmp.path().join("reflections");
        std::fs::create_dir_all(&folder).unwrap();
        let pact = pact_starter("eng");
        std::fs::write(folder.join("PACT.md"), &pact).unwrap();
        assert!(
            !crystalline_core::is_pending_engram(tmp.path(), "reflections/PACT.md"),
            "{pact}"
        );
        let ids = crystalline_core::reflection::split_sections(&pact)
            .iter()
            .skip(1)
            .filter(|s| s.id.is_some())
            .count();
        assert_eq!(ids, 3, "{pact}");
        assert_eq!(
            crystalline_core::reflection::structure_globs(&pact),
            vec!["*.md".to_string()]
        );
    }
}
