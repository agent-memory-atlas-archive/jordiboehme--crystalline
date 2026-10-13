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

fn find_ci(haystack: &[char], needle_lower: &str) -> Option<usize> {
    let needle: Vec<char> = needle_lower.chars().collect();
    if needle.is_empty() || needle.len() > haystack.len() {
        return None;
    }
    for i in 0..=haystack.len() - needle.len() {
        if (0..needle.len()).all(|j| eq_ci(haystack[i + j], needle[j])) {
            return Some(i);
        }
    }
    None
}

fn eq_ci(a: char, b: char) -> bool {
    a == b || a.to_ascii_lowercase() == b
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
}
