//! The snippet window both search backends cut around the first matching term,
//! and the lead a hit without a match shows. One copy, read by the engram search
//! on either backend and by the Reflection's text search.

const SNIPPET_MARGIN: usize = 70;
const SNIPPET_LEAD: usize = 200;

pub(crate) fn lead(text: &str) -> String {
    let collapsed = collapse_ws(text);
    let chars: Vec<char> = collapsed.chars().collect();
    if chars.len() <= SNIPPET_LEAD {
        chars.into_iter().collect()
    } else {
        let head: String = chars.into_iter().take(SNIPPET_LEAD).collect();
        format!("{head}...")
    }
}

pub(crate) fn make_snippet(text: &str, terms: &[String]) -> String {
    let chars: Vec<char> = text.chars().collect();
    let pos = terms.iter().filter_map(|t| find_ci(&chars, t)).min();
    let Some(pos) = pos else {
        return lead(text);
    };
    let start = pos.saturating_sub(SNIPPET_MARGIN);
    let end = (pos + SNIPPET_MARGIN * 2).min(chars.len());
    let window: String = chars[start..end].iter().collect();
    let window = collapse_ws(&window);
    let mut out = String::new();
    if start > 0 {
        out.push_str("...");
    }
    out.push_str(window.trim());
    if end < chars.len() {
        out.push_str("...");
    }
    out
}

/// Where `needle_lower` first starts in `haystack`, as a char index. The
/// haystack is folded with Unicode `to_lowercase`, char by char, the way the
/// callers fold their terms, so a non-ASCII term in another case (`über`
/// against `Über`) is found too. A char that folds to several (`İ`) maps every
/// one of them back to its own position.
fn find_ci(haystack: &[char], needle_lower: &str) -> Option<usize> {
    let needle: Vec<char> = needle_lower.chars().collect();
    let folded: Vec<(char, usize)> = haystack
        .iter()
        .enumerate()
        .flat_map(|(i, c)| c.to_lowercase().map(move |l| (l, i)))
        .collect();
    if needle.is_empty() || needle.len() > folded.len() {
        return None;
    }
    (0..=folded.len() - needle.len())
        .find(|&i| (0..needle.len()).all(|j| folded[i + j].0 == needle[j]))
        .map(|i| folded[i].1)
}

fn collapse_ws(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_window_centres_on_the_first_term_and_marks_what_it_cut() {
        let text = format!("{} needle {}", "a ".repeat(100), "b ".repeat(100));
        let snippet = make_snippet(&text, &["needle".to_string()]);
        assert!(
            snippet.starts_with("...") && snippet.ends_with("...") && snippet.contains("needle"),
            "{snippet}"
        );
        assert_eq!(
            make_snippet("short text", &["absent".to_string()]),
            lead("short text")
        );
    }
    #[test]
    fn a_non_ascii_term_in_another_case_still_centres_the_window() {
        let text = format!("{} Über den Wolken {}", "a ".repeat(100), "b ".repeat(100));
        let snippet = make_snippet(&text, &["über".to_string()]);
        assert!(
            snippet.starts_with("...") && snippet.contains("Über den Wolken"),
            "{snippet}"
        );
        // A char that folds to two (`İ`) does not shift the window: a
        // position counted in folded chars would start it past the term.
        let text = format!("{}needle {}", "\u{130}".repeat(100), "b ".repeat(100));
        let snippet = make_snippet(&text, &["needle".to_string()]);
        assert!(snippet.contains("needle"), "{snippet}");
    }
}
