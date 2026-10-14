//! `discuss`: threads on a passage of a document, stored where the
//! document's kind keeps them. The verbs are target neutral: the right, the
//! thread file, the lock, the section lookup and the anchor check come from
//! the `ThreadTarget`, whose one variant is a Reflection page.

use crystalline_core::reflection as r;
use crystalline_core::threads::{
    self as th, Entry, EntryKind, SectionRef, Thread, ThreadError, ThreadStatus, ThreadTarget,
};

use super::reflection::{ReflectionAccess, thread_view};
use super::*;
use crate::scope::{ReflectionCaller, ReflectionRight};

/// The access a target's right check answers.
enum TargetAccess {
    Reflection(ReflectionAccess),
}

/// Whether an agent's thread text links to engrams, which the people who
/// read threads may not be able to see.
fn links_to_engrams(text: &str) -> bool {
    text.contains("[[") || text.contains(crystalline_core::address::SCHEME)
}

const PLAIN_WORDS: &str = "thread text is read by people who may not see engrams: say it in plain words, without engram links ([[...]] or crystalline:// addresses)";

/// Reading and commenting are one level, with one exception that comes from
/// being anonymous, not from a level: the anonymous visitor of a public
/// domain reads threads and never writes one.
fn refuse_anonymous_comment(caller: &ReflectionCaller) -> Result<()> {
    if caller.may_comment() {
        return Ok(());
    }
    Err(EngineError::Forbidden(
        super::reflection::ANONYMOUS_COMMENT.to_string(),
    ))
}

/// One entry by `caller`, now.
fn entry(kind: EntryKind, caller: &ReflectionCaller, text: &str) -> Entry {
    Entry {
        at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        kind,
        author: caller.author.clone(),
        text: text.to_string(),
    }
}

/// A thread-file failure as the engine answers it: an unknown thread is not
/// found (404), a refused entry is a malformed request.
fn thread_error(e: ThreadError) -> EngineError {
    match e {
        ThreadError::NoThread(_) => EngineError::NotFound(e.to_string()),
        ThreadError::Refused(why) => EngineError::Invalid(why),
    }
}

impl Engine {
    /// The target's right check, at `need`.
    async fn target_access(
        &self,
        domain: &str,
        target: &ThreadTarget,
        caller: &ReflectionCaller,
        need: ReflectionRight,
    ) -> Result<TargetAccess> {
        match target {
            ThreadTarget::Reflection { path } => {
                let access = self.require_reflection(domain, caller, need).await?;
                r::validate_reflection_path(path).map_err(EngineError::Invalid)?;
                Ok(TargetAccess::Reflection(access))
            }
        }
    }

    /// The document's own file and its thread file. The document's file is
    /// the one whose lock every write to either takes.
    fn target_files(target: &ThreadTarget, access: &TargetAccess) -> (PathBuf, PathBuf) {
        match (target, access) {
            (ThreadTarget::Reflection { path }, TargetAccess::Reflection(access)) => {
                (access.abs(path), access.abs(&r::threads_path(path)))
            }
        }
    }

    /// `discuss`: dispatch on the action.
    pub async fn discuss(&self, p: &DiscussParams, caller: &ReflectionCaller) -> Result<Value> {
        let path = || {
            p.path.as_deref().ok_or_else(|| {
                EngineError::Invalid("this action needs `path`, the reflection".into())
            })
        };
        let thread = || {
            p.thread.as_deref().ok_or_else(|| {
                EngineError::Invalid("this action needs `thread`, the thread id".into())
            })
        };
        let text = p.text.as_deref().unwrap_or("");
        match p.action.as_deref().unwrap_or("open") {
            "open" => self.open_reflection_thread(p, caller).await,
            "answer" => {
                self.reflection_thread_entry(
                    &p.domain,
                    path()?,
                    thread()?,
                    EntryKind::Comment,
                    text,
                    caller,
                )
                .await
            }
            "resolve" => {
                self.reflection_thread_entry(
                    &p.domain,
                    path()?,
                    thread()?,
                    EntryKind::Resolve,
                    text,
                    caller,
                )
                .await
            }
            "reopen" => {
                self.reflection_thread_entry(
                    &p.domain,
                    path()?,
                    thread()?,
                    EntryKind::Reopen,
                    text,
                    caller,
                )
                .await
            }
            "list" => {
                self.list_reflection_threads(
                    &p.domain,
                    p.path.as_deref(),
                    p.status.as_deref().unwrap_or("open"),
                    caller,
                )
                .await
            }
            other => Err(EngineError::Invalid(format!(
                "`{other}` is not a discuss action; use open, answer, resolve, reopen or list"
            ))),
        }
    }

    /// Open a thread on a Reflection page.
    pub async fn open_reflection_thread(
        &self,
        p: &DiscussParams,
        caller: &ReflectionCaller,
    ) -> Result<Value> {
        let path = p
            .path
            .clone()
            .ok_or_else(|| EngineError::Invalid("open needs `path`, the reflection".into()))?;
        self.open_thread(&p.domain, &ThreadTarget::Reflection { path }, p, caller)
            .await
    }

    /// Add an entry to a thread on a Reflection page.
    pub async fn reflection_thread_entry(
        &self,
        domain: &str,
        path: &str,
        id: &str,
        kind: EntryKind,
        text: &str,
        caller: &ReflectionCaller,
    ) -> Result<Value> {
        self.thread_entry(
            domain,
            &ThreadTarget::Reflection {
                path: path.to_string(),
            },
            id,
            kind,
            text,
            caller,
        )
        .await
    }

    /// Open a thread on `target`.
    pub async fn open_thread(
        &self,
        domain: &str,
        target: &ThreadTarget,
        p: &DiscussParams,
        caller: &ReflectionCaller,
    ) -> Result<Value> {
        if self.read_only {
            return Err(EngineError::ReadOnly);
        }
        let need = if p.answers_feedback {
            ReflectionRight::Curate
        } else {
            ReflectionRight::Read
        };
        let access = self.target_access(domain, target, caller, need).await?;
        self.refuse_read_only_domain(domain, &crate::scope::Scope::Unrestricted)
            .await?;
        refuse_anonymous_comment(caller)?;
        let key = p.section.as_deref().ok_or_else(|| {
            EngineError::Invalid("open needs `section`, an id or a heading".into())
        })?;
        let text = p
            .text
            .as_deref()
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .ok_or_else(|| {
                EngineError::Invalid("open needs `text`, what you want to say".into())
            })?;
        if caller.author.agent && links_to_engrams(text) {
            return Err(EngineError::Invalid(PLAIN_WORDS.to_string()));
        }
        let (doc_abs, threads_abs) = Self::target_files(target, &access);
        // One lock per document: the page's, for the page and its threads
        // file alike.
        let _lock = self.lock_file(&doc_abs).await;
        let (thread, document, page_update) = match (target, &access) {
            (ThreadTarget::Reflection { path }, TargetAccess::Reflection(_)) => {
                let page = read_opt(&doc_abs)?.ok_or_else(|| {
                    EngineError::NotFound(format!("no reflection '{path}' in domain '{domain}'"))
                })?;
                let sections = r::split_sections(&page);
                let section = r::find_section(&sections, key)
                    .filter(|s| s.id.as_deref() != Some(r::TOP_SECTION) || key == r::TOP_SECTION)
                    .ok_or_else(|| {
                        EngineError::Invalid(format!("no section '{key}' in '{path}'"))
                    })?;
                // A heading a plain editor added has no id yet. A comment
                // never rewrites the page (a reader may open a thread, and a
                // rewrite would make a person's open editor stale), so the
                // thread anchors on the heading instead; it keeps resolving
                // by heading once a later write gives the section its id.
                let section_ref = match &section.id {
                    Some(id) => SectionRef::Id(id.clone()),
                    None => SectionRef::Heading(section.heading.clone()),
                };
                let anchor = th::Anchor {
                    section: section_ref,
                    quote: p.quote.clone().filter(|q| !q.trim().is_empty()),
                    occurrence: p.occurrence.unwrap_or(1).max(1),
                };
                if let Some(quote) = anchor.quote.as_deref()
                    && !matches!(
                        r::anchor_state(&page, &anchor),
                        th::AnchorState::Found { .. }
                    )
                {
                    return Err(EngineError::Invalid(format!(
                        "'{quote}' is not in section '{key}' of '{path}' (occurrence {})",
                        anchor.occurrence
                    )));
                }
                let thread = Thread {
                    id: th::random_thread_id(),
                    anchor,
                    status: ThreadStatus::Open,
                    entries: vec![entry(EntryKind::Comment, caller, text)],
                };
                // The Reflection target's hook: a thread that answers a
                // person's change records itself on the section. A feedback
                // item belongs to a section with an id, so a heading without
                // one has none to answer.
                let page_update = if p.answers_feedback {
                    let id = thread.anchor.section.id().ok_or_else(|| {
                        EngineError::Invalid(format!(
                            "section '{key}' of '{path}' has no id yet, so it has no change to answer; open a plain thread instead"
                        ))
                    })?;
                    let mut prov = r::read_provenance(&page);
                    prov.entry(id.to_string()).or_default().answered_by = Some(thread.id.clone());
                    Some(r::write_provenance(&page, &prov).map_err(EngineError::Invalid)?)
                } else {
                    None
                };
                (thread, page, page_update)
            }
        };
        // The thread first, then the page that names it: a failed page write
        // leaves a plain thread, never a section that waits on a thread that
        // is not there.
        let existing = read_opt(&threads_abs)?.unwrap_or_default();
        write_file(&threads_abs, &th::open_thread(&existing, &thread))?;
        let mut document = document;
        if let Some(page) = page_update {
            match (target, &access) {
                (ThreadTarget::Reflection { path }, TargetAccess::Reflection(access)) => {
                    write_file(&doc_abs, &page)?;
                    self.index_reflection(access.domain_id, path, &page, &doc_abs)
                        .await?;
                }
            }
            document = page;
        }
        Ok(match target {
            ThreadTarget::Reflection { path } => thread_view(path, &thread, &document),
        })
    }

    /// Add an entry to thread `id` on `target`.
    pub async fn thread_entry(
        &self,
        domain: &str,
        target: &ThreadTarget,
        id: &str,
        kind: EntryKind,
        text: &str,
        caller: &ReflectionCaller,
    ) -> Result<Value> {
        if self.read_only {
            return Err(EngineError::ReadOnly);
        }
        let access = self
            .target_access(domain, target, caller, ReflectionRight::Read)
            .await?;
        self.refuse_read_only_domain(domain, &crate::scope::Scope::Unrestricted)
            .await?;
        refuse_anonymous_comment(caller)?;
        let text = text.trim();
        if kind == EntryKind::Comment && text.is_empty() {
            return Err(EngineError::Invalid("answer needs `text`".into()));
        }
        if caller.author.agent && links_to_engrams(text) {
            return Err(EngineError::Invalid(PLAIN_WORDS.to_string()));
        }
        let (doc_abs, threads_abs) = Self::target_files(target, &access);
        // The page's lock, as in `open_thread`: a thread entry and a page
        // write, move or delete never interleave.
        let _lock = self.lock_file(&doc_abs).await;
        let document = match target {
            ThreadTarget::Reflection { path } => read_opt(&doc_abs)?.ok_or_else(|| {
                EngineError::NotFound(format!("no reflection '{path}' in domain '{domain}'"))
            })?,
        };
        let file = read_opt(&threads_abs)?
            .ok_or_else(|| EngineError::NotFound(format!("no thread {id} here")))?;
        let updated =
            th::append_entry(&file, id, &entry(kind, caller, text)).map_err(thread_error)?;
        write_file(&threads_abs, &updated)?;
        let thread = th::parse_threads(&updated)
            .into_iter()
            .find(|t| t.id == id)
            .expect("just appended");
        Ok(match target {
            ThreadTarget::Reflection { path } => thread_view(path, &thread, &document),
        })
    }

    /// Every thread of a domain's Reflection, filtered by page and status,
    /// oldest first.
    pub async fn list_reflection_threads(
        &self,
        domain: &str,
        path: Option<&str>,
        status: &str,
        caller: &ReflectionCaller,
    ) -> Result<Value> {
        let access = self
            .require_reflection(domain, caller, ReflectionRight::Read)
            .await?;
        let wanted = |t: &Thread| match status {
            "all" => true,
            "resolved" => t.status == ThreadStatus::Resolved,
            _ => t.status == ThreadStatus::Open,
        };
        let mut threads: Vec<(String, Thread, String)> = self
            .all_threads(&access)
            .await?
            .into_iter()
            .filter(|(p, t, _)| path.is_none_or(|want| want == p) && wanted(t))
            .collect();
        threads.sort_by(|a, b| a.1.opened_at().cmp(b.1.opened_at()));
        Ok(json!({
            "threads": threads
                .iter()
                .map(|(p, t, text)| thread_view(p, t, text))
                .collect::<Vec<_>>()
        }))
    }

    /// Every thread of a domain's Reflection with its reflection's path and
    /// current text.
    pub(crate) async fn all_threads(
        &self,
        access: &ReflectionAccess,
    ) -> Result<Vec<(String, Thread, String)>> {
        let rows = self
            .store
            .lock()
            .await
            .list_reflections(access.domain_id)
            .await?;
        let mut out = Vec::new();
        for row in rows {
            let Some(file) = read_opt(&access.abs(&r::threads_path(&row.path)))? else {
                continue;
            };
            for thread in th::parse_threads(&file) {
                out.push((row.path.clone(), thread, row.content.clone()));
            }
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crystalline_core::config::DomainEntry;
    use crystalline_index::TursoStore;

    const MANIFEST: &str = "---\ntype: manifest\ntitle: eng\npermalink: manifest\ntags:\n  - manifest\nstatus: stable\nrecorded_at: 2026-01-01\nreflection: on\n---\n\n# eng\n\n## Scope\n\n- Everything about eng\n\n## When to Use\n\n- Route here for eng questions\n";

    const PAGE: &str = "# D\n\n## Night deploys\n<!-- r:aaaa1111 -->\n\nDeploys run at night.\n";

    /// A file domain `eng` with its Reflection on and one page, `d.md`.
    async fn reflecting(tmp: &Path) -> (Arc<Engine>, PathBuf) {
        let root = tmp.join("eng");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("MANIFEST.md"), MANIFEST).unwrap();
        let store = TursoStore::open_in_memory().await.unwrap();
        let mut config = GlobalConfig::default();
        config
            .domains
            .insert("eng".to_string(), DomainEntry::file(root.clone()));
        let engine = Arc::new(
            Engine::new(Arc::new(Mutex::new(store)), config, None, None)
                .with_state_dir(tmp.join("state"))
                .with_origins_dir(tmp.join("origins")),
        );
        engine.sync(None).await.unwrap();
        let caller = ReflectionCaller::person(crate::scope::Scope::Unrestricted, "jordi");
        engine
            .write_reflection(
                &crate::params::WriteReflectionParams {
                    domain: "eng".into(),
                    path: "d.md".into(),
                    markdown: Some(PAGE.into()),
                    ..Default::default()
                },
                &caller,
            )
            .await
            .unwrap();
        (engine, root.join("reflections/d.md"))
    }

    fn open_params(text: &str) -> DiscussParams {
        DiscussParams {
            domain: "eng".into(),
            path: Some("d.md".into()),
            section: Some("aaaa1111".into()),
            text: Some(text.into()),
            ..Default::default()
        }
    }

    /// Every write to a threads file runs under the page's own lock, the one
    /// a page write, move or delete takes: with that lock held from outside,
    /// an open and an answer both wait, and each reads the files only once
    /// it is theirs. A page moved away underneath them is then not found,
    /// and nothing is written beside the old path.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_thread_write_waits_on_the_page_lock() {
        let tmp = tempfile::tempdir().unwrap();
        let (engine, page_abs) = reflecting(tmp.path()).await;
        let caller = ReflectionCaller::person(crate::scope::Scope::Unrestricted, "jordi");
        let opened = engine
            .discuss(&open_params("Still true?"), &caller)
            .await
            .unwrap();
        let id = opened["id"].as_str().unwrap().to_string();
        let threads_abs = page_abs.with_file_name("d.threads.md");

        let lock = engine.write_lock(&page_abs);
        let held = lock.lock().await;
        let (opener, answerer) = (engine.clone(), engine.clone());
        let (open_caller, answer_caller) = (caller.clone(), caller.clone());
        let open = tokio::spawn(async move {
            opener
                .discuss(&open_params("Another one"), &open_caller)
                .await
        });
        let answer = tokio::spawn(async move {
            answerer
                .reflection_thread_entry(
                    "eng",
                    "d.md",
                    &id,
                    EntryKind::Comment,
                    "Yes.",
                    &answer_caller,
                )
                .await
        });
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        assert!(!open.is_finished(), "the open waits on the page's lock");
        assert!(!answer.is_finished(), "the answer waits on the page's lock");

        // What a move does under that lock: the page and its threads leave.
        let moved = page_abs.with_file_name("moved.md");
        std::fs::rename(&page_abs, &moved).unwrap();
        std::fs::rename(&threads_abs, moved.with_file_name("moved.threads.md")).unwrap();
        drop(held);

        let open = open.await.unwrap().unwrap_err();
        assert!(matches!(open, EngineError::NotFound(_)), "{open:?}");
        let answer = answer.await.unwrap().unwrap_err();
        assert!(matches!(answer, EngineError::NotFound(_)), "{answer:?}");
        assert!(
            !threads_abs.exists(),
            "no threads file is left at the old path"
        );
        assert!(!page_abs.exists());
    }
}
