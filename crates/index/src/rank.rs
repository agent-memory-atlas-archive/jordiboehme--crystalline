//! The ranking pieces both search backends share.
//!
//! The Turso and Postgres planners score in different SQL but blend, floor and
//! gate identically; the constants, the hybrid blend, the staleness gate and the
//! query-term helpers live here once so the two cannot drift. Salience and the
//! retired fade stay in `crate::store`: they are facts about engrams.

use std::collections::HashSet;

use crate::error::{IndexError, Result};
use crate::store::EmbeddingCoverage;

/// The default minimum cosine similarity for a semantic hit. Re-derived for
/// `granite-embedding-97m-multilingual-r2` in
/// `research/2026-09-22-granite-thresholds.md`: the old bge-small-en-v1.5
/// floor of `0.55` sat at quantile 0.8726 of bge's query-to-chunk cosines on
/// the scale index and 0.7930 on Jordi's domains; granite reads 0.7802 and
/// 0.7458 at those same quantiles, and the higher, rounded to two decimals,
/// is this value. All eighteen known-answer queries of the German spot check
/// clear it, the weakest (E1) at 0.8194. Both backends re-export it as
/// their own `DEFAULT_MIN_SIMILARITY`; parity is pinned by
/// `both_backends_default_the_same_minimum_similarity` in
/// `crates/index/tests/it/store.rs`.
pub const DEFAULT_MIN_SIMILARITY: f32 = 0.78;
/// How many nearest chunks the vector scan considers before the cutoff and paging.
pub const SEMANTIC_TOPK: usize = 100;
/// Hybrid blend weights: the semantic signal leads, the lexical signal supports.
pub const HYBRID_TEXT_WEIGHT: f64 = 0.4;
pub const HYBRID_SEMANTIC_WEIGHT: f64 = 0.6;
/// A hit found by only one of the two signals keeps its normalized score scaled
/// by this factor, so an equally strong hit corroborated by both signals ranks
/// above it (a both-signal hit can reach 1.0, a single-signal hit at most 0.85).
pub const SINGLE_SOURCE_PENALTY: f64 = 0.85;

/// The blended relevance of a hit from its two normalized signals: both
/// found it, `0.4 * text + 0.6 * semantic`; only one found it, that signal
/// times [`SINGLE_SOURCE_PENALTY`], so a corroborated hit can reach 1.0 and a
/// single-signal one at most 0.85.
pub fn blend(text: Option<f64>, semantic: Option<f64>) -> f64 {
    match (text, semantic) {
        (Some(t), Some(s)) => HYBRID_TEXT_WEIGHT * t + HYBRID_SEMANTIC_WEIGHT * s,
        (Some(t), None) => t * SINGLE_SOURCE_PENALTY,
        (None, Some(s)) => s * SINGLE_SOURCE_PENALTY,
        (None, None) => 0.0,
    }
}

/// A lexical score scaled by the query's best, so the best lexical hit is 1.0.
pub fn normalized(score: f64, best: f64) -> f64 {
    if best > 0.0 { score / best } else { 0.0 }
}

/// Refuse semantic search when the stored embeddings cannot be compared against
/// the active provider's vector space. A different dimensionality is always
/// unsafe (cosine across widths is meaningless), and a same-width model swap
/// with nothing yet re-embedded means every stored vector is in the wrong space.
/// Either case surfaces as [`IndexError::StaleEmbeddings`] so callers report
/// "reindex in progress"; text search never calls this. When nothing is embedded
/// yet, this is not an error: the semantic scan simply returns no hits.
///
/// This consumes the shared coverage snapshot (the same one `effective_mode`
/// reads) rather than issuing its own aggregate scan, so a semantic or hybrid
/// search costs one cached snapshot, not a second `GROUP BY`. The snapshot's
/// `models` omits the empty-model group, but `store_embeddings` always writes a
/// non-empty model id and nothing else ever writes an embedding, so no embedded
/// chunk can lack a model: the omitted group is unreachable, and `embedded_chunks`
/// plus `total_chunks` still account for every chunk. The produced
/// [`IndexError::StaleEmbeddings`] fields are therefore byte-identical to the old
/// direct scan for every reachable database state.
pub fn check_staleness(
    coverage: &EmbeddingCoverage,
    active_model: &str,
    dims: usize,
) -> Result<()> {
    let mut active_embedded = 0usize;
    let mut foreign_dims = false;
    let mut other: Option<(&str, usize)> = None;
    for m in &coverage.models {
        if m.model == active_model && m.dims == dims {
            active_embedded += m.count;
            continue;
        }
        if m.dims != dims {
            foreign_dims = true;
        }
        if other.as_ref().map(|(_, oc)| m.count > *oc).unwrap_or(true) {
            other = Some((m.model.as_str(), m.count));
        }
    }

    let stale = coverage.embedded_chunks > 0 && (foreign_dims || active_embedded == 0);
    if stale {
        let stored_model = other
            .map(|(m, _)| m.to_string())
            .unwrap_or_else(|| active_model.to_string());
        return Err(IndexError::StaleEmbeddings {
            stored_model,
            active_model: active_model.to_string(),
            embedded: active_embedded,
            total: coverage.total_chunks,
        });
    }
    Ok(())
}

// --- text utilities ----------------------------------------------------------

/// The distinct lowercase whitespace-separated terms of a query, in order.
pub(crate) fn terms_of(text: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    text.split_whitespace()
        .map(|t| t.to_lowercase())
        .filter(|t| !t.is_empty())
        .filter(|t| seen.insert(t.clone()))
        .collect()
}

/// A `LIKE` pattern matching `term` anywhere, lowercased, with `%`, `_` and `\\` escaped.
pub(crate) fn like_pattern(term: &str) -> String {
    let mut s = String::with_capacity(term.len() + 2);
    s.push('%');
    for c in term.chars() {
        if c == '%' || c == '_' || c == '\\' {
            s.push('\\');
        }
        s.extend(c.to_lowercase());
    }
    s.push('%');
    s
}

/// How many non-overlapping times `needle_lower` occurs in `haystack_lower`.
pub(crate) fn count_occ(haystack_lower: &str, needle_lower: &str) -> usize {
    if needle_lower.is_empty() {
        return 0;
    }
    let mut count = 0;
    let mut start = 0;
    while let Some(pos) = haystack_lower[start..].find(needle_lower) {
        count += 1;
        start += pos + needle_lower.len();
    }
    count
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_hit_both_signals_found_outranks_an_equally_strong_single_one() {
        assert!((blend(Some(1.0), Some(1.0)) - 1.0).abs() < 1e-12);
        assert!((blend(Some(1.0), None) - 0.85).abs() < 1e-12);
        assert!((blend(None, Some(1.0)) - 0.85).abs() < 1e-12);
        assert!((blend(Some(0.5), Some(0.5)) - 0.5).abs() < 1e-12);
        assert_eq!(blend(None, None), 0.0);
        assert_eq!(normalized(3.0, 6.0), 0.5);
        assert_eq!(
            normalized(3.0, 0.0),
            0.0,
            "no lexical best, no lexical signal"
        );
    }

    #[test]
    fn a_swapped_model_with_nothing_reembedded_is_stale() {
        let coverage = EmbeddingCoverage {
            total_chunks: 4,
            embedded_chunks: 4,
            models: vec![crate::store::ChunkModelCount {
                model: "old".into(),
                dims: 8,
                count: 4,
            }],
        };
        assert!(matches!(
            check_staleness(&coverage, "new", 8),
            Err(crate::IndexError::StaleEmbeddings { .. })
        ));
        assert!(
            check_staleness(&EmbeddingCoverage::default(), "new", 8).is_ok(),
            "nothing embedded is not stale"
        );
    }
}
