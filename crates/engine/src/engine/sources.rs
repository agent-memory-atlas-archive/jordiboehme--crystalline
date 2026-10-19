//! Reflection sources from other domains: how a write names one, the facts
//! a page's sources are held against, and what a reader may see of them.
//!
//! A source with no `domain` is an engram of the page's own domain, as
//! every source was before; one with a `domain` names another domain by its
//! canonical name. Its facts are read with one seek per cited permalink in
//! that domain, never a scan of it. A domain that cannot be checked here
//! (not registered on this instance, or a local copy a connected server
//! hides) makes its sources `unavailable`, never `missing`.

use crystalline_core::names::NameTable;
use crystalline_core::reflection as r;

use super::reflection::EngramFact;
use super::*;
use crate::scope::Scope;

/// What a queue item says about sources in a domain the caller cannot
/// open, by the item's `what`: the item stands, with no title, permalink,
/// domain or state of those sources.
pub(crate) fn hidden_source_note(what: &str) -> &'static str {
    match what {
        "source_retired" => "a source in a domain you cannot open was retired",
        "source_missing" => "a source in a domain you cannot open is missing",
        "source_unavailable" => "a source in a domain you cannot open cannot be checked here",
        _ => "a source in a domain you cannot open has changed",
    }
}

/// What a `source_unavailable` item says to a caller who may open the
/// domain, with how to clear it.
pub(crate) fn unavailable_note(domain: &str) -> String {
    format!(
        "sources in {domain} cannot be checked here; keep them while the domain may come back, or drop one by writing its section's sources without it"
    )
}

/// The facts a set of sources is held against: the page's own domain's,
/// and per other domain (by the name a source stores) its cited engrams'
/// facts, or `None` when that domain cannot be checked here.
#[derive(Debug, Default)]
pub(crate) struct SourceFacts {
    /// The page's own domain, by permalink.
    pub own: HashMap<String, EngramFact>,
    foreign: HashMap<String, Option<HashMap<String, EngramFact>>>,
}

impl SourceFacts {
    /// The engram `src` names, when its domain was read and holds it.
    pub(crate) fn fact(&self, src: &r::SourceRef) -> Option<&EngramFact> {
        match src.domain.as_deref() {
            None => self.own.get(&src.engram),
            Some(domain) => self.foreign.get(domain)?.as_ref()?.get(&src.engram),
        }
    }

    /// Whether `src` is in a domain that cannot be checked here.
    pub(crate) fn unavailable(&self, src: &r::SourceRef) -> bool {
        src.domain
            .as_deref()
            .is_some_and(|domain| !matches!(self.foreign.get(domain), Some(Some(_))))
    }
}

/// What one reader may see of the sources of another domain: the sources
/// of a domain the reader may read engrams in (knowledge Read, the
/// `hidden_for` rule), and for a reader with no restriction every source.
/// The page's own sources are the caller's `engrams_visible` to decide.
pub(crate) struct SourceSight {
    /// `None`: the reader sees every domain, also one not registered here.
    hidden: Option<HashSet<String>>,
    table: Arc<NameTable>,
}

impl SourceSight {
    /// Whether the reader may see `src`. A domain name that resolves to no
    /// registered domain is seen only by a reader with no restriction, so a
    /// name no rights decision covers is never shown to anyone else.
    pub(crate) fn sees(&self, src: &r::SourceRef) -> bool {
        let Some(domain) = src.domain.as_deref() else {
            return true;
        };
        match &self.hidden {
            None => true,
            Some(hidden) => self
                .table
                .resolve(domain)
                .is_some_and(|local| !hidden.contains(local)),
        }
    }

    /// `text` with the sources this reader may not see taken out of its
    /// `reflection:` block; the text as it is when there are none. What
    /// `read_reflection` answers as `markdown`, so the raw block never names
    /// a domain or an engram the reader may not see.
    pub(crate) fn shown_text(&self, text: &str) -> String {
        let mut prov = r::read_provenance(text);
        let mut cut = false;
        for record in prov.values_mut() {
            let before = record.sources.len();
            record.sources.retain(|src| self.sees(src));
            cut |= record.sources.len() != before;
        }
        if !cut {
            return text.to_string();
        }
        r::write_provenance(text, &prov)
            .unwrap_or_else(|_| super::reflection::without_provenance(text))
    }
}

/// One entry of a write's `sources`, resolved.
#[derive(Debug, Clone)]
pub(crate) struct NamedSource {
    /// The name the record stores: `None` for the page's own domain, else
    /// the domain's canonical name.
    pub domain: Option<String>,
    pub permalink: String,
}

impl NamedSource {
    /// How a refusal names the source: the permalink, or the address.
    pub(crate) fn said(&self) -> String {
        match &self.domain {
            None => self.permalink.clone(),
            Some(domain) => format!(
                "{}{domain}/{}",
                crystalline_core::address::SCHEME,
                self.permalink
            ),
        }
    }

    /// The record this source becomes, with `checksum`.
    pub(crate) fn source_ref(&self, checksum: &str) -> r::SourceRef {
        r::SourceRef {
            domain: self.domain.clone(),
            engram: self.permalink.clone(),
            checksum: checksum.to_string(),
        }
    }
}

impl Engine {
    /// What `scope` may see of other domains' sources.
    pub(crate) async fn source_sight(&self, scope: &Scope) -> Result<SourceSight> {
        let hidden = self.hidden_domains(scope).await?.map(|mut hidden| {
            hidden.extend(self.shadowed_domains());
            hidden
        });
        Ok(SourceSight {
            hidden,
            table: self.name_table_now().await,
        })
    }

    /// The registered local domain a stored source domain names, when it can
    /// be checked here: a name that resolves to a domain this instance
    /// registered and a connected server does not hide.
    fn checkable_domain(&self, table: &NameTable, name: &str) -> Option<String> {
        let local = table.resolve(name)?;
        (self.knows_domain(local) && !self.shadowed_domains().contains(local))
            .then(|| local.to_string())
    }

    /// The entries of a write's `sources`, each resolved: a bare permalink
    /// is the page's own, and so is an address whose domain (in any
    /// spelling) is the page's. Another domain must be one `scope` may read
    /// engrams in; one it may not see, one nobody registered here and one a
    /// connected server serves are refused with the bytes an unknown domain
    /// gets, naming the spelling the writer used, so a private domain's
    /// existence never shows.
    pub(crate) async fn resolve_source_names<'a>(
        &self,
        own: &str,
        scope: &Scope,
        names: impl Iterator<Item = &'a String>,
    ) -> Result<HashMap<String, NamedSource>> {
        let mut out = HashMap::new();
        let mut context: Option<(Arc<NameTable>, HashSet<String>)> = None;
        for name in names {
            if out.contains_key(name) {
                continue;
            }
            let (spelled, permalink) =
                match r::parse_source_name(name).map_err(EngineError::Invalid)? {
                    r::SourceName::Own(permalink) => {
                        out.insert(
                            name.clone(),
                            NamedSource {
                                domain: None,
                                permalink,
                            },
                        );
                        continue;
                    }
                    r::SourceName::Address { domain, permalink } => (domain, permalink),
                };
            if context.is_none() {
                context = Some((self.name_table_now().await, self.hidden_for(scope).await?));
            }
            let (table, hidden) = context.as_ref().expect("filled above");
            let Some(local) = table
                .resolve(&spelled)
                .filter(|local| self.knows_domain(local) && !hidden.contains(*local))
            else {
                return Err(self.unknown_domain(&spelled, hidden));
            };
            let domain = if local == own {
                None
            } else {
                Some(table.normalize(&spelled).unwrap_or(&spelled).to_string())
            };
            out.insert(name.clone(), NamedSource { domain, permalink });
        }
        Ok(out)
    }

    /// The facts `sources` are held against. `own` is the page domain's
    /// facts when the caller read them already (the queue's scan of the
    /// whole domain); otherwise the page's own sources are read one seek
    /// each. Every other domain is read one seek per cited permalink, under
    /// one store lock per domain, and a domain that cannot be checked here
    /// is recorded as such.
    pub(crate) async fn source_facts<'a>(
        &self,
        own_id: DomainId,
        own: Option<HashMap<String, EngramFact>>,
        sources: impl Iterator<Item = &'a r::SourceRef>,
    ) -> Result<SourceFacts> {
        let mut own_wanted: BTreeSet<String> = BTreeSet::new();
        let mut foreign_wanted: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        for src in sources {
            match &src.domain {
                None => {
                    own_wanted.insert(src.engram.clone());
                }
                Some(domain) => {
                    foreign_wanted
                        .entry(domain.clone())
                        .or_default()
                        .insert(src.engram.clone());
                }
            }
        }
        let own = match own {
            Some(facts) => facts,
            None => {
                self.cited_facts(own_id, own_wanted.into_iter().collect())
                    .await?
            }
        };
        let mut foreign = HashMap::new();
        if !foreign_wanted.is_empty() {
            let table = self.name_table_now().await;
            for (name, permalinks) in foreign_wanted {
                let id = match self.checkable_domain(&table, &name) {
                    Some(local) => self.store.lock().await.domain_id(&local).await?,
                    None => None,
                };
                let facts = match id {
                    Some(id) => Some(
                        self.cited_facts(id, permalinks.into_iter().collect())
                            .await?,
                    ),
                    None => None,
                };
                foreign.insert(name, facts);
            }
        }
        Ok(SourceFacts { own, foreign })
    }
}
