//! `reflect`: the Reflection's work queue - feedback, update, review - recomputed
//! on every call and never stored, the shape of evolve's queue.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use crystalline_core::reflection::{self as r, ReflectionState, Structure};
use crystalline_core::threads::{self as th, SectionRef, ThreadStatus, Waiting};

use super::reflection::{
    EngramFact, ReflectionAccess, reflection_abs, source_state, source_view, thread_view,
};
use super::*;
use crate::scope::{ReflectionCaller, ReflectionRight};

/// How an agent works the queue, returned with every page.
pub const REFLECT_GUIDANCE: &str = "Work feedback items first: read what the person changed and decide - take it into the engrams (change them, then write_reflection the section with its sources), keep it as their text (write_reflection action=settle outcome=kept), or answer it in a thread (discuss with answers_feedback). Then update items: bring changed engrams into their sections and write them with sources; cover unreflected engrams with a new section or reflection; move pages the pact's structure does not fit; apply a changed pact to the pages it affects. Files under reflections/assets/: link an unreferenced file from the section it belongs to, or remove it with write_reflection action=delete_asset (ask first: removing is irreversible); for a missing file, ask a person to add it or correct the link; an engram attachment cannot be embedded, so ask a person to copy the file into reflections/assets/ and point the link there. Answer review threads in plain words - the people reading them may not see engrams.";

const DEFAULT_LIMIT: usize = 10;
const MAX_LIMIT: usize = 100;

/// One open item of a domain's Reflection.
#[derive(Debug, Clone)]
struct Item {
    kind: &'static str,
    what: &'static str,
    domain: String,
    path: String,
    /// The section's id; `None` for an item about a whole page, the pact or
    /// a folder, and for a section with no id yet (then `heading` names it).
    section: Option<String>,
    heading: String,
    age_secs: i64,
    extra: Value,
}

/// Which section an item is about, for grouping: its id, else its heading.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum SectionKey {
    Id(String),
    Heading(String),
}

impl Item {
    /// The group an item belongs to: the section it names, or none (a group
    /// of its own).
    fn group(&self) -> Option<(String, String, SectionKey)> {
        let key = match &self.section {
            Some(id) => SectionKey::Id(id.clone()),
            None if !self.heading.is_empty() => SectionKey::Heading(self.heading.clone()),
            None => return None,
        };
        Some((self.domain.clone(), self.path.clone(), key))
    }

    /// Feedback, then update, then review inside a group.
    fn rank(&self) -> u8 {
        match self.kind {
            "feedback" => 0,
            "update" => 1,
            _ => 2,
        }
    }
}

fn secs_since_rfc3339(at: Option<&str>) -> Option<i64> {
    let at = chrono::DateTime::parse_from_rfc3339(at?).ok()?;
    Some(
        (chrono::Utc::now() - at.with_timezone(&chrono::Utc))
            .num_seconds()
            .max(0),
    )
}

fn secs_since_epoch(mtime: i64) -> i64 {
    (chrono::Utc::now().timestamp() - mtime).max(0)
}

/// Rank items: groups oldest first, feedback before update before review inside.
fn rank(items: Vec<Item>) -> Vec<Item> {
    let mut groups: Vec<Vec<Item>> = Vec::new();
    let mut index: HashMap<(String, String, SectionKey), usize> = HashMap::new();
    for item in items {
        match item.group() {
            Some(key) => {
                let at = *index.entry(key).or_insert_with(|| {
                    groups.push(Vec::new());
                    groups.len() - 1
                });
                groups[at].push(item);
            }
            None => groups.push(vec![item]),
        }
    }
    for group in &mut groups {
        group.sort_by_key(Item::rank);
    }
    let oldest = |g: &Vec<Item>| g.iter().map(|i| i.age_secs).max().unwrap_or(0);
    groups.sort_by(|a, b| {
        oldest(b)
            .cmp(&oldest(a))
            .then_with(|| a[0].path.cmp(&b[0].path))
    });
    groups.into_iter().flatten().collect()
}

/// The text of `sections`, each normalized as the hash sees it, empty ones
/// left out: the two sides of the pact's diff.
fn joined_text<'a>(sections: impl Iterator<Item = &'a str>) -> String {
    let mut out = String::new();
    for text in sections.map(r::normalize_section_text) {
        if text.is_empty() {
            continue;
        }
        out.push_str(&text);
        out.push_str("\n\n");
    }
    out
}

/// The domains a queue runs over, and the ones it leaves out and names.
#[derive(Debug, Default)]
struct QueueScope {
    /// The domains whose queue is read.
    domains: Vec<String>,
    /// Left out: their Reflection's state could not be read.
    unreadable: Vec<String>,
    /// Left out: their Reflection waits for engrams to leave its folder.
    pending: Vec<String>,
}

/// How much of each item [`Engine::detect_reflection`] builds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Detail {
    /// Every member a queue row shows: diffs, sources.
    Full,
    /// Only what ranks and counts an item; no diff is rendered and no
    /// source is looked up (the nudge counts).
    Count,
}

impl Engine {
    /// Every open item of one domain's Reflection, unranked.
    async fn detect_reflection(
        &self,
        domain: &str,
        access: &ReflectionAccess,
        detail: Detail,
    ) -> Result<Vec<Item>> {
        let full = detail == Detail::Full;
        let rows = self
            .store
            .lock()
            .await
            .list_reflections(access.domain_id)
            .await?;
        let facts = self.engram_facts(access.domain_id, domain).await?;
        let threads = self.all_threads(access).await?;
        let open_thread = |id: &str| {
            threads
                .iter()
                .any(|(_, t, _)| t.id == id && t.status == ThreadStatus::Open)
        };
        let pact_globs = rows
            .iter()
            .find(|row| row.path == r::PACT_FILE)
            .map(|row| r::structure_globs(&row.content))
            .unwrap_or_default();
        // Compiled once for every page of the domain.
        let structure = Structure::new(&pact_globs);
        let mut cited: HashSet<String> = HashSet::new();
        let mut items = Vec::new();
        for row in &rows {
            let baseline = std::fs::read_to_string(access.abs(&r::baseline_path(&row.path)))
                .unwrap_or_default();
            let row_age = secs_since_rfc3339(Some(&row.modified)).unwrap_or(0);
            let prov = r::read_provenance(&row.content);
            if row.path == r::PACT_FILE {
                let changes = r::feedback_changes(&row.content, &baseline);
                if !changes.is_empty() {
                    let extra = if full {
                        let sections = r::split_sections(&row.content);
                        let current = joined_text(sections.iter().map(|s| s.text.as_str()));
                        let reflected_entries = r::parse_baseline(&baseline);
                        let reflected =
                            joined_text(reflected_entries.iter().map(|(_, t)| t.as_str()));
                        json!({ "diff": diffy::create_patch(&reflected, &current).to_string() })
                    } else {
                        Value::Null
                    };
                    items.push(Item {
                        kind: "update",
                        what: "pact_changed",
                        domain: domain.to_string(),
                        path: row.path.clone(),
                        section: None,
                        heading: String::new(),
                        age_secs: row_age,
                        extra,
                    });
                }
                continue;
            }
            for change in r::feedback_changes(&row.content, &baseline) {
                let record = change.id.as_deref().and_then(|id| prov.get(id));
                if record
                    .and_then(|rec| rec.answered_by.as_deref())
                    .is_some_and(open_thread)
                {
                    continue;
                }
                let age = secs_since_rfc3339(record.and_then(|rec| rec.changed_at.as_deref()))
                    .unwrap_or(row_age);
                let extra = if full {
                    let sources: Vec<Value> = record
                        .map(|rec| rec.sources.iter().map(|s| source_view(s, &facts)).collect())
                        .unwrap_or_default();
                    json!({
                        "changed_by": record.map(|rec| rec.changed_by.clone()).unwrap_or_default(),
                        "diff": diffy::create_patch(
                            &r::normalize_section_text(&change.before),
                            &r::normalize_section_text(&change.after),
                        )
                        .to_string(),
                        "sources": sources,
                    })
                } else {
                    Value::Null
                };
                items.push(Item {
                    kind: "feedback",
                    what: change.kind.as_str(),
                    domain: domain.to_string(),
                    path: row.path.clone(),
                    section: change.id.clone(),
                    heading: change.heading.clone(),
                    age_secs: age,
                    extra,
                });
            }
            for section in r::split_sections(&row.content) {
                let Some(id) = section.id.as_deref() else {
                    continue;
                };
                let Some(record) = prov.get(id) else {
                    continue;
                };
                let mut by_what: BTreeMap<&'static str, (i64, Vec<Value>)> = BTreeMap::new();
                for src in &record.sources {
                    cited.insert(src.engram.clone());
                    // The read and the queue decide a source's state in one place.
                    let engram_age = || {
                        facts
                            .get(&src.engram)
                            .map_or(row_age, |f| secs_since_epoch(f.mtime))
                    };
                    let (what, age) = match source_state(src, &facts).0 {
                        "missing" => ("source_missing", row_age),
                        "retired" => ("source_retired", engram_age()),
                        "changed" => ("source_changed", engram_age()),
                        _ => continue,
                    };
                    let entry = by_what.entry(what).or_insert((0, Vec::new()));
                    entry.0 = entry.0.max(age);
                    if full {
                        entry.1.push(source_view(src, &facts));
                    }
                }
                for (what, (age, sources)) in by_what {
                    items.push(Item {
                        kind: "update",
                        what,
                        domain: domain.to_string(),
                        path: row.path.clone(),
                        section: Some(id.to_string()),
                        heading: section.heading.clone(),
                        age_secs: age,
                        extra: json!({ "sources": sources }),
                    });
                }
            }
            if !structure.fits(&row.path) {
                items.push(Item {
                    kind: "update",
                    what: "off_structure",
                    domain: domain.to_string(),
                    path: row.path.clone(),
                    section: None,
                    heading: String::new(),
                    age_secs: row_age,
                    extra: json!({ "structure": pact_globs }),
                });
            }
        }
        // A Reflection's files: a reference to a file that is not
        // there, an engram attachment embedded outside Crystalline (a plain
        // editor, a room), and a file no page links. Reflections and
        // PACT.md are the pages that count; threads and the baseline never do.
        let assets = self.asset_list_in(AssetHome::Reflection, domain).await?;
        let stored: HashSet<&str> = assets.iter().map(|a| a.path.as_str()).collect();
        let mut referenced: HashSet<String> = HashSet::new();
        for row in &rows {
            let row_age = secs_since_rfc3339(Some(&row.modified)).unwrap_or(0);
            for section in r::split_sections(&row.content) {
                let mut missing: Vec<String> = Vec::new();
                for asset in r::reflection_asset_refs(&section.text, &row.path) {
                    // The disk too, so a file the walker has not indexed yet
                    // is not reported.
                    let there = stored.contains(asset.as_str())
                        || reflection_abs(&access.root, &asset).is_file();
                    if !there {
                        missing.push(asset.clone());
                    }
                    referenced.insert(asset);
                }
                let embedded = r::engram_attachment_embeds(&section.text, &row.path);
                for (what, key, list) in [
                    ("asset_missing", "assets", missing),
                    ("engram_attachment", "targets", embedded),
                ] {
                    if list.is_empty() {
                        continue;
                    }
                    let mut extra = serde_json::Map::new();
                    extra.insert(key.to_string(), json!(list));
                    items.push(Item {
                        kind: "update",
                        what,
                        domain: domain.to_string(),
                        path: row.path.clone(),
                        section: section.id.clone(),
                        heading: section.heading.clone(),
                        age_secs: row_age,
                        extra: Value::Object(extra),
                    });
                }
            }
        }
        for asset in &assets {
            if referenced.contains(&asset.path) {
                continue;
            }
            items.push(Item {
                kind: "update",
                what: "asset_unreferenced",
                domain: domain.to_string(),
                path: String::new(),
                section: None,
                heading: String::new(),
                age_secs: secs_since_rfc3339(Some(&asset.modified)).unwrap_or(0),
                extra: json!({ "asset": asset.path }),
            });
        }
        let mut loose: BTreeMap<String, Vec<&EngramFact>> = BTreeMap::new();
        for fact in facts.values() {
            if cited.contains(&fact.permalink)
                || fact.permalink == "manifest"
                || crystalline_index::is_retired_status(&fact.status.to_lowercase())
            {
                continue;
            }
            let folder = fact
                .permalink
                .split_once('/')
                .map(|(f, _)| f)
                .unwrap_or("")
                .to_string();
            loose.entry(folder).or_default().push(fact);
        }
        for (folder, mut engrams) in loose {
            engrams.sort_by(|a, b| a.permalink.cmp(&b.permalink));
            let oldest = engrams
                .iter()
                .map(|f| secs_since_epoch(f.mtime))
                .max()
                .unwrap_or(0);
            items.push(Item {
                kind: "update",
                what: "unreflected",
                domain: domain.to_string(),
                path: String::new(),
                section: None,
                heading: String::new(),
                age_secs: oldest,
                extra: json!({
                    "folder": folder,
                    "count": engrams.len(),
                    "engrams": engrams.iter().take(10).map(|f| f.permalink.clone()).collect::<Vec<_>>(),
                }),
            });
        }
        for (path, thread, text) in &threads {
            if thread.status != ThreadStatus::Open || th::waiting_on(thread) != Waiting::Agent {
                continue;
            }
            // The anchor names its section by id or, on a heading that had
            // none when the thread was opened, by heading: either way the
            // item names the section as it stands now, so it joins that
            // section's group. A section that is gone keeps the anchor's own
            // form.
            let sections = r::split_sections(text);
            let (section, heading) = match (
                r::find_section(&sections, thread.anchor.section.key()),
                &thread.anchor.section,
            ) {
                (Some(found), _) => (found.id.clone(), found.heading.clone()),
                (None, SectionRef::Id(id)) => (Some(id.clone()), String::new()),
                (None, SectionRef::Heading(heading)) => (None, heading.clone()),
            };
            items.push(Item {
                kind: "review",
                what: "thread",
                domain: domain.to_string(),
                path: path.clone(),
                section,
                heading,
                age_secs: secs_since_rfc3339(Some(thread.last_at())).unwrap_or(0),
                extra: json!({ "thread": thread.id }),
            });
        }
        Ok(items)
    }

    fn page_json(
        items: &[Item],
        kinds: &[String],
        limit: Option<usize>,
        page: Option<usize>,
        engrams_visible: bool,
    ) -> Value {
        let filtered: Vec<&Item> = items
            .iter()
            .filter(|i| kinds.is_empty() || kinds.iter().any(|k| k == i.kind))
            .collect();
        let limit = limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
        let page = page.unwrap_or(1).max(1);
        let offset = (page - 1).saturating_mul(limit);
        let count = |k: &str| filtered.iter().filter(|i| i.kind == k).count();
        let queue: Vec<Value> = filtered
            .iter()
            .enumerate()
            .skip(offset)
            .take(limit)
            .map(|(n, i)| {
                let mut row = json!({
                    "n": n + 1,
                    "kind": i.kind,
                    "what": i.what,
                    "domain": i.domain,
                    "path": i.path,
                    "section": i.section,
                    "heading": i.heading,
                    "age_secs": i.age_secs,
                });
                if let (Value::Object(target), Value::Object(extra)) = (&mut row, i.extra.clone()) {
                    for (k, v) in extra {
                        target.insert(k, v);
                    }
                }
                if !engrams_visible {
                    let obj = row.as_object_mut().expect("an object");
                    obj.remove("sources");
                    obj.remove("engrams");
                    obj.remove("folder");
                }
                row
            })
            .collect();
        json!({
            "total": filtered.len(),
            "page": page,
            "limit": limit,
            "count": queue.len(),
            "kinds": { "feedback": count("feedback"), "update": count("update"), "review": count("review") },
            "queue": queue,
            "guidance": REFLECT_GUIDANCE,
        })
    }

    /// The domains a queue or a count runs over: the named ones (each once,
    /// in the order first named), or every registered domain whose
    /// Reflection is in effect here. Beside them, the domains of an unnamed
    /// scope whose state could not be read: they are left out, not a
    /// failure of the whole scope, and those whose Reflection is pending.
    /// `lenient` screens the named ones the way the unnamed scope screens
    /// every domain (see `ReflectParams::skip_unavailable`).
    async fn reflect_scope(&self, named: &[String], lenient: bool) -> Result<QueueScope> {
        let mut once: Vec<String> = Vec::new();
        for name in named {
            if !once.contains(name) {
                once.push(name.clone());
            }
        }
        if !named.is_empty() && !lenient {
            return Ok(QueueScope {
                domains: once,
                ..QueueScope::default()
            });
        }
        let names = if named.is_empty() {
            let mut names = self.known_domain_names();
            names.sort();
            names.dedup();
            names
        } else {
            // A name nobody registered is left out like any other domain
            // the queue cannot work, never reported as unreadable.
            let known = self.known_domain_names();
            once.into_iter().filter(|n| known.contains(n)).collect()
        };
        // An unnamed queue leaves out a read-only domain (like evolve) and a
        // local copy a connected server replaces (decision D19).
        let shadowed = self.shadowed_domains();
        let mut out = Vec::new();
        let mut unreadable = Vec::new();
        let mut pending = Vec::new();
        for name in names {
            if shadowed.contains(&name) || self.domain_is_read_only(&name).await {
                continue;
            }
            match self.reflection_state(&name).await {
                Ok(ReflectionState::On { .. }) => out.push(name),
                Ok(ReflectionState::Pending { .. }) => pending.push(name),
                Ok(_) => {}
                Err(e) => {
                    tracing::warn!(
                        "reflect: the Reflection state of '{name}' could not be read: {e}"
                    );
                    unreadable.push(name);
                }
            }
        }
        Ok(QueueScope {
            domains: out,
            unreadable,
            pending,
        })
    }

    /// The `reflect` tool.
    pub async fn reflect(&self, p: &ReflectParams, caller: &ReflectionCaller) -> Result<Value> {
        for kind in &p.kinds {
            if !matches!(kind.as_str(), "feedback" | "update" | "review") {
                return Err(EngineError::Invalid(format!(
                    "`{kind}` is not a reflect kind; use feedback, update or review"
                )));
            }
        }
        // A named domain that cannot be worked is refused, unless the caller
        // asked for the unnamed queue's leniency over its names.
        let named = !p.domains.is_empty() && !p.skip_unavailable;
        let mut items = Vec::new();
        let mut swept = Vec::new();
        let mut visible_everywhere = true;
        let QueueScope {
            domains: scope,
            mut unreadable,
            pending,
        } = self.reflect_scope(&p.domains, p.skip_unavailable).await?;
        // A domain whose Reflection waits for engrams to leave its folder is
        // named, for a caller who reads that Reflection, so the person learns
        // why its queue is not there (names only, as for unreadable).
        let mut waiting = Vec::new();
        for domain in pending {
            if matches!(
                self.caller_reflection_right(&domain, caller).await,
                Ok((right, _)) if right >= ReflectionRight::Read
            ) {
                waiting.push(domain);
            }
        }
        for domain in scope {
            let access = match self
                .require_reflection(&domain, caller, ReflectionRight::Read)
                .await
            {
                Ok(access) => access,
                Err(e) if named => return Err(e),
                Err(_) => continue,
            };
            // One page answers every swept domain, so a domain that hides
            // engrams from the caller strips the sources of the whole page.
            visible_everywhere &= access.engrams_visible;
            match self.detect_reflection(&domain, &access, Detail::Full).await {
                Ok(found) => items.extend(found),
                Err(e) if named => return Err(e),
                // One domain that cannot be read never costs the whole
                // queue: it is named in the answer and left out.
                Err(e) => {
                    tracing::warn!("reflect: the queue of '{domain}' could not be read: {e}");
                    unreadable.push(domain);
                    continue;
                }
            }
            swept.push(domain);
        }
        let mut value =
            Self::page_json(&rank(items), &p.kinds, p.limit, p.page, visible_everywhere);
        value["scope"] = json!({ "domains": swept, "kinds": p.kinds });
        // Present only when a domain was left out, so a whole answer keeps
        // its shape.
        if !unreadable.is_empty() {
            value["scope"]["unreadable"] = json!(unreadable);
        }
        if !waiting.is_empty() {
            value["scope"]["pending"] = json!(waiting);
        }
        Ok(value)
    }

    /// One domain's queue for the REST view: the same detection, nothing recorded.
    pub async fn reflect_queue(
        &self,
        domain: &str,
        limit: Option<usize>,
        page: Option<usize>,
        caller: &ReflectionCaller,
    ) -> Result<Value> {
        let access = self
            .require_reflection(domain, caller, ReflectionRight::Read)
            .await?;
        let items = rank(
            self.detect_reflection(domain, &access, Detail::Full)
                .await?,
        );
        let mut value = Self::page_json(&items, &[], limit, page, access.engrams_visible);
        value["domain"] = json!(domain);
        Ok(value)
    }

    /// The review screen's data: open threads split by who they wait on,
    /// grouped by reflection, oldest first, and the queue's first page.
    pub async fn reflection_review(
        &self,
        domain: &str,
        caller: &ReflectionCaller,
    ) -> Result<Value> {
        let access = self
            .require_reflection(domain, caller, ReflectionRight::Read)
            .await?;
        let mut people: BTreeMap<String, Vec<Value>> = BTreeMap::new();
        let mut agent: BTreeMap<String, Vec<Value>> = BTreeMap::new();
        let mut titles: HashMap<String, String> = HashMap::new();
        for (path, thread, text) in self.all_threads(&access).await? {
            if thread.status != ThreadStatus::Open {
                continue;
            }
            titles
                .entry(path.clone())
                .or_insert_with(|| r::title_of(&text, &path));
            let bucket = match th::waiting_on(&thread) {
                Waiting::People => &mut people,
                Waiting::Agent => &mut agent,
            };
            // `thread_view` resolves the anchor by id or by heading.
            bucket
                .entry(path.clone())
                .or_default()
                .push(thread_view(&path, &thread, &text));
        }
        // "Oldest" is the opening time, as in the thread list: threads
        // inside a group and the groups by their first thread.
        let opened = |t: &Value| t["opened_at"].as_str().unwrap_or_default().to_string();
        let groups = |map: BTreeMap<String, Vec<Value>>| -> Vec<Value> {
            let mut out: Vec<(String, Value)> = map
                .into_iter()
                .map(|(path, mut threads)| {
                    threads.sort_by_key(|t| opened(t));
                    let oldest = threads.first().map(opened).unwrap_or_default();
                    let title = titles.get(&path).cloned().unwrap_or_default();
                    (
                        oldest,
                        json!({ "path": path, "title": title, "threads": threads }),
                    )
                })
                .collect();
            out.sort_by(|a, b| a.0.cmp(&b.0));
            out.into_iter().map(|(_, v)| v).collect()
        };
        let items = rank(
            self.detect_reflection(domain, &access, Detail::Full)
                .await?,
        );
        let mut queue = Self::page_json(&items, &[], Some(50), Some(1), access.engrams_visible);
        queue["domain"] = json!(domain);
        Ok(json!({
            "domain": domain,
            "waiting_for_people": groups(people),
            "waiting_for_the_agent": groups(agent),
            "queue": queue,
        }))
    }

    /// Open items per domain the caller curates here, for the nudges (R9):
    /// a domain with no open item is left out, and so is one whose queue
    /// cannot be read (a nudge is a hint, never a failure).
    pub async fn reflect_open_counts(
        &self,
        domains: &[String],
        caller: &ReflectionCaller,
    ) -> Result<Vec<(String, usize)>> {
        let mut out = Vec::new();
        for domain in self.reflect_scope(domains, false).await?.domains {
            let Ok(access) = self
                .require_reflection(&domain, caller, ReflectionRight::Curate)
                .await
            else {
                continue;
            };
            let n = match self
                .detect_reflection(&domain, &access, Detail::Count)
                .await
            {
                Ok(items) => items.len(),
                Err(e) => {
                    tracing::warn!(
                        "reflect: the open items of '{domain}' could not be counted: {e}"
                    );
                    continue;
                }
            };
            if n > 0 {
                out.push((domain, n));
            }
        }
        Ok(out)
    }

    /// The domains whose Reflection `caller` curates here: what every nudge
    /// counts over.
    pub async fn curated_reflections(&self, caller: &ReflectionCaller) -> Result<BTreeSet<String>> {
        let mut out = BTreeSet::new();
        for domain in self.reflect_scope(&[], false).await?.domains {
            if self
                .require_reflection(&domain, caller, ReflectionRight::Curate)
                .await
                .is_ok()
            {
                out.insert(domain);
            }
        }
        Ok(out)
    }

    /// Count every Reflection's open items as the machine owner and record
    /// the counts in `<state_dir>/hooks/maintenance.json`, for the hooks and
    /// for `hook_status`. The daemon's count tick calls this; nothing else
    /// writes `reflect_open`.
    pub async fn record_reflect_counts(&self) -> Result<BTreeMap<String, u64>> {
        // The unnamed scope already leaves out a hidden copy and a read-only
        // domain, so nothing is filtered here.
        let counts: BTreeMap<String, u64> = self
            .reflect_open_counts(&[], &ReflectionCaller::owner())
            .await?
            .into_iter()
            .map(|(domain, n)| (domain, n as u64))
            .collect();
        if let Ok(state_dir) = self.journal_state_dir() {
            crate::maintenance::record_reflect_open_under(&state_dir, &counts);
        }
        Ok(counts)
    }
}
