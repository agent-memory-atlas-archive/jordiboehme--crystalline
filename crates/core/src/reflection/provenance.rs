//! The per-section bookkeeping a reflection carries in its frontmatter under
//! [`PROVENANCE_KEY`]. None of it is shown to people; whether a section's
//! text changed since the last reflect is derived, never stored.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::frontmatter::{key_blocks, split_frontmatter};
use crate::reflection::sections::{Section, section_hash};

/// The frontmatter key holding the per-section records.
pub const PROVENANCE_KEY: &str = "reflection";

/// One engram a section was built from, with its checksum at that time.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SourceRef {
    /// The engram's permalink in this domain.
    pub engram: String,
    /// SHA-256 hex of the engram file when the section was reflected.
    pub checksum: String,
}

/// What Crystalline keeps about one section.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SectionRecord {
    /// The engrams the section was built from.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sources: Vec<SourceRef>,
    /// The section hash at the last reflect.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reflected: Option<String>,
    /// When a write through Crystalline last changed the text, RFC 3339.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub changed_at: Option<String>,
    /// Who changed the text since the last reflect, in order, no repeats.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub changed_by: Vec<String>,
    /// The open thread that answers the current feedback item, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub answered_by: Option<String>,
}

/// The records of a reflection, by section id.
pub type Provenance = BTreeMap<String, SectionRecord>;

fn provenance_block(provenance: &Provenance) -> Result<String, String> {
    let mut map = serde_yaml_ng::Mapping::new();
    map.insert(
        PROVENANCE_KEY.into(),
        serde_yaml_ng::to_value(provenance).map_err(|e| e.to_string())?,
    );
    serde_yaml_ng::to_string(&map).map_err(|e| e.to_string())
}

/// The records in `source`'s frontmatter; empty when there is no
/// frontmatter, no key, or it does not read as a map. One record that does
/// not read is dropped and the others are kept, so a hand edit that breaks
/// one section's record never costs the rest their sources on the next
/// write.
pub fn read_provenance(source: &str) -> Provenance {
    let Some(parts) = split_frontmatter(source) else {
        return Provenance::new();
    };
    let Ok(serde_yaml_ng::Value::Mapping(map)) = serde_yaml_ng::from_str(parts.yaml) else {
        return Provenance::new();
    };
    let Some(serde_yaml_ng::Value::Mapping(records)) = map.get(PROVENANCE_KEY) else {
        return Provenance::new();
    };
    records
        .iter()
        .filter_map(|(id, record)| {
            let id = match id {
                serde_yaml_ng::Value::String(id) => id.clone(),
                other => serde_yaml_ng::to_string(other).ok()?.trim().to_string(),
            };
            serde_yaml_ng::from_value::<SectionRecord>(record.clone())
                .ok()
                .map(|record| (id, record))
        })
        .collect()
}

/// The [`PROVENANCE_KEY`] block of `source` as YAML, in whatever shape it
/// was written, or `None` when there is none. A write holds the block it was
/// sent against the stored page's this way: a block a writer made up (`for:`,
/// `built_from:`) reads as no records at all, so comparing records would take
/// it for the stored one.
pub fn block_as_written(source: &str) -> Option<String> {
    let parts = split_frontmatter(source)?;
    let serde_yaml_ng::Value::Mapping(map) = serde_yaml_ng::from_str(parts.yaml).ok()? else {
        return None;
    };
    serde_yaml_ng::to_string(map.get(PROVENANCE_KEY)?).ok()
}

/// `source` with its records replaced by `provenance`: the key block is
/// rewritten in place, appended when absent, removed when `provenance` is
/// empty. A page with no frontmatter gets one only when there is something
/// to record, and a frontmatter that held nothing but the records goes with
/// them; one the author wrote (an empty one too) stays. `Err` when the
/// frontmatter cannot be cut into key blocks.
pub fn write_provenance(source: &str, provenance: &Provenance) -> Result<String, String> {
    let Some(parts) = split_frontmatter(source) else {
        if provenance.is_empty() {
            return Ok(source.to_string());
        }
        return Ok(format!(
            "---\n{}---\n\n{source}",
            provenance_block(provenance)?
        ));
    };
    let blocks = key_blocks(parts.yaml).ok_or_else(|| {
        "this reflection's frontmatter cannot be read key by key (a flow-style block, a line before the first key, or a key that does not stand on its own); write it as plain `key: value` lines"
            .to_string()
    })?;
    let mut yaml = blocks.preamble.clone();
    let mut placed = false;
    for block in &blocks.blocks {
        if block.key == PROVENANCE_KEY {
            if !placed && !provenance.is_empty() {
                yaml.push_str(&provenance_block(provenance)?);
            }
            placed = true;
            continue;
        }
        yaml.push_str(&block.text);
        if !block.text.ends_with('\n') {
            yaml.push('\n');
        }
    }
    if !placed && !provenance.is_empty() {
        yaml.push_str(&provenance_block(provenance)?);
    }
    let had_records = blocks.blocks.iter().any(|b| b.key == PROVENANCE_KEY);
    if had_records && yaml.trim().is_empty() {
        return Ok(parts.body.trim_start_matches(['\n', '\r']).to_string());
    }
    Ok(format!("{}{yaml}{}{}", parts.open, parts.close, parts.body))
}

/// A reflection's title: the frontmatter `title`, else the first `# `
/// heading outside fenced code, else the file stem.
pub fn title_of(source: &str, path: &str) -> String {
    if let Some(parts) = split_frontmatter(source)
        && let Ok(serde_yaml_ng::Value::Mapping(map)) = serde_yaml_ng::from_str(parts.yaml)
        && let Some(serde_yaml_ng::Value::String(title)) = map.get("title")
        && !title.trim().is_empty()
    {
        return title.trim().to_string();
    }
    if let Some(heading) = crate::headings::heading_spans(source)
        .into_iter()
        .find(|h| h.level == 1)
    {
        return heading.text.trim().to_string();
    }
    let name = path.rsplit('/').next().unwrap_or(path);
    name.strip_suffix(".md").unwrap_or(name).to_string()
}

/// Whether a section's text differs from what was last reflected.
pub fn text_changed(record: Option<&SectionRecord>, section: &Section) -> bool {
    record
        .and_then(|r| r.reflected.as_deref())
        .is_none_or(|hash| hash != section_hash(&section.text))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::reflection::sections::split_sections;

    const PAGE: &str = "---\ntitle: Deploying\ntags: [ops]\n---\n\n# Deploying\n\n## Night deploys\n<!-- r:7f3a9c2e -->\n\nDeploys run at night.\n";

    /// The block as it stands, in any shape: what a writer's block is held
    /// against, so a page sent back as it was read is told nothing.
    #[test]
    fn the_block_is_read_as_written() {
        let theirs = "---\nreflection:\n  for: new operators\n---\n\n# A\n";
        assert_eq!(
            block_as_written(theirs).as_deref(),
            Some("for: new operators\n")
        );
        assert!(read_provenance(theirs).is_empty(), "not a record");
        assert_eq!(block_as_written(PAGE), None);
        assert_eq!(block_as_written("# No frontmatter\n"), None);
    }

    fn record() -> SectionRecord {
        SectionRecord {
            sources: vec![SourceRef {
                engram: "runbooks/deploy".into(),
                checksum: "abc".into(),
            }],
            reflected: Some("hash".into()),
            changed_at: None,
            changed_by: vec![],
            answered_by: None,
        }
    }

    #[test]
    fn provenance_round_trips_and_keeps_the_rest_of_the_frontmatter() {
        let mut prov = Provenance::new();
        prov.insert("7f3a9c2e".into(), record());
        let written = write_provenance(PAGE, &prov).unwrap();
        assert!(written.starts_with("---\ntitle: Deploying\ntags: [ops]\nreflection:\n"));
        assert!(
            written.ends_with("## Night deploys\n<!-- r:7f3a9c2e -->\n\nDeploys run at night.\n")
        );
        assert_eq!(read_provenance(&written), prov);
        let rewritten = write_provenance(&written, &prov).unwrap();
        assert_eq!(rewritten, written, "idempotent");
        let cleared = write_provenance(&written, &Provenance::new()).unwrap();
        assert_eq!(cleared, PAGE, "an empty map removes the key");
    }

    #[test]
    fn a_page_without_frontmatter_gets_one_only_when_there_is_something_to_say() {
        let bare = "# Bare\n\n## A\n<!-- r:aaaa1111 -->\n\nText.\n";
        assert_eq!(write_provenance(bare, &Provenance::new()).unwrap(), bare);
        let mut prov = Provenance::new();
        prov.insert("aaaa1111".into(), record());
        let written = write_provenance(bare, &prov).unwrap();
        assert!(written.starts_with("---\nreflection:\n"));
        assert!(written.ends_with(bare));
        assert_eq!(
            write_provenance(&written, &Provenance::new()).unwrap(),
            bare,
            "a frontmatter that only held the records goes with them"
        );
        assert_eq!(read_provenance(bare), Provenance::new());
        assert_eq!(
            read_provenance("---\nreflection: [broken\n---\n"),
            Provenance::new()
        );
    }

    #[test]
    fn an_empty_frontmatter_the_author_wrote_is_kept() {
        let page = "---\n---\n\n# P\n";
        assert_eq!(write_provenance(page, &Provenance::new()).unwrap(), page);
    }

    #[test]
    fn one_record_that_does_not_read_costs_only_itself() {
        let page = "---\nreflection:\n  aaaa1111:\n    reflected: x\n  bbbb2222: 5\n---\n\n# P\n";
        let prov = read_provenance(page);
        assert_eq!(
            prov.keys().collect::<Vec<_>>(),
            ["aaaa1111"],
            "the others survive: {prov:?}"
        );
        assert_eq!(prov["aaaa1111"].reflected.as_deref(), Some("x"));
    }

    #[test]
    fn titles_come_from_the_frontmatter_the_heading_or_the_name() {
        assert_eq!(title_of(PAGE, "guides/deploying.md"), "Deploying");
        assert_eq!(title_of("# From heading\n", "a.md"), "From heading");
        assert_eq!(
            title_of("no heading\n", "guides/night-deploys.md"),
            "night-deploys"
        );
        assert_eq!(
            title_of("```\n# not a title\n```\n\n# Real title\n", "a.md"),
            "Real title",
            "a heading inside a fence is no title"
        );
    }

    #[test]
    fn text_changed_is_derived_from_the_reflected_hash() {
        let sections = split_sections(PAGE);
        let mut rec = record();
        assert!(
            text_changed(Some(&rec), &sections[1]),
            "the stored hash is not this text's"
        );
        rec.reflected = Some(crate::reflection::sections::section_hash(&sections[1].text));
        assert!(!text_changed(Some(&rec), &sections[1]));
        assert!(text_changed(None, &sections[1]), "never reflected");
    }
}
