//! Reflection-mode search: text search over a domain's reflection rows.
//!
//! A hit is one section. Every query term (lowercased, split on whitespace)
//! must occur in the section's text or the reflection's title; the score is
//! the number of term occurrences in the section plus 5 per term the title
//! holds. Hits rank by score, then path, then section order. Id lines never
//! reach a snippet: `split_sections` leaves them out of the text. The
//! snippet is the window the engram search cuts (`crate::snippet`).
//!
//! It is also where a reflection row is written: [`index_reflection_row`]
//! puts the row and its chunks in the index together (R53).

use serde::Serialize;

use crate::embed::ChunkParams;
use crate::error::Result;
use crate::snippet::make_snippet;
use crate::store::{DomainId, ReflectionRow, Store};
use crystalline_core::reflection::split_sections;

/// One section that matched.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ReflectionHit {
    /// The reflection's path inside `reflections/`.
    pub path: String,
    /// Its title.
    pub title: String,
    /// The section id, `_top` for the text before the first `##`, `None` for
    /// a heading with no id yet.
    pub section: Option<String>,
    /// The section heading, empty for the top.
    pub heading: String,
    /// The text around the first matching term, cut the way an engram hit's
    /// snippet is.
    pub snippet: String,
    /// The rank score: orders the hits, never part of an answer.
    #[serde(skip)]
    pub score: u32,
}

/// Search `rows` for `query`, best first, at most `limit` hits.
pub fn search_reflections(rows: &[ReflectionRow], query: &str, limit: usize) -> Vec<ReflectionHit> {
    let terms: Vec<String> = query.split_whitespace().map(str::to_lowercase).collect();
    if terms.is_empty() {
        return Vec::new();
    }
    let mut hits: Vec<(ReflectionHit, usize)> = Vec::new();
    for row in rows {
        let title = row.title.to_lowercase();
        for (order, section) in split_sections(&row.content).into_iter().enumerate() {
            let text = section.text.to_lowercase();
            if !terms
                .iter()
                .all(|t| text.contains(t.as_str()) || title.contains(t.as_str()))
            {
                continue;
            }
            let body: u32 = terms
                .iter()
                .map(|t| text.matches(t.as_str()).count() as u32)
                .sum();
            if body == 0 {
                continue;
            }
            let bonus: u32 = terms.iter().filter(|t| title.contains(t.as_str())).count() as u32 * 5;
            hits.push((
                ReflectionHit {
                    path: row.path.clone(),
                    title: row.title.clone(),
                    section: section.id.clone(),
                    heading: section.heading.clone(),
                    snippet: make_snippet(&section.text, &terms),
                    score: body + bonus,
                },
                order,
            ));
        }
    }
    hits.sort_by(|(a, ao), (b, bo)| {
        b.score
            .cmp(&a.score)
            .then(a.path.cmp(&b.path))
            .then(ao.cmp(bo))
    });
    hits.into_iter().take(limit).map(|(hit, _)| hit).collect()
}

/// Put one reflection's row and its chunks in the index (R53): the one
/// writer of reflection rows, called by the sync and by the engine, so a page
/// never has a row without the chunks of that same text.
pub async fn index_reflection_row<S: Store + ?Sized>(
    store: &S,
    domain: DomainId,
    row: &ReflectionRow,
    params: &ChunkParams,
) -> Result<()> {
    store.upsert_reflection(domain, row).await?;
    let chunks = crate::embed::chunk_reflection(&row.title, &row.content, params);
    store
        .replace_reflection_chunks(domain, &row.path, &chunks)
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(path: &str, title: &str, content: &str) -> ReflectionRow {
        ReflectionRow {
            path: path.into(),
            title: title.into(),
            content: content.into(),
            sha256: String::new(),
            size: 0,
            modified: String::new(),
        }
    }

    #[test]
    fn hits_are_sections_ranked_by_matches_and_title() {
        let rows = vec![
            row(
                "guides/deploying.md",
                "Deploying",
                "# Deploying\n\n## Night deploys\n<!-- r:aaaa1111 -->\n\nDeploys run at night. Night is quiet.\n\n## Rollback\n<!-- r:bbbb2222 -->\n\nRoll back with the script.\n",
            ),
            row(
                "howto/night.md",
                "Night shifts",
                "# Night shifts\n\nWho is on call at night.\n",
            ),
        ];
        let hits = search_reflections(&rows, "Night", 10);
        let got: Vec<(&str, Option<&str>)> = hits
            .iter()
            .map(|h| (h.path.as_str(), h.section.as_deref()))
            .collect();
        // howto/night.md: two body matches plus the title bonus (7); the
        // deploying section: three body matches and no title bonus (3).
        assert_eq!(
            got,
            [
                ("howto/night.md", Some("_top")),
                ("guides/deploying.md", Some("aaaa1111"))
            ]
        );
        assert!(hits[1].snippet.contains("Deploys run at night"));
        assert!(!hits[1].snippet.contains("<!-- r:"), "ids never show");
        assert!(
            search_reflections(&rows, "night script", 10).is_empty(),
            "every term in one section"
        );
        assert_eq!(
            search_reflections(&rows, "roll back", 10)[0].heading,
            "Rollback"
        );
        let best = search_reflections(&rows, "night", 1);
        assert_eq!(best.len(), 1);
        assert_eq!(best[0].path, "howto/night.md", "the cut keeps the best hit");
        assert!(search_reflections(&rows, "   ", 10).is_empty());
    }

    #[test]
    fn a_title_alone_makes_no_hit() {
        let rows = vec![row(
            "oncall.md",
            "Night shifts",
            "Who is on call.\n\n## Pager\n<!-- r:cccc3333 -->\n\nThe pager rings.\n",
        )];
        assert!(
            search_reflections(&rows, "night", 10).is_empty(),
            "a section the title alone matches is no hit"
        );
        let hits = search_reflections(&rows, "night pager", 10);
        let got: Vec<(Option<&str>, u32)> = hits
            .iter()
            .map(|h| (h.section.as_deref(), h.score))
            .collect();
        // The title carries `night` (5); `pager` is in the heading line and
        // the body (2), the heading being part of the section text.
        assert_eq!(got, [(Some("cccc3333"), 7)]);
    }

    #[test]
    fn equal_scores_rank_by_path_then_page_order() {
        let rows = vec![
            row(
                "b.md",
                "B",
                "Alpha.\n\n## One\n<!-- r:11111111 -->\n\nalpha\n\n## Two\n<!-- r:22222222 -->\n\nalpha\n",
            ),
            row("a.md", "A", "## Zed\n<!-- r:33333333 -->\n\nalpha\n"),
        ];
        let got: Vec<(String, Option<String>)> = search_reflections(&rows, "alpha", 10)
            .into_iter()
            .map(|h| (h.path, h.section))
            .collect();
        let want: Vec<(String, Option<String>)> = [
            ("a.md", "33333333"),
            ("b.md", "_top"),
            ("b.md", "11111111"),
            ("b.md", "22222222"),
        ]
        .iter()
        .map(|(p, s)| (p.to_string(), Some(s.to_string())))
        .collect();
        assert_eq!(got, want);
    }
}
