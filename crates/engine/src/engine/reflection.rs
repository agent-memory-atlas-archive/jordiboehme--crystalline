//! The Reflection's engine side: the switch, the home check, the one gate
//! every reflection verb passes, and the verbs themselves.

use std::path::PathBuf;

use crystalline_core::reflection as r;
use crystalline_core::reflection::{ReflectionHome, ReflectionState};
use crystalline_core::relink::BodyGate;

use super::*;
use crate::changes::ReflectionChanged;
use crate::collab::session::RoomDoc;
use crate::params::WriteReflectionParams;
use crate::reflection_backup::BackupCause;
use crate::scope::{ReflectionCaller, ReflectionRight, Scope, reflection_right_word};

// The words of the gate's state refusals and of the anonymous comment
// refusal. Public so a surface that answers them in its own terms (REST:
// 409 for a state, 401 for the anonymous visitor) matches these and never
// a copy that could drift from them.

/// The start of the refusal for a Reflection that is switched off; the
/// domain's name follows in quotes.
pub const REFUSED_OFF_START: &str = "Reflection is off for ";
/// The pending refusal's words for a caller who reads engrams; the engram
/// paths follow.
pub const REFUSED_PENDING_NAMED: &str = "waits until these engrams leave reflections/";
/// The pending refusal's words for a caller who does not read engrams: no
/// engram is named.
pub const REFUSED_PENDING: &str = "waits until the engrams in reflections/ are moved out";
/// The pending refusal's words for files under `reflections/` that hold the
/// switch although they do not read as engrams now (frontmatter that does
/// not parse, another encoding); the paths follow.
pub const REFUSED_PENDING_UNREADABLE: &str =
    "waits on files in reflections/ that do not read as engrams now";
/// The pending refusal's words for files or folders under `reflections/`
/// that cannot be opened; the paths follow.
pub const REFUSED_PENDING_UNOPENED: &str =
    "waits on files or folders in reflections/ that cannot be opened";
/// The pending refusal's words for a Reflection folder spelled in more than
/// one letter case; the spellings follow.
pub const REFUSED_PENDING_SPELLINGS: &str =
    "waits until only one folder spells reflections/, in any letter case";
/// The refusal for a GitHub-connected domain whose Reflection has no home.
pub const REFUSED_HOMELESS: &str = "this domain is connected to GitHub and its Reflection has no home yet: switch Reflection on in the domain policies at the team server";
/// The start of the refusal for a Reflection held by another instance; its
/// address follows.
pub const REFUSED_ELSEWHERE_START: &str = "this domain's Reflection lives at ";
/// The refusal of a thread write by the anonymous visitor of a public domain.
pub const ANONYMOUS_COMMENT: &str =
    "anonymous visitors read this Reflection and cannot comment; sign in to comment";

/// A reflection write's receipt when the open room raised its edit conflict
/// over it.
pub const ROOM_CONFLICT_NOTE: &str = "your write is on disk, and it collides with text somebody in the open room has not saved yet: the people in the room are choosing between their text and yours";
/// A reflection write's receipt when the open room could not take it in yet.
pub const ROOM_WAITING_NOTE: &str = "your write is on disk; the open room has an unresolved change of its own, and the people in it meet yours when they resolve it";

/// What the gate hands a reflection verb.
#[derive(Debug, Clone)]
pub(crate) struct ReflectionAccess {
    /// The domain root.
    pub root: PathBuf,
    /// The Reflection's folder, in its spelling on disk
    /// ([`reflection_dir`]), resolved once per verb.
    pub folder: PathBuf,
    /// The domain's index id.
    pub domain_id: DomainId,
    /// The caller's reflection right.
    pub right: ReflectionRight,
    /// Whether the caller may read engrams here; source engrams are stripped
    /// from every answer when not.
    pub engrams_visible: bool,
}

impl ReflectionAccess {
    /// The absolute path of a file inside the Reflection's folder.
    pub(crate) fn abs(&self, inner: &str) -> PathBuf {
        join_rel(&self.folder, inner)
    }
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
    /// files [`crystalline_core::is_pending_engram`] calls pending that read
    /// as engrams.
    pub engrams: Vec<String>,
    /// Files that open and do not read as engrams now, sorted.
    pub broken: Vec<String>,
    /// Files and folders that cannot be opened, sorted.
    pub unopened: Vec<String>,
    pub origin: bool,
    /// This instance's `service.public_url`, canonical.
    pub own_url: Option<String>,
    /// Paths under `reflections/` the team's copy still holds (the origin
    /// base snapshot), sorted. Empty for a domain with no origin.
    pub team_copy: Vec<String>,
    /// The origin base snapshot that exists but cannot be read, with why:
    /// it may hold files under `reflections/`, so the switch-on is refused
    /// (fail closed, as the pending check fails).
    pub team_copy_unreadable: Option<String>,
}

/// Whether a MANIFEST's text declares `reflection: on`.
pub(crate) fn declares_on(source: &str) -> bool {
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
    let mut held: Vec<String> = Vec::new();
    if !facts.engrams.is_empty() {
        held.push(format!(
            "These engrams live in reflections/, which Reflection would take over: {}. Move them to another folder first (move_engram)",
            facts.engrams.join(", ")
        ));
    }
    if !facts.broken.is_empty() {
        held.push(format!(
            "These files in reflections/ do not read as engrams now: {}. {BROKEN_ADVICE}",
            facts.broken.join(", ")
        ));
    }
    if !facts.unopened.is_empty() {
        held.push(format!(
            "These files or folders in reflections/ cannot be opened: {}. {UNOPENED_ADVICE}",
            facts.unopened.join(", ")
        ));
    }
    if !held.is_empty() {
        return Err(EngineError::Invalid(format!(
            "{}. Then switch Reflection on",
            held.join(". ")
        )));
    }
    if let Some(snapshot) = &facts.team_copy_unreadable {
        return Err(EngineError::Invalid(format!(
            "the record of the team's copy of this domain cannot be read ({snapshot}), so it is unknown whether the team's copy still holds files in reflections/. Repair or remove that record (the next pull writes it again), then switch Reflection on"
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

/// Refuse a MANIFEST edit that switches Reflection on although the facts
/// were not gathered for it, because the switch was on when the edit began
/// and went off before it landed. Sending the edit again screens it.
pub(crate) fn refuse_unscreened_switch_on(before: &str, after: &str) -> Result<()> {
    if declares_on(before) || !declares_on(after) {
        return Ok(());
    }
    Err(EngineError::Conflict(
        "the MANIFEST's reflection switch changed while this edit ran; read it again and send the edit again".to_string(),
    ))
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

/// What holds a pending switch, sorted by why, so each kind is named in
/// its own words.
#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct PendingNames {
    /// Engrams to move out.
    pub engrams: Vec<String>,
    /// Files that open but do not read as engrams now: frontmatter that does
    /// not parse, or bytes that are not UTF-8.
    pub broken: Vec<String>,
    /// Files and folders that cannot be opened.
    pub unopened: Vec<String>,
    /// The folder's spellings, when there is more than one.
    pub spellings: Vec<String>,
}

impl PendingNames {
    /// The gate's refusal: one sentence per kind, each in the words a
    /// surface matches it by.
    fn refusal(&self, domain: &str) -> String {
        let mut sentences = Vec::new();
        if !self.engrams.is_empty() {
            sentences.push(format!(
                "Reflection for '{domain}' {REFUSED_PENDING_NAMED}: {}",
                self.engrams.join(", ")
            ));
        }
        if !self.broken.is_empty() {
            sentences.push(format!(
                "Reflection for '{domain}' {REFUSED_PENDING_UNREADABLE}: {}. {BROKEN_ADVICE}",
                self.broken.join(", ")
            ));
        }
        if !self.unopened.is_empty() {
            sentences.push(format!(
                "Reflection for '{domain}' {REFUSED_PENDING_UNOPENED}: {}. {UNOPENED_ADVICE}",
                self.unopened.join(", ")
            ));
        }
        if !self.spellings.is_empty() {
            sentences.push(format!(
                "Reflection for '{domain}' {REFUSED_PENDING_SPELLINGS}: {}. Keep one and move the files of the others out",
                self.spellings.join(", ")
            ));
        }
        if sentences.is_empty() {
            return format!("Reflection for '{domain}' {REFUSED_PENDING}");
        }
        sentences.join(". ")
    }
}

/// What to do with a file that opens and does not read as an engram.
const BROKEN_ADVICE: &str =
    "Fix them so they read again (frontmatter that parses, UTF-8 text), then move them out";
/// What to do with a file or folder that cannot be opened.
const UNOPENED_ADVICE: &str = "Make them readable for Crystalline, then move them out";

/// Sort the paths the pending check names (domain-relative, a folder with a
/// trailing `/`) by why they hold the switch: a folder that is one of two or
/// more spellings of `reflections/`, a folder or file that cannot be opened,
/// a file that opens and does not read as an engram now, or an engram.
/// Blocking file reads: callers on the runtime use [`sort_pending_off_runtime`].
pub(crate) fn sort_pending(root: &Path, names: &[String]) -> PendingNames {
    let spellings = r::reflection_folders(root);
    let mut out = PendingNames::default();
    for name in names {
        if let Some(folder) = name.strip_suffix('/') {
            if spellings.len() > 1 && spellings.iter().any(|s| s == folder) {
                out.spellings.push(name.clone());
            } else {
                out.unopened.push(name.clone());
            }
            continue;
        }
        let Ok(bytes) = std::fs::read(join_rel(root, name)) else {
            out.unopened.push(name.clone());
            continue;
        };
        let reads = String::from_utf8(bytes).is_ok_and(|text| {
            crystalline_core::parse_engram(&crystalline_core::to_lf(&text)).is_ok()
        });
        if reads {
            out.engrams.push(name.clone());
        } else {
            out.broken.push(name.clone());
        }
    }
    out
}

/// [`sort_pending`] on the blocking pool, as [`Engine::pending_engrams`]
/// reads the same files.
async fn sort_pending_off_runtime(root: PathBuf, names: Vec<String>) -> Result<PendingNames> {
    tokio::task::spawn_blocking(move || sort_pending(&root, &names))
        .await
        .map_err(|e| {
            EngineError::Internal(format!(
                "the files in the Reflection folder could not be read: {e}"
            ))
        })
}

/// Whether the recorded engram paths leave room for a pending engram: one
/// of them lies under `reflections/`, or none is recorded at all (the index
/// holds no row of the domain, so the files on disk decide).
fn may_be_pending(recorded: &[String]) -> bool {
    recorded.is_empty()
        || recorded
            .iter()
            .any(|p| crystalline_core::reflection::is_under_reflections(p))
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
        // Every gate asks this. With rows recorded and none under the folder
        // (a Reflection in effect keeps its pages out of the engram rows),
        // nothing can be pending and no file is read, unless the folder is
        // spelled twice, which holds the switch whatever the files are.
        if !may_be_pending(&recorded) && r::reflection_folders(&root).len() < 2 {
            return Ok(Vec::new());
        }
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
        let folders = r::reflection_folders(&root);
        let named = sort_pending_off_runtime(root, self.pending_engrams(domain).await?).await?;
        // The base snapshot is read for a domain with an origin only, and a
        // missing or unreadable one holds nothing.
        let mut team_copy: Vec<String> = Vec::new();
        let mut team_copy_unreadable = None;
        if origin && let Ok(dir) = self.origin_state_dir(domain) {
            match crystalline_remote::state::OriginState::load(&dir) {
                Ok(Some(state)) => {
                    team_copy = state
                        .files
                        .keys()
                        .filter(|p| crystalline_core::reflection::is_under_reflections(p))
                        .cloned()
                        .collect();
                    team_copy.sort();
                }
                // No snapshot yet: the team's copy was never pulled here.
                Ok(None) => {}
                Err(e) => team_copy_unreadable = Some(format!("{}: {e}", dir.display())),
            }
        }
        Ok(SwitchFacts {
            virtual_domain: false,
            folders,
            engrams: named.engrams,
            broken: named.broken,
            unopened: named.unopened,
            origin,
            own_url,
            team_copy,
            team_copy_unreadable,
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
        let folder = reflection_dir(&root);
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
    pub(crate) async fn require_reflection(
        &self,
        domain: &str,
        caller: &ReflectionCaller,
        need: ReflectionRight,
    ) -> Result<ReflectionAccess> {
        let (right, engrams_visible) = self.caller_reflection_right(domain, caller).await?;
        match self.reflection_state(domain).await? {
            ReflectionState::On { .. } => {}
            ReflectionState::Off => {
                return Err(EngineError::Refused(format!(
                    "{REFUSED_OFF_START}'{domain}'; its owner switches it on in the domain policies"
                )));
            }
            ReflectionState::Pending { engrams } if engrams_visible => {
                let root = match self.read_source(domain) {
                    ContentSource::File { root } => Some(root),
                    _ => None,
                };
                let named = match root {
                    Some(root) => sort_pending_off_runtime(root, engrams).await?,
                    None => PendingNames {
                        engrams,
                        ..Default::default()
                    },
                };
                return Err(EngineError::Refused(named.refusal(domain)));
            }
            ReflectionState::Pending { .. } => {
                return Err(EngineError::Refused(format!(
                    "Reflection for '{domain}' {REFUSED_PENDING}"
                )));
            }
            ReflectionState::Homeless => {
                return Err(EngineError::Refused(REFUSED_HOMELESS.to_string()));
            }
            ReflectionState::Elsewhere { url } => {
                return Err(EngineError::Refused(format!(
                    "{REFUSED_ELSEWHERE_START}{url}"
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
            folder: reflection_dir(&root),
            root,
            domain_id,
            right,
            engrams_visible,
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
    pub(super) async fn caller_reflection_right(
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
            // The domain became visible between the two reads (a race): the
            // answer is still the one a hidden domain gets, with the
            // registered list this caller may see.
            self.require_domain(domain, &caller.scope).await?;
            let mut hidden = self.hidden_for(&caller.scope).await?;
            hidden.insert(domain.to_string());
            return Err(self.unknown_domain(domain, &hidden));
        }
        Ok((right, engrams_visible))
    }

    /// Whether `scope` may read engrams in `domain` (`DomainRight::Read` or
    /// more), without an error for a hidden domain.
    pub(crate) async fn engrams_visible(&self, scope: &Scope, domain: &str) -> Result<bool> {
        Ok(!self.hidden_for(scope).await?.contains(domain))
    }
}

/// One engram's facts a section's sources are held against.
#[derive(Debug, Clone)]
pub(crate) struct EngramFact {
    pub permalink: String,
    pub title: String,
    pub status: String,
    pub checksum: String,
    /// Seconds since the epoch of the file's last change.
    pub mtime: i64,
}

/// The absolute path of a file inside a domain's `reflections/`, in the
/// folder's spelling on disk (see [`reflection_dir`]). A verb that holds a
/// [`ReflectionAccess`] uses [`ReflectionAccess::abs`], which resolves the
/// folder once; a room, which holds none, uses this.
pub(super) fn reflection_abs(root: &Path, inner: &str) -> PathBuf {
    join_rel(&reflection_dir(root), inner)
}

/// The pages among `pages` (paths inside the Reflection's folder) whose
/// text on disk `rewrite` would change (it answers how many links it
/// rewrites), as the rooms a move screens before anything moves. The disk
/// decides, not the index, since the relink reads the disk too. A page that
/// is gone has nothing to rewrite, and one that cannot be read is left to
/// the relink, which names it in the move's receipt.
pub(super) fn rooms_to_rewrite<'a>(
    access: &ReflectionAccess,
    pages: impl Iterator<Item = &'a str>,
    rewrite: &dyn Fn(&str, &str) -> usize,
) -> Vec<RoomDoc> {
    pages
        .filter(|inner| {
            matches!(read_opt(&access.abs(inner)), Ok(Some(text)) if rewrite(&text, inner) > 0)
        })
        .map(|inner| RoomDoc::Reflection(inner.to_string()))
        .collect()
}

/// The Reflection's folder under `root`: the one on disk when its name is
/// `reflections` in another letter case (the classifier's rule, so it is the
/// Reflection's folder), else `reflections`. A write never puts a second
/// spelling beside the first.
pub(super) fn reflection_dir(root: &Path) -> PathBuf {
    let name = r::reflection_folders(root)
        .into_iter()
        .next()
        .unwrap_or_else(|| r::REFLECTIONS_DIR.to_string());
    root.join(name)
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// A page without its `reflection:` frontmatter block, which names the
/// source engrams: what a reader who cannot read engrams is answered, what
/// the search looks at and what a live room holds. The rest of the
/// frontmatter stays. A frontmatter that cannot be cut key by key goes
/// whole: such a reader loses a title line, never an engram name. (A write
/// cuts the incoming block with `write_provenance` instead and refuses a
/// frontmatter it cannot cut, because dropping it would lose the writer's
/// other keys: the two cuts differ on purpose.)
pub(crate) fn without_provenance(text: &str) -> String {
    r::write_provenance(text, &r::Provenance::new()).unwrap_or_else(|_| {
        crystalline_core::frontmatter::split_frontmatter(text)
            .map(|parts| parts.body.trim_start_matches(['\n', '\r']).to_string())
            .unwrap_or_else(|| text.to_string())
    })
}

/// A source's state and its engram's title: `current`, `changed` (the
/// engram's checksum moved), `retired` (its status is in the retirement
/// set) or `missing` (no such engram any more). The one place a source's
/// state is decided: the read answers it and the reflect queue
/// reads it.
pub(crate) fn source_state(
    src: &r::SourceRef,
    facts: &HashMap<String, EngramFact>,
) -> (&'static str, String) {
    match facts.get(&src.engram) {
        None => ("missing", String::new()),
        Some(f) if crystalline_index::is_retired_status(&f.status.to_lowercase()) => {
            ("retired", f.title.clone())
        }
        Some(f) if f.checksum != src.checksum => ("changed", f.title.clone()),
        Some(f) => ("current", f.title.clone()),
    }
}

/// A source as the answers show it.
pub(crate) fn source_view(src: &r::SourceRef, facts: &HashMap<String, EngramFact>) -> Value {
    let (state, title) = source_state(src, facts);
    json!({ "permalink": src.engram, "title": title, "state": state })
}

/// Rules 1 to 4 of a reflection write: the engine's bookkeeping block
/// replaces the incoming one, a heading that lost its id line gets it back
/// by heading, headings get new ids when `assign_ids`, changed sections
/// record each of `authors` (one entry each, the on-disk list), records of
/// vanished sections go. Answers the text to write (without
/// the bookkeeping block re-emitted yet), the minted ids and the new
/// records. A live room composes through it too.
pub(super) fn compose_reflection(
    current: Option<&str>,
    baseline: &str,
    incoming: &str,
    authors: &[String],
    assign_ids: bool,
    now: &str,
) -> Result<(String, Vec<String>, r::Provenance)> {
    let stored = current.map(r::read_provenance).unwrap_or_default();
    let stripped =
        r::write_provenance(incoming, &r::Provenance::new()).map_err(EngineError::Invalid)?;
    let stripped = match current {
        Some(previous) => r::reattach_ids(&stripped, previous),
        None => stripped,
    };
    let (text, minted) = if assign_ids {
        // Ids the page must not mint again: those the baseline and the stored
        // records hold, minus the ones still on the page.
        let on_page: BTreeSet<String> = r::split_sections(&stripped)
            .into_iter()
            .filter_map(|s| s.id)
            .collect();
        let taken: BTreeSet<String> = r::baseline_ids(baseline)
            .into_iter()
            .chain(stored.keys().cloned())
            .filter(|id| !on_page.contains(id))
            .collect();
        r::assign_ids(&stripped, &taken, &mut r::random_section_id)
    } else {
        (stripped, Vec::new())
    };
    // The stored page is cut like the incoming one before the two are
    // compared: a page whose frontmatter held only the block loses it and the
    // blank lines after it, which would read as a change of the top.
    let before: HashMap<String, String> = current
        .map(|c| {
            let bare =
                r::write_provenance(c, &r::Provenance::new()).unwrap_or_else(|_| c.to_string());
            r::split_sections(&bare)
                .into_iter()
                .filter_map(|s| Some((s.id?, r::section_hash(&s.text))))
                .collect()
        })
        .unwrap_or_default();
    let mut prov = r::Provenance::new();
    for section in r::split_sections(&text) {
        let Some(id) = section.id.clone() else {
            continue;
        };
        let mut record = stored.get(&id).cloned().unwrap_or_default();
        if before.get(&id) != Some(&r::section_hash(&section.text)) {
            record.changed_at = Some(now.to_string());
            for author in authors {
                if !record.changed_by.contains(author) {
                    record.changed_by.push(author.clone());
                }
            }
        }
        prov.insert(id, record);
    }
    Ok((text, minted, prov))
}

/// Move every thread of a page that is anchored by heading onto the id its
/// heading carries in `page`, the text just written, so a later rename of
/// the heading keeps the thread on its section. Runs under the page lock,
/// after the page is on disk: a failure here leaves the thread anchored by
/// heading, which still resolves, so it is logged and the write stands. A
/// heading the page no longer holds answers no id, and its thread stays as
/// it is.
fn anchor_threads_on_ids(threads_abs: &Path, page: &str) {
    let file = match read_opt(threads_abs) {
        Ok(Some(file)) => file,
        Ok(None) => return,
        Err(e) => {
            tracing::warn!("could not read {}: {e}", threads_abs.display());
            return;
        }
    };
    let sections = r::split_sections(page);
    let id_of = |heading: &str| {
        r::find_section(&sections, heading)
            .filter(|s| !s.heading.is_empty())
            .and_then(|s| s.id.clone())
    };
    let Some(moved) = crystalline_core::threads::anchor_headings_on_ids(&file, &id_of) else {
        return;
    };
    if let Err(e) = write_file(threads_abs, &moved) {
        tracing::warn!(
            "could not anchor the threads in {} on section ids: {e}",
            threads_abs.display()
        );
    }
}

/// `text` with `prov` as its bookkeeping block, as LF, and each of `ids`
/// still on the page stamped `reflected` with the hash of its section in
/// that stored text. The top's text starts after the frontmatter the block
/// brings, which `text` may not have had yet; only the block is rewritten,
/// so a second pass leaves every section as it is. The write and the settle
/// both end here.
fn stamp_reflected(text: &str, prov: &mut r::Provenance, ids: &[String]) -> Result<String> {
    let write =
        |text: &str, prov: &r::Provenance| -> Result<String> {
            Ok(crystalline_core::to_lf(
                &r::write_provenance(text, prov).map_err(EngineError::Invalid)?,
            )
            .into_owned())
        };
    let stored = write(text, prov)?;
    let sections = r::split_sections(&stored);
    let mut rehashed = false;
    for id in ids {
        let Some(section) = sections
            .iter()
            .find(|s| s.id.as_deref() == Some(id.as_str()))
        else {
            continue;
        };
        let hash = r::section_hash(&section.text);
        let record = prov.entry(id.clone()).or_default();
        if record.reflected.as_deref() != Some(hash.as_str()) {
            record.reflected = Some(hash);
            rehashed = true;
        }
    }
    if rehashed {
        write(&stored, prov)
    } else {
        Ok(stored)
    }
}

impl Engine {
    /// Every engram of a domain by permalink, with the checksum a section's
    /// sources are compared against.
    pub(crate) async fn engram_facts(
        &self,
        domain_id: DomainId,
        domain: &str,
    ) -> Result<HashMap<String, EngramFact>> {
        let store = self.store.lock().await;
        let stamps = store.file_stamps(domain_id).await?;
        let engrams = store.list_engrams(domain, None, None).await?;
        Ok(engrams
            .into_iter()
            .filter_map(|d| {
                let stamp = stamps.get(&d.path)?;
                Some((
                    d.permalink.clone(),
                    EngramFact {
                        permalink: d.permalink,
                        title: d.title,
                        status: d.status,
                        checksum: stamp.sha256.clone(),
                        mtime: stamp.mtime,
                    },
                ))
            })
            .collect())
    }

    /// Put one reflection's row and its chunks in the index (R53), from the
    /// text just written to `abs`. The row carries the file's own
    /// modification instant, in the spelling the sync's prefilter compares
    /// (`asset_modified`), so the next walk does not read the file again.
    /// A committed write nudges the embed worker (R56), after the store lock
    /// is released.
    pub(super) async fn index_reflection(
        &self,
        domain_id: DomainId,
        inner: &str,
        text: &str,
        abs: &Path,
    ) -> Result<()> {
        let row = crystalline_index::ReflectionRow {
            path: inner.to_string(),
            title: r::title_of(text, inner),
            content: text.to_string(),
            sha256: sha256_hex(text.as_bytes()),
            size: text.len() as u64,
            modified: asset_modified(abs),
        };
        // The row and its chunks commit together, as an engram row and its
        // chunks do (`commit_overlay_row`): a row left stamped over missing
        // chunks would be skipped by the sync's prefilter until a full
        // reindex. The funnel opens no transaction of its own, because the
        // sync calls it inside its apply's. No caller holds one here: it
        // would hold the store lock this takes.
        let store = self.store.lock().await;
        store.begin().await?;
        let written = async {
            crystalline_index::reflection::index_reflection_row(
                &*store,
                domain_id,
                &row,
                &self.chunk_params,
            )
            .await?;
            #[cfg(any(test, feature = "testing"))]
            if self
                .reflection_index_fault
                .swap(false, std::sync::atomic::Ordering::SeqCst)
            {
                return Err(EngineError::Invalid(
                    "injected failure after the reflection row and its chunks".into(),
                ));
            }
            Ok::<(), EngineError>(())
        }
        .await;
        let committed = match written {
            Ok(()) => store.commit().await.map_err(EngineError::from),
            Err(e) => {
                let _ = store.rollback().await;
                Err(e)
            }
        };
        drop(store);
        // R56: the new chunks are embedded soon after the write, as an
        // engram's are, rather than at the next tick.
        if committed.is_ok() {
            self.nudge_embed();
        }
        committed
    }

    /// Arm a failure of the next reflection index write, after its row and
    /// chunks were written and before the commit. Disarmed by the write it
    /// hits.
    #[cfg(any(test, feature = "testing"))]
    pub fn fail_next_reflection_index(&self) {
        self.reflection_index_fault
            .store(true, std::sync::atomic::Ordering::SeqCst);
    }
}

impl Engine {
    /// `write_reflection`: dispatch on the action.
    pub async fn write_reflection(
        &self,
        p: &WriteReflectionParams,
        caller: &ReflectionCaller,
    ) -> Result<Value> {
        match p.action.as_deref().unwrap_or("write") {
            "write" => self.write_reflection_text(p, caller).await,
            "move" => {
                let to = p.to.as_deref().ok_or_else(|| {
                    EngineError::Invalid("move needs `to`, the new path inside reflections/".into())
                })?;
                self.move_reflection(&p.domain, &p.path, to, caller).await
            }
            "delete" => {
                self.delete_reflection(&p.domain, &p.path, caller).await?;
                Ok(json!({ "domain": p.domain, "path": p.path, "deleted": true }))
            }
            "settle" => {
                let outcome = p.outcome.as_deref().unwrap_or("kept");
                self.settle_reflection(&p.domain, &p.path, &p.sections, outcome, caller)
                    .await
            }
            "move_asset" => {
                let to = p.to.as_deref().ok_or_else(|| {
                    EngineError::Invalid(
                        "move_asset needs `to`, the file's new path inside reflections/ (assets/...)"
                            .into(),
                    )
                })?;
                self.move_reflection_asset(&p.domain, &p.path, to, caller)
                    .await
            }
            "delete_asset" => {
                self.reflection_asset_delete(&p.domain, &p.path, caller)
                    .await?;
                Ok(json!({ "domain": p.domain, "path": p.path, "deleted": true }))
            }
            other => Err(EngineError::Invalid(format!(
                "`{other}` is not a write_reflection action; use write, move, delete, settle, move_asset or delete_asset"
            ))),
        }
    }

    async fn write_reflection_text(
        &self,
        p: &WriteReflectionParams,
        caller: &ReflectionCaller,
    ) -> Result<Value> {
        if self.read_only {
            return Err(EngineError::ReadOnly);
        }
        // PACT.md is written by curators; everyone else proposes a
        // change through a thread on it.
        let need = if p.sources.is_empty() && p.path != r::PACT_FILE {
            ReflectionRight::Edit
        } else {
            ReflectionRight::Curate
        };
        let access = self.require_reflection(&p.domain, caller, need).await?;
        self.refuse_read_only_domain(&p.domain, &crate::scope::Scope::Unrestricted)
            .await?;
        r::validate_reflection_path(&p.path).map_err(EngineError::Invalid)?;
        // Rule 7: the whole page, or one section of it.
        let op = match (p.markdown.as_deref(), p.operation.as_deref()) {
            (Some(_), Some(_)) => {
                return Err(EngineError::Invalid("write takes markdown (the whole reflection) or operation (one section), not both".into()));
            }
            (None, None) => {
                return Err(EngineError::Invalid("write needs markdown, the whole reflection, or operation with section and content".into()));
            }
            (Some(_), None) => None,
            (None, Some(name)) => Some(crystalline_core::emit::SectionOp::parse(name, p.include_subsections).ok_or_else(|| {
                EngineError::Invalid(format!("`{name}` is not a section operation; use replace_section, insert_before_section or insert_after_section"))
            })?),
        };
        let facts = if p.sources.is_empty() {
            HashMap::new()
        } else {
            self.engram_facts(access.domain_id, &p.domain).await?
        };
        let abs = access.abs(&p.path);
        let baseline_abs = access.abs(&r::baseline_path(&p.path));
        let _lock = self.lock_file(&abs).await;

        let current = read_opt(&abs)?;
        // Rule 0: a create never replaces a page, and a stale checksum is
        // refused; both are decided under the lock, so two racing writes
        // cannot both land. A checksum for a page that is not there has
        // nothing to compare: the write creates it.
        let swap = match (p.create_only, p.expected_checksum.as_deref()) {
            (true, _) => Swap::Absent,
            (false, Some(expected)) => Swap::Expect(expected),
            (false, None) => Swap::Any,
        };
        match check_swap(current.as_deref(), &swap) {
            Ok(()) | Err(SwapRefused::Missing) => {}
            Err(SwapRefused::Exists) => {
                return Err(EngineError::Conflict(format!(
                    "a reflection already lives at '{}'",
                    p.path
                )));
            }
            Err(SwapRefused::Stale { .. }) => {
                return Err(EngineError::Conflict(format!(
                    "stale edit: '{}' changed since it was read; read it again and repeat the change",
                    p.path
                )));
            }
        }
        let (incoming, heading_stripped) = match op {
            None => (p.markdown.clone().unwrap_or_default(), None),
            Some(op) => {
                let stored = current.as_deref().ok_or_else(|| {
                    EngineError::NotFound(format!(
                        "no reflection '{}' in domain '{}'",
                        p.path, p.domain
                    ))
                })?;
                let section = p.section.as_deref().ok_or_else(|| {
                    EngineError::Invalid(
                        "a section operation needs `section`, the heading path".into(),
                    )
                })?;
                let content = p.content.as_deref().ok_or_else(|| {
                    EngineError::Invalid("a section operation needs `content`".into())
                })?;
                let edit = r::edit_section(stored, op, section, content).map_err(section_err)?;
                (edit.text, edit.heading_stripped)
            }
        };
        // An engram attachment is copied into reflections/assets/
        // first; a write that adds an embed of one is refused, nothing
        // written. An embed the stored page already holds (written by hand
        // or in a room) is the reflect queue's to name, so a change to
        // another section is not held up by it.
        let held = current
            .as_deref()
            .map(|stored| r::engram_attachment_embeds(stored, &p.path))
            .unwrap_or_default();
        if r::engram_attachment_embeds(&incoming, &p.path)
            .iter()
            .any(|target| !held.contains(target))
        {
            r::refuse_engram_attachments(&incoming, &p.path).map_err(EngineError::Invalid)?;
        }
        // Rule 8: the canonical spellings, the funnel every engram write's text
        // passes through, over the body after the frontmatter. The stored
        // page and its baseline go through it too, as a link rewrite that is
        // no person's change (`relink`): a section the writer left alone then
        // matches the stored one, so a respelled alias in it records nobody
        // and owes no feedback.
        let stored_baseline = read_opt(&baseline_abs)?.unwrap_or_default();
        let funnel = self
            .spelling_funnel(
                &caller.scope,
                &[
                    &incoming,
                    current.as_deref().unwrap_or(""),
                    &stored_baseline,
                ],
                BodyGate::Split,
            )
            .await?;
        let respell = |text: &str| funnel.respell(text);
        let (incoming, normalized) = respell(&incoming);
        let (stored, baseline) = match current.as_deref() {
            Some(page) => {
                let out =
                    r::relink(page, &stored_baseline, &respell).map_err(EngineError::Invalid)?;
                (Some(out.page), out.baseline)
            }
            None => (None, stored_baseline.clone()),
        };
        let (text, minted, mut prov) = compose_reflection(
            stored.as_deref(),
            &baseline,
            &incoming,
            std::slice::from_ref(&caller.author.name),
            true,
            &now(),
        )?;
        let sections = r::split_sections(&text);
        let mut advanced: Vec<String> = Vec::new();
        for (key, engrams) in &p.sources {
            let section = r::find_section(&sections, key).ok_or_else(|| {
                EngineError::Invalid(format!(
                    "no section '{key}' in '{}' to set sources on",
                    p.path
                ))
            })?;
            let id = section
                .id
                .clone()
                .expect("every heading has an id after assign_ids");
            let mut refs = Vec::new();
            for permalink in engrams {
                let fact = facts.get(permalink).ok_or_else(|| {
                    EngineError::Invalid(format!(
                        "no engram '{permalink}' in domain '{}' to name as a source",
                        p.domain
                    ))
                })?;
                refs.push(r::SourceRef {
                    engram: permalink.clone(),
                    checksum: fact.checksum.clone(),
                });
            }
            let record = prov.entry(id.clone()).or_default();
            record.sources = refs;
            record.reflected = Some(r::section_hash(&section.text));
            record.changed_by.clear();
            record.changed_at = None;
            record.answered_by = None;
            advanced.push(id);
        }
        let final_text = stamp_reflected(&text, &mut prov, &advanced)?;
        write_file(&abs, &final_text)?;
        if !advanced.is_empty() || baseline != stored_baseline {
            write_file(
                &baseline_abs,
                &r::advance_baseline(&baseline, &final_text, &advanced),
            )?;
        }
        anchor_threads_on_ids(&access.abs(&r::threads_path(&p.path)), &final_text);
        self.index_reflection(access.domain_id, &p.path, &final_text, &abs)
            .await?;
        self.mark_reflection_dirty(&p.domain, BackupCause::Settled);
        self.announce_reflection(
            &p.domain,
            &p.path,
            ReflectionChangeKind::Changed,
            None,
            change_label(&caller.scope),
        );
        // The page lock goes before the room is touched: a room's save holds
        // the room's state and then takes this lock, so the other order
        // here would deadlock against a person typing. A room save that slips
        // in between finds the file moved, merges it and lands the same text.
        drop(_lock);
        let mut receipt = json!({
            "domain": p.domain,
            "path": p.path,
            "checksum": sha256_hex(final_text.as_bytes()),
            "created": current.is_none(),
            "ids_assigned": minted,
            "curated": !advanced.is_empty(),
        });
        note_domain_names_normalized(&mut receipt, normalized);
        if let Some(heading) = heading_stripped {
            receipt["heading_stripped"] = json!(heading);
            receipt["guidance"] = json!(HEADING_STRIPPED_GUIDANCE);
        }
        let doc = RoomDoc::Reflection(p.path.clone());
        if let Some(rooms) = self.collab_rooms()
            && rooms.has_live_doc(&p.domain, &doc, None).await
        {
            // The room takes the file in by a three-way merge into its own
            // live text, so a person's unsaved typing stays; it reads the
            // page without the block (contract "Co-editing a reflection"),
            // and its save re-attaches the stored block. The write has landed
            // either way: a room that closed meanwhile is no refusal.
            match rooms.absorb_doc_change(&p.domain, &doc, None).await {
                Ok(outcome) => {
                    use crate::collab::session::Absorbed;
                    receipt["present"] = json!(outcome.participants);
                    match outcome.absorbed {
                        Absorbed::Merged => receipt["landed"] = json!("live"),
                        Absorbed::Conflict => {
                            receipt["landed"] = json!("file");
                            receipt["room"] = json!("conflict");
                            receipt["room_note"] = json!(ROOM_CONFLICT_NOTE);
                        }
                        Absorbed::Deferred => {
                            receipt["landed"] = json!("file");
                            receipt["room"] = json!("waiting");
                            receipt["room_note"] = json!(ROOM_WAITING_NOTE);
                        }
                    }
                }
                Err(e) => tracing::debug!(
                    domain = %p.domain,
                    path = %p.path,
                    "the open room did not take the write in: {e}"
                ),
            }
        }
        Ok(receipt)
    }
}

impl Engine {
    /// Tell every tab that may read this domain's Reflection that something
    /// in it changed. The event route delivers it by reflection right, not by
    /// engram right.
    pub(crate) fn announce_reflection(
        &self,
        domain: &str,
        path: &str,
        kind: ReflectionChangeKind,
        from: Option<&str>,
        actor: Option<String>,
    ) {
        self.announce(Change::Reflection(ReflectionChanged {
            domain: domain.to_string(),
            path: path.to_string(),
            kind,
            from: from.map(str::to_string),
            actor,
            audience: None,
        }));
    }

    /// Announce `switched` when the domain's switch is no longer `before`.
    /// Every Crystalline writer of a MANIFEST calls it after its write lands.
    pub(crate) fn announce_switch_if_moved(
        &self,
        domain: &str,
        before: crystalline_core::ReflectionSwitch,
        actor: Option<String>,
    ) {
        if self.reflection_switch(domain) != before {
            self.announce_reflection(domain, "", ReflectionChangeKind::Switched, None, actor);
        }
    }

    /// Save and close the domain's reflection rooms, telling each socket
    /// `switched_off`, when landing `after` as the domain's MANIFEST in its
    /// folder switches the Reflection off (`None`: the MANIFEST goes away).
    ///
    /// Every Crystalline writer of a MANIFEST calls it after its last
    /// refusal and before its write, for the folder only, never for a draft:
    /// the state is still on, so each room's last save lands in its page.
    /// It takes the co-editing registry, so a caller holds no room's guard
    /// and no file's write lock (lock order: registry, then session).
    pub(crate) async fn close_reflection_rooms_if_switching_off(
        &self,
        domain: &str,
        after: Option<&str>,
    ) {
        if self.switches_reflection_off(domain, after) {
            self.close_reflection_rooms(domain).await;
        }
    }

    /// Whether landing `after` as `domain`'s MANIFEST in its folder switches
    /// its Reflection off: it is on now, and `after` does not say on (`None`:
    /// the MANIFEST goes away). Takes no lock.
    pub(crate) fn switches_reflection_off(&self, domain: &str, after: Option<&str>) -> bool {
        self.reflection_switch(domain) == crystalline_core::ReflectionSwitch::On
            && !after.is_some_and(declares_on)
    }

    /// Save and close every reflection room of `domain` with `switched_off`:
    /// the switch-off is about to land. See
    /// [`Engine::close_reflection_rooms_if_switching_off`].
    pub(crate) async fn close_reflection_rooms(&self, domain: &str) {
        if let Some(rooms) = self.collab_rooms() {
            // Boxed because the recursion is in the types only: `close_docs`
            // runs room saves, and a MANIFEST room's save can reach this
            // function. At run time it never recurses: `close_docs` closes
            // reflection rooms, whose saves never write the MANIFEST.
            Box::pin(rooms.close_docs(
                domain,
                crystalline_core::ContentKind::Reflection,
                "switched_off",
            ))
            .await;
        }
    }

    /// A reflection as a room reads it: the page without the block that
    /// names its source engrams, for everyone in the room; the checksum is
    /// the file's, so every stale check compares file against file.
    pub async fn reflection_room_text(&self, domain: &str, inner: &str) -> Result<EngramText> {
        let not_found =
            || EngineError::NotFound(format!("no reflection '{inner}' in domain '{domain}'"));
        let ContentSource::File { root } = self.read_source(domain) else {
            return Err(not_found());
        };
        let file = read_opt(&reflection_abs(&root, inner))?.ok_or_else(not_found)?;
        Ok(EngramText {
            domain: domain.to_string(),
            permalink: inner.to_string(),
            path: r::domain_rel(inner),
            checksum: sha256_hex(file.as_bytes()),
            content: without_provenance(&file),
        })
    }

    /// A room's save. `authors` are the names each changed section records,
    /// as the room decided them (the signed-in accounts that edited since
    /// its last save); an empty list records nobody. The stored bookkeeping
    /// wins over whatever the room text carries. Section ids are
    /// assigned on the `final_save` only. Answers the receipt a room reads
    /// (`checksum`, `permalink`, `path`); `permalink` is `inner`, so a
    /// reflection room is never re-keyed.
    ///
    /// A page that is gone answers `NotFound` (the room's deletion conflict)
    /// unless `expected_checksum` is empty, which only the room's restore
    /// passes, for a page it puts back. A domain whose Reflection is not on
    /// here any more is refused, and nothing is written.
    pub async fn save_reflection_room(
        &self,
        domain: &str,
        inner: &str,
        text: &str,
        expected_checksum: &str,
        authors: &[String],
        final_save: bool,
    ) -> Result<Value> {
        self.refuse_read_only_domain(domain, &crate::scope::Scope::Unrestricted)
            .await?;
        // A room can outlive the state it was opened in: switched off, a
        // pending switch or a home elsewhere make the folder engram content
        // again, or another instance's. The save waits (a refusal the room
        // shows and retries) instead of writing ids and bookkeeping into it.
        if !matches!(
            self.reflection_state(domain).await?,
            ReflectionState::On { .. }
        ) {
            return Err(EngineError::Refused(format!(
                "the Reflection of '{domain}' is not on here any more, so this room's text is not saved; this tab keeps a copy, and if the page closes the server keeps one too"
            )));
        }
        let not_found =
            || EngineError::NotFound(format!("no reflection '{inner}' in domain '{domain}'"));
        let ContentSource::File { root } = self.read_source(domain) else {
            return Err(not_found());
        };
        let abs = reflection_abs(&root, inner);
        let baseline_abs = reflection_abs(&root, &r::baseline_path(inner));
        let _lock = self.lock_file(&abs).await;
        let current = read_opt(&abs)?;
        let receipt = |file: &str| {
            json!({
                "checksum": sha256_hex(file.as_bytes()),
                "permalink": inner,
                "path": r::domain_rel(inner),
            })
        };
        match current.as_deref() {
            None if !expected_checksum.is_empty() => return Err(not_found()),
            Some(file) if sha256_hex(file.as_bytes()) != expected_checksum => {
                return Err(EngineError::Conflict(format!(
                    "stale edit: '{inner}' changed since the room last saved it"
                )));
            }
            _ => {}
        }
        // Rule 8 the way a write takes it: the room's text arrives respelled
        // already (the session's `normalize_doc`), and the stored page and
        // its baseline get the same respelling as a link rewrite that is no
        // person's change, so a section nobody touched records nobody.
        let stored_baseline = read_opt(&baseline_abs)?.unwrap_or_default();
        let funnel = self
            .spelling_funnel(
                &crate::scope::Scope::Unrestricted,
                &[text, current.as_deref().unwrap_or(""), &stored_baseline],
                BodyGate::Split,
            )
            .await?;
        let respell = |source: &str| funnel.respell(source);
        let (incoming, _) = respell(text);
        let (stored, baseline) = match current.as_deref() {
            Some(page) => {
                let out =
                    r::relink(page, &stored_baseline, &respell).map_err(EngineError::Invalid)?;
                (Some(out.page), out.baseline)
            }
            None => (None, stored_baseline.clone()),
        };
        let (composed, _, prov) = compose_reflection(
            stored.as_deref(),
            &baseline,
            &incoming,
            authors,
            final_save,
            &now(),
        )?;
        let final_text = crystalline_core::to_lf(
            &r::write_provenance(&composed, &prov).map_err(EngineError::Invalid)?,
        )
        .into_owned();
        if baseline != stored_baseline {
            write_file(&baseline_abs, &baseline)?;
        }
        // A close with nothing new to land writes nothing.
        let wrote = current.as_deref() != Some(final_text.as_str());
        if wrote {
            write_file(&abs, &final_text)?;
            anchor_threads_on_ids(&reflection_abs(&root, &r::threads_path(inner)), &final_text);
            let (domain_id, _) = self.domain_source(domain).await?;
            self.index_reflection(domain_id, inner, &final_text, &abs)
                .await?;
            // The typist when the save holds one person's words alone; a
            // save of several, or of somebody the room cannot name, is by
            // nobody in particular.
            let actor = match authors {
                [one] if one != "someone" => Some(one.clone()),
                _ => None,
            };
            self.announce_reflection(domain, inner, ReflectionChangeKind::Changed, None, actor);
        }
        // A room's saves settle a minute after the typing stops; its close
        // settles them at once, whatever the close itself wrote.
        if final_save {
            self.mark_reflection_dirty(domain, BackupCause::Settled);
        } else if wrote || baseline != stored_baseline {
            self.mark_reflection_dirty(domain, BackupCause::Edit);
        }
        Ok(receipt(&final_text))
    }

    /// The right to be in a reflection's room: edit, curate for `PACT.md`
    /// (as its `PUT` takes). Public because `require_reflection` is
    /// engine-private.
    pub async fn require_reflection_edit(
        &self,
        domain: &str,
        path: &str,
        caller: &ReflectionCaller,
    ) -> Result<()> {
        let need = if path == r::PACT_FILE {
            ReflectionRight::Curate
        } else {
            ReflectionRight::Edit
        };
        self.require_reflection(domain, caller, need)
            .await
            .map(|_| ())
    }
}

impl Engine {
    /// `read_reflection` without a path.
    pub async fn read_reflection_tree(
        &self,
        domain: &str,
        caller: &ReflectionCaller,
    ) -> Result<Value> {
        let access = self
            .require_reflection(domain, caller, ReflectionRight::Read)
            .await?;
        let rows = self
            .store
            .lock()
            .await
            .list_reflections(access.domain_id)
            .await?;
        let open_threads = |inner: &str| -> usize {
            read_opt(&access.abs(&r::threads_path(inner)))
                .ok()
                .flatten()
                .map(|t| {
                    crystalline_core::threads::parse_threads(&t)
                        .iter()
                        .filter(|t| t.status == crystalline_core::threads::ThreadStatus::Open)
                        .count()
                })
                .unwrap_or(0)
        };
        let mut pact =
            json!({ "path": r::PACT_FILE, "title": "", "exists": false, "open_threads": 0 });
        let mut root = TreeNode::default();
        for row in &rows {
            if row.path == r::PACT_FILE {
                pact = json!({ "path": r::PACT_FILE, "title": row.title, "exists": true, "open_threads": open_threads(r::PACT_FILE) });
                continue;
            }
            let sections = r::split_sections(&row.content).len().saturating_sub(1);
            root.insert(
                &row.path,
                json!({
                    "kind": "reflection",
                    "name": row.path.rsplit('/').next().unwrap_or(&row.path),
                    "path": row.path,
                    "title": row.title,
                    "open_threads": open_threads(&row.path),
                    "sections": sections,
                }),
            );
        }
        Ok(json!({ "domain": domain, "pact": pact, "nodes": root.render("") }))
    }
}

/// The folder tree the tree answer is built from.
#[derive(Default)]
struct TreeNode {
    folders: BTreeMap<String, TreeNode>,
    files: Vec<Value>,
}

impl TreeNode {
    fn insert(&mut self, path: &str, leaf: Value) {
        match path.split_once('/') {
            Some((folder, rest)) => self
                .folders
                .entry(folder.to_string())
                .or_default()
                .insert(rest, leaf),
            None => self.files.push(leaf),
        }
    }

    fn render(&self, prefix: &str) -> Vec<Value> {
        let mut out: Vec<Value> = self
            .folders
            .iter()
            .map(|(name, node)| {
                let path = if prefix.is_empty() { name.clone() } else { format!("{prefix}/{name}") };
                json!({ "kind": "folder", "name": name, "path": path, "children": node.render(&path) })
            })
            .collect();
        let mut files = self.files.clone();
        files.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
        out.extend(files);
        out
    }
}

impl Engine {
    /// `read_reflection` with a path.
    pub async fn read_reflection(
        &self,
        domain: &str,
        inner: &str,
        caller: &ReflectionCaller,
    ) -> Result<Value> {
        let access = self
            .require_reflection(domain, caller, ReflectionRight::Read)
            .await?;
        r::validate_reflection_path(inner).map_err(EngineError::Invalid)?;
        let text = read_opt(&access.abs(inner))?.ok_or_else(|| {
            EngineError::NotFound(format!("no reflection '{inner}' in domain '{domain}'"))
        })?;
        let prov = r::read_provenance(&text);
        let facts = if access.engrams_visible {
            self.engram_facts(access.domain_id, domain).await?
        } else {
            HashMap::new()
        };
        // A reader who cannot read engrams gets the page without the block
        // that names them. The sections, `line` included, are counted on the
        // markdown answered, so a line always points at its heading there.
        let markdown = if access.engrams_visible {
            text.clone()
        } else {
            without_provenance(&text)
        };
        let sections: Vec<Value> = r::split_sections(&markdown)
            .iter()
            .filter(|s| s.id.as_deref() != Some(r::TOP_SECTION))
            .map(|s| {
                let record = s.id.as_deref().and_then(|id| prov.get(id));
                let mut row = json!({
                    "id": s.id,
                    "heading": s.heading,
                    "line": s.line,
                    "changed": r::text_changed(record, s),
                });
                if access.engrams_visible {
                    row["sources"] = json!(
                        record
                            .map(|rec| rec
                                .sources
                                .iter()
                                .map(|src| source_view(src, &facts))
                                .collect::<Vec<_>>())
                            .unwrap_or_default()
                    );
                }
                row
            })
            .collect();
        let threads = read_opt(&access.abs(&r::threads_path(inner)))?
            .map(|t| crystalline_core::threads::parse_threads(&t))
            .unwrap_or_default();
        let open: Vec<Value> = threads
            .iter()
            .filter(|t| t.status == crystalline_core::threads::ThreadStatus::Open)
            .map(|t| thread_view(inner, t, &text))
            .collect();
        let mut answer = json!({
            "domain": domain,
            "path": inner,
            "title": r::title_of(&text, inner),
            "markdown": markdown,
            // The file as stored, whatever was answered: a PUT's
            // `expected_checksum` is compared against the file.
            "checksum": sha256_hex(text.as_bytes()),
            "sections": sections,
            "threads": open,
        });
        // Who has the page open in a co-editing room (R77): nested, as the
        // contract and Fluid read it; absent while no room is open.
        if let Some(rooms) = self.collab_rooms() {
            let doc = RoomDoc::Reflection(inner.to_string());
            if rooms.has_live_doc(domain, &doc, None).await {
                answer["live"] =
                    json!({ "present": rooms.participants(domain, &doc, None, None).await });
            }
        }
        Ok(answer)
    }
}

/// A thread as the answers show it (`ThreadView` in the contract). The
/// Reflection is the target: the anchor's state comes from
/// `anchor_state` over the page, and `anchor.section` is what the anchor
/// names (`SectionRef::key`): the section's id, or its heading for a thread
/// opened on a heading that had no id yet.
pub(crate) fn thread_view(inner: &str, t: &crystalline_core::threads::Thread, text: &str) -> Value {
    use crystalline_core::threads as th;
    let last = chrono::DateTime::parse_from_rfc3339(t.last_at())
        .map(|d| d.with_timezone(&chrono::Utc))
        .ok();
    let age = last
        .map(|d| (chrono::Utc::now() - d).num_seconds().max(0))
        .unwrap_or(0);
    json!({
        "id": t.id,
        "path": inner,
        "anchor": {
            "section": t.anchor.section.key(),
            "quote": t.anchor.quote,
            "occurrence": t.anchor.occurrence,
            "state": r::anchor_state(text, &t.anchor).as_str(),
        },
        "status": t.status.as_str(),
        "waiting_on": th::waiting_on(t).as_str(),
        "opened_at": t.opened_at(),
        "age_secs": age,
        "entries": t.entries.iter().map(|e| json!({
            "at": e.at,
            "kind": e.kind.as_str(),
            "author": { "name": e.author.name, "agent": e.author.agent },
            "text": e.text,
        })).collect::<Vec<_>>(),
    })
}

/// One reflection search (R57).
pub struct ReflectionSearch<'a> {
    /// The words to find.
    pub query: &'a str,
    /// `hybrid` (the default), `text` or `semantic`.
    pub search_type: Option<&'a str>,
    /// Hits per page, clamped to 1..=[`MAX_PAGE_LIMIT`].
    pub limit: usize,
    /// One-based page.
    pub page: usize,
}

/// A reflection search's mode. `title` and `permalink` are engram modes and
/// are refused with the three a Reflection takes named.
fn parse_reflection_mode(s: Option<&str>) -> Result<SearchMode> {
    Ok(match s.unwrap_or("hybrid") {
        "hybrid" => SearchMode::Hybrid,
        "text" => SearchMode::Text,
        "semantic" => SearchMode::Semantic,
        other => {
            return Err(EngineError::Invalid(format!(
                "unknown search_type '{other}' for a Reflection; expected hybrid, text or semantic"
            )));
        }
    })
}

impl Engine {
    /// Search a domain's Reflection (R57): text, semantic or hybrid over its
    /// sections. A section never holds the frontmatter (`split_sections`
    /// starts at the body) and neither do the chunks (R52), so no hit or
    /// snippet comes out of a page's `reflection:` block, for any caller.
    /// Hybrid and semantic answer as text when there is no provider, nothing
    /// of this domain's pages embedded by the active model (another domain's
    /// vectors do not count), or stale vectors in this domain; `mode` says
    /// which ran. No hit carries a score.
    pub async fn search_reflection(
        &self,
        domain: &str,
        s: &ReflectionSearch<'_>,
        caller: &ReflectionCaller,
    ) -> Result<Value> {
        let access = self
            .require_reflection(domain, caller, ReflectionRight::Read)
            .await?;
        let requested = parse_reflection_mode(s.search_type)?;
        let query = s.query.trim();
        if query.is_empty() {
            return Err(EngineError::Invalid(
                "a search needs `query`, the words to find".into(),
            ));
        }
        let limit = s.limit.clamp(1, MAX_PAGE_LIMIT);
        let page = s.page.max(1);
        let provider = self.provider();
        // The store lock is held to read the rows and the coverage, dropped
        // across the embed call, and taken again for the vector statement,
        // as in `search_engrams_under`.
        let (rows, mut mode) = {
            let store = self.store.lock().await;
            let rows = store.list_reflections(access.domain_id).await?;
            let ready = requested != SearchMode::Text
                && provider.is_some()
                && store
                    .reflection_coverage(access.domain_id)
                    .await?
                    .has_active_embeddings(&self.model_id);
            (rows, if ready { requested } else { SearchMode::Text })
        };
        let mut vectors = Vec::new();
        if mode != SearchMode::Text
            && let Some(provider) = &provider
        {
            let qvec = provider
                .embed_queries(&[query.to_string()])
                .await
                .map_err(|e| EngineError::Internal(e.to_string()))?
                .into_iter()
                .next()
                .unwrap_or_default();
            let store = self.store.lock().await;
            match store
                .reflection_vector_hits(access.domain_id, &qvec, &self.model_id)
                .await
            {
                Ok(v) => vectors = v,
                // Vectors of another model or width: text until the worker
                // has re-embedded the pages (R57).
                Err(crystalline_index::IndexError::StaleEmbeddings { .. }) => {
                    mode = SearchMode::Text
                }
                Err(e) => return Err(e.into()),
            }
        }
        let floor = f64::from(crystalline_index::rank::DEFAULT_MIN_SIMILARITY);
        let hits = crystalline_index::reflection::rank_sections(
            &rows, query, mode, &vectors, floor, limit, page,
        );
        Ok(json!({
            "domain": domain,
            "query": query,
            "mode": mode_str(mode),
            "total": hits.total,
            "page": hits.page,
            "limit": hits.limit,
            "count": hits.items.len(),
            "hits": hits.items,
        }))
    }
}

impl Engine {
    pub async fn move_reflection(
        &self,
        domain: &str,
        from: &str,
        to: &str,
        caller: &ReflectionCaller,
    ) -> Result<Value> {
        if self.read_only {
            return Err(EngineError::ReadOnly);
        }
        let access = self
            .require_reflection(domain, caller, ReflectionRight::Edit)
            .await?;
        self.refuse_read_only_domain(domain, &crate::scope::Scope::Unrestricted)
            .await?;
        for path in [from, to] {
            r::validate_reflection_path(path).map_err(EngineError::Invalid)?;
        }
        if from == r::PACT_FILE || to == r::PACT_FILE {
            return Err(EngineError::Invalid(
                "PACT.md is the domain's agreement; edit it instead of moving it".into(),
            ));
        }
        // After the gate and the path rules, so a caller without the right
        // never learns that a page is open; before the page lock, which a
        // room's save takes.
        self.refuse_under_live_rooms(domain, &[RoomDoc::Reflection(from.to_string())])
            .await?;
        // Every other page whose links the move rewrites waits too: a
        // rewrite under an open room would race its next save. Screened from
        // the text on disk before anything moves, and relinked from this list
        // below.
        let rows = self
            .store
            .lock()
            .await
            .list_reflections(access.domain_id)
            .await?;
        let others = rows
            .iter()
            .map(|row| row.path.as_str())
            .filter(|path| *path != from && *path != to);
        let linking = rooms_to_rewrite(&access, others, &|text, inner| {
            r::rewrite_links_to(text, inner, from, to).1
        });
        self.refuse_under_live_rooms(domain, &linking).await?;
        let src = access.abs(from);
        let dst = access.abs(to);
        // Both pages' locks, in byte order, so two crossing moves cannot wait
        // on each other. Held until the moved page is indexed.
        let (first, second) = if src <= dst {
            (&src, &dst)
        } else {
            (&dst, &src)
        };
        let _first = self.lock_file(first).await;
        let _second = if first == second {
            None
        } else {
            Some(self.lock_file(second).await)
        };
        let text = read_opt(&src)?.ok_or_else(|| {
            EngineError::NotFound(format!("no reflection '{from}' in domain '{domain}'"))
        })?;
        // A page, a threads file or a baseline left at the target would be
        // adopted by the moved page: the move refuses.
        for (leftover, what) in [
            (to.to_string(), "a reflection"),
            (r::threads_path(to), "a threads file"),
            (r::baseline_path(to), "a baseline"),
        ] {
            if access.abs(&leftover).exists() {
                return Err(EngineError::Conflict(format!(
                    "'{leftover}' already holds {what}; remove it or pick another path"
                )));
            }
        }
        // The page's own relative links follow the move, and its
        // baseline gets the same rewrite with the `reflected` hashes carried,
        // so a move owes no feedback.
        let old_baseline = read_opt(&access.abs(&r::baseline_path(from)))?;
        let moved = r::relink(&text, old_baseline.as_deref().unwrap_or(""), &|s| {
            r::rebase_links(s, from, to)
        })
        .map_err(EngineError::Invalid)?;
        // The row is built from the text as written, so it matches the file.
        let page = crystalline_core::to_lf(&moved.page).into_owned();
        write_file(&dst, &page)?;
        remove_if_there(&src)?;
        if old_baseline.is_some() {
            write_file(&access.abs(&r::baseline_path(to)), &moved.baseline)?;
            remove_if_there(&access.abs(&r::baseline_path(from)))?;
        }
        let mut threads_moved = false;
        if let Some(body) = read_opt(&access.abs(&r::threads_path(from)))? {
            write_file(&access.abs(&r::threads_path(to)), &body)?;
            remove_if_there(&access.abs(&r::threads_path(from)))?;
            threads_moved = true;
        }
        self.store
            .lock()
            .await
            .delete_reflection(access.domain_id, from)
            .await?;
        self.index_reflection(access.domain_id, to, &page, &dst)
            .await?;
        drop((_first, _second));
        self.announce_reflection(
            domain,
            to,
            ReflectionChangeKind::Moved,
            Some(from),
            change_label(&caller.scope),
        );
        // Every other page that links the moved one, PACT.md included: a link
        // that follows a move is no change of the agreement, and a move needs
        // only edit access. Each page under its own lock. The move has
        // landed by now, so a page that cannot be relinked is named in the
        // receipt (and the log) instead of failing a move that happened.
        let mut failed: Vec<Value> = Vec::new();
        let mut note_failure = |path: &str, e: EngineError| {
            tracing::warn!(
                domain,
                from,
                to,
                page = path,
                "a link to the moved reflection could not be rewritten: {e}"
            );
            failed.push(json!({ "path": path, "reason": e.to_string() }));
        };
        let mut links = 0;
        for row in rows.iter().filter(|row| row.path != from && row.path != to) {
            let inner = row.path.as_str();
            match self
                .relink_reflection(&access, inner, &|s| r::rewrite_links_to(s, inner, from, to))
                .await
            {
                Ok(n) => {
                    links += n;
                    if n > 0 {
                        // A link that followed the move: nobody's change.
                        self.announce_reflection(
                            domain,
                            inner,
                            ReflectionChangeKind::Changed,
                            None,
                            None,
                        );
                    }
                }
                Err(e) => note_failure(inner, e),
            }
        }
        // The move and every page it relinked.
        self.mark_reflection_dirty(domain, BackupCause::Settled);
        let mut receipt = json!({ "from": from, "to": to, "links_rewritten": links, "threads_moved": threads_moved });
        if !failed.is_empty() {
            receipt["links_failed"] = json!(failed);
        }
        Ok(receipt)
    }

    /// Rewrite the links of one reflection and give its baseline the same
    /// rewrite (`crystalline_core::reflection::relink`): a link that
    /// follows a moved page (or a moved file) is not a person's
    /// change, so it owes no feedback item. Under the page's write lock; the
    /// index row follows. Answers how many links changed; a page that is gone
    /// or holds no such link is left alone.
    pub(super) async fn relink_reflection(
        &self,
        access: &ReflectionAccess,
        inner: &str,
        rewrite: &(dyn Fn(&str) -> (String, usize) + Sync),
    ) -> Result<usize> {
        self.relink_page(access.domain_id, &access.folder, inner, rewrite)
            .await
    }

    /// [`Engine::relink_reflection`] for a page of the Reflection folder
    /// `folder` of the domain `domain_id`, for a caller that holds no
    /// [`ReflectionAccess`] (the domain rename's respell).
    pub(super) async fn relink_page(
        &self,
        domain_id: DomainId,
        folder: &Path,
        inner: &str,
        rewrite: &(dyn Fn(&str) -> (String, usize) + Sync),
    ) -> Result<usize> {
        let abs = join_rel(folder, inner);
        let baseline_abs = join_rel(folder, &r::baseline_path(inner));
        let _lock = self.lock_file(&abs).await;
        let Some(page) = read_opt(&abs)? else {
            return Ok(0);
        };
        let baseline = read_opt(&baseline_abs)?;
        let out = r::relink(&page, baseline.as_deref().unwrap_or(""), rewrite)
            .map_err(EngineError::Invalid)?;
        if out.links == 0 {
            return Ok(0);
        }
        let page = crystalline_core::to_lf(&out.page).into_owned();
        write_file(&abs, &page)?;
        if baseline.is_some() {
            write_file(&baseline_abs, &out.baseline)?;
        }
        self.index_reflection(domain_id, inner, &page, &abs).await?;
        Ok(out.links)
    }

    pub async fn delete_reflection(
        &self,
        domain: &str,
        inner: &str,
        caller: &ReflectionCaller,
    ) -> Result<()> {
        if self.read_only {
            return Err(EngineError::ReadOnly);
        }
        let access = self
            .require_reflection(domain, caller, ReflectionRight::Edit)
            .await?;
        self.refuse_read_only_domain(domain, &crate::scope::Scope::Unrestricted)
            .await?;
        // After the gate, as in `move_reflection`.
        self.refuse_under_live_rooms(domain, &[RoomDoc::Reflection(inner.to_string())])
            .await?;
        r::validate_reflection_path(inner).map_err(EngineError::Invalid)?;
        if inner == r::PACT_FILE {
            return Err(EngineError::Invalid(
                "PACT.md is the domain's agreement; edit it instead of deleting it".into(),
            ));
        }
        let abs = access.abs(inner);
        let _lock = self.lock_file(&abs).await;
        if !remove_if_there(&abs)? {
            return Err(EngineError::NotFound(format!(
                "no reflection '{inner}' in domain '{domain}'"
            )));
        }
        remove_if_there(&access.abs(&r::threads_path(inner)))?;
        remove_if_there(&access.abs(&r::baseline_path(inner)))?;
        self.store
            .lock()
            .await
            .delete_reflection(access.domain_id, inner)
            .await?;
        self.mark_reflection_dirty(domain, BackupCause::Settled);
        self.announce_reflection(
            domain,
            inner,
            ReflectionChangeKind::Deleted,
            None,
            change_label(&caller.scope),
        );
        Ok(())
    }

    pub async fn settle_reflection(
        &self,
        domain: &str,
        inner: &str,
        ids: &[String],
        outcome: &str,
        caller: &ReflectionCaller,
    ) -> Result<Value> {
        if self.read_only {
            return Err(EngineError::ReadOnly);
        }
        if !matches!(outcome, "kept" | "taken_in") {
            return Err(EngineError::Invalid(format!(
                "`{outcome}` is not a settle outcome; use kept or taken_in"
            )));
        }
        if ids.is_empty() {
            return Err(EngineError::Invalid(
                "settle needs the section ids it settles".into(),
            ));
        }
        let access = self
            .require_reflection(domain, caller, ReflectionRight::Curate)
            .await?;
        self.refuse_read_only_domain(domain, &crate::scope::Scope::Unrestricted)
            .await?;
        // After the gate, so a caller without the right learns nothing about
        // the path; before any file is touched.
        r::validate_reflection_path(inner).map_err(EngineError::Invalid)?;
        let abs = access.abs(inner);
        let baseline_abs = access.abs(&r::baseline_path(inner));
        let facts = if outcome == "taken_in" {
            self.engram_facts(access.domain_id, domain).await?
        } else {
            HashMap::new()
        };
        let _lock = self.lock_file(&abs).await;
        let text = read_opt(&abs)?.ok_or_else(|| {
            EngineError::NotFound(format!("no reflection '{inner}' in domain '{domain}'"))
        })?;
        let baseline = read_opt(&baseline_abs)?.unwrap_or_default();
        let sections = r::split_sections(&text);
        let mut prov = r::read_provenance(&text);
        let known: BTreeSet<String> = sections
            .iter()
            .filter_map(|s| s.id.clone())
            .chain(r::baseline_ids(&baseline))
            .collect();
        for id in ids {
            if !known.contains(id) {
                return Err(EngineError::Invalid(format!(
                    "no section '{id}' in '{inner}' or its baseline"
                )));
            }
            if let Some(section) = sections
                .iter()
                .find(|s| s.id.as_deref() == Some(id.as_str()))
            {
                let record = prov.entry(id.clone()).or_default();
                record.reflected = Some(r::section_hash(&section.text));
                record.changed_by.clear();
                record.changed_at = None;
                record.answered_by = None;
                if outcome == "taken_in" {
                    for src in &mut record.sources {
                        if let Some(fact) = facts.get(&src.engram) {
                            src.checksum = fact.checksum.clone();
                        }
                    }
                }
            }
        }
        let final_text = stamp_reflected(&text, &mut prov, ids)?;
        write_file(&abs, &final_text)?;
        write_file(
            &baseline_abs,
            &r::advance_baseline(&baseline, &final_text, ids),
        )?;
        self.index_reflection(access.domain_id, inner, &final_text, &abs)
            .await?;
        self.mark_reflection_dirty(domain, BackupCause::Settled);
        self.announce_reflection(
            domain,
            inner,
            ReflectionChangeKind::Changed,
            None,
            change_label(&caller.scope),
        );
        Ok(json!({ "domain": domain, "path": inner, "settled": ids, "outcome": outcome }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const OFF: &str = "---\ntype: manifest\ntitle: eng\nstatus: stable\n---\n\n# eng\n";
    const ON: &str =
        "---\ntype: manifest\ntitle: eng\nstatus: stable\nreflection: on\n---\n\n# eng\n";

    /// Every kind that holds a switch-on is named in its own sentence, each
    /// starting with a capital letter; the encoding advice goes only with
    /// files that open and do not read as engrams.
    #[test]
    fn the_switch_on_refusal_names_each_kind_in_its_own_sentence() {
        let facts = SwitchFacts {
            engrams: vec!["reflections/a.md".into()],
            broken: vec!["reflections/b.md".into()],
            unopened: vec!["reflections/c.md".into()],
            ..Default::default()
        };
        let err = screen_switch(OFF, ON, &facts).unwrap_err().to_string();
        assert_eq!(
            err,
            "These engrams live in reflections/, which Reflection would take over: reflections/a.md. Move them to another folder first (move_engram). These files in reflections/ do not read as engrams now: reflections/b.md. Fix them so they read again (frontmatter that parses, UTF-8 text), then move them out. These files or folders in reflections/ cannot be opened: reflections/c.md. Make them readable for Crystalline, then move them out. Then switch Reflection on"
        );
        let unopened = SwitchFacts {
            unopened: vec!["reflections/c.md".into()],
            ..Default::default()
        };
        let err = screen_switch(OFF, ON, &unopened).unwrap_err().to_string();
        assert!(!err.contains("UTF-8"), "{err}");
    }

    /// A file that opens and does not read as an engram is broken; one that
    /// cannot be opened, and a folder that cannot be read, are unopened.
    #[cfg(unix)]
    #[test]
    fn pending_names_tell_a_broken_file_from_one_that_cannot_be_opened() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        std::fs::create_dir_all(root.join("reflections")).unwrap();
        std::fs::write(root.join("reflections/ok.md"), "# Ok\n").unwrap();
        std::fs::write(root.join("reflections/broken.md"), "---\n: [\n---\n").unwrap();
        std::fs::write(root.join("reflections/latin.md"), b"# Caf\xe9\n").unwrap();
        let shut = root.join("reflections/shut.md");
        std::fs::write(&shut, "# Shut\n").unwrap();
        std::fs::set_permissions(&shut, std::fs::Permissions::from_mode(0o000)).unwrap();
        let blocked = std::fs::read(&shut).is_err();
        let names: Vec<String> = [
            "reflections/ok.md",
            "reflections/broken.md",
            "reflections/latin.md",
            "reflections/shut.md",
            "reflections/sub/",
        ]
        .map(String::from)
        .to_vec();
        let named = sort_pending(root, &names);
        std::fs::set_permissions(&shut, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert_eq!(named.engrams, ["reflections/ok.md"]);
        assert_eq!(
            named.broken,
            ["reflections/broken.md", "reflections/latin.md"]
        );
        if blocked {
            assert_eq!(named.unopened, ["reflections/shut.md", "reflections/sub/"]);
        }
        assert!(named.spellings.is_empty());
    }

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

    /// The gate's fast path: only rows under the folder, or no rows at all,
    /// send the pending check to the disk.
    #[test]
    fn only_rows_under_the_folder_or_none_may_be_pending() {
        assert!(may_be_pending(&[]));
        assert!(!may_be_pending(&[
            "MANIFEST.md".into(),
            "notes/a.md".into()
        ]));
        assert!(may_be_pending(&[
            "MANIFEST.md".into(),
            "Reflections/a.md".into()
        ]));
    }

    /// A write goes into the Reflection's folder as it is spelled on disk;
    /// with no folder yet it is `reflections`.
    #[test]
    fn a_reflection_path_takes_the_folder_spelling_on_disk() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(reflection_abs(tmp.path(), "guides/a.md").ends_with("reflections/guides/a.md"));
        std::fs::create_dir_all(tmp.path().join("Reflections")).unwrap();
        assert!(reflection_abs(tmp.path(), "guides/a.md").ends_with("Reflections/guides/a.md"));
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
            !crystalline_core::is_pending_engram(
                tmp.path(),
                "reflections/PACT.md",
                crystalline_core::EngramRow::Unknown
            ),
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
