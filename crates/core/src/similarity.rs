//! Text similarity primitives: a normalizing fold, a character bigram Dice
//! coefficient, a word bigram Dice coefficient and the near-duplicate
//! decision that combines the two.
//!
//! Pure text math with no state, no I/O and no dependency beyond the standard
//! library, which is why it belongs in the format crate: the verify `Q004`
//! rule and the index crate's near-duplicate sweep need the exact same
//! numbers, and a second copy of the arithmetic would drift.
//!
//! Dice over character bigrams was chosen over a longest-common-subsequence
//! ratio for its O(n) simplicity and its stability under paragraph
//! reordering: moving a block of text changes only the handful of bigrams at
//! the seams.
//!
//! Character pairs alone are not enough, though. They ignore word order, so
//! two sections that reuse the same vocabulary in different sentences (two
//! tables with the same column headers and different free-text rows) score
//! like a copy. Word pairs see word order, so a near-duplicate has to pass
//! both: the character score catches edited copies and survives reordering,
//! the word score rejects text that merely shares its words.

use std::collections::HashMap;

/// Fold text into the comparable form every similarity consumer uses: ASCII
/// lowercase, every character that is neither alphanumeric nor whitespace
/// replaced by a space, then whitespace runs collapsed to single spaces with
/// both ends trimmed.
///
/// The fold is deliberately lossy. Punctuation, markdown syntax and line
/// breaks carry no meaning for a duplicate check, so removing them lets two
/// spellings of the same paragraph compare equal.
///
/// ```
/// use crystalline_core::similarity::normalize;
///
/// assert_eq!(normalize("  Hello, World!\nAgain.  "), "hello world again");
/// assert_eq!(normalize("---"), "");
/// ```
pub fn normalize(s: &str) -> String {
    let filtered: String = s
        .chars()
        .map(|c| {
            let c = c.to_ascii_lowercase();
            if c.is_alphanumeric() || c.is_whitespace() {
                c
            } else {
                ' '
            }
        })
        .collect();
    filtered.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Bigram Dice coefficient: `2 * |intersection| / (|bigrams(a)| +
/// |bigrams(b)|)`, using multiset (count-aware) bigram intersection.
///
/// The result is in `0.0..=1.0`: `1.0` for identical input, `0.0` when either
/// side has fewer than two characters or the two share no bigram. Callers
/// normally pass [`normalize`]d text so casing and punctuation do not shift
/// the score.
///
/// ```
/// use crystalline_core::similarity::dice_coefficient;
///
/// assert_eq!(dice_coefficient("night", "night"), 1.0);
/// assert_eq!(dice_coefficient("abcd", "wxyz"), 0.0);
/// assert!(dice_coefficient("night", "nacht") < 0.5);
/// ```
pub fn dice_coefficient(a: &str, b: &str) -> f64 {
    let ba = bigrams(a);
    let bb = bigrams(b);
    if ba.is_empty() || bb.is_empty() {
        return 0.0;
    }
    let mut counts: HashMap<(char, char), i32> = HashMap::new();
    for bg in &ba {
        *counts.entry(*bg).or_insert(0) += 1;
    }
    let mut intersection = 0usize;
    for bg in &bb {
        if let Some(c) = counts.get_mut(bg)
            && *c > 0
        {
            *c -= 1;
            intersection += 1;
        }
    }
    2.0 * intersection as f64 / (ba.len() + bb.len()) as f64
}

/// The lowest word bigram Dice score a pair may have and still count as a
/// near-duplicate in [`near_duplicate`].
///
/// Measured on issue #134 over 27 flagged section pairs: plain copies scored
/// 0.86 to 1.00 on word bigrams, the false positives 0.12 to 0.76. One changed
/// word in an otherwise identical text destroys two word bigrams, so a lightly
/// edited copy loses a little per edit. 0.5 sits well below the lowest copy
/// and keeps edited copies, while it still rejects most vocabulary-only
/// overlap.
pub const WORD_BIGRAM_FLOOR: f64 = 0.5;

/// Word bigram Dice coefficient: the same arithmetic as [`dice_coefficient`]
/// over adjacent word pairs instead of adjacent characters, with multiset
/// (count-aware) intersection.
///
/// Callers pass [`normalize`]d text, so words are separated by single spaces.
/// Text with fewer than two words has no bigram: the result is `1.0` when both
/// sides are equal and `0.0` otherwise, so two identical one-word texts still
/// agree while a one-word text never matches a longer one.
///
/// ```
/// use crystalline_core::similarity::word_bigram_dice;
///
/// assert_eq!(word_bigram_dice("a b c", "a b c"), 1.0);
/// assert_eq!(word_bigram_dice("a b c", "c b a"), 0.0);
/// ```
pub fn word_bigram_dice(a: &str, b: &str) -> f64 {
    let wa: Vec<&str> = a.split_whitespace().collect();
    let wb: Vec<&str> = b.split_whitespace().collect();
    if wa.len() < 2 || wb.len() < 2 {
        return if wa == wb { 1.0 } else { 0.0 };
    }
    let mut counts: HashMap<(&str, &str), i32> = HashMap::new();
    for w in wa.windows(2) {
        *counts.entry((w[0], w[1])).or_insert(0) += 1;
    }
    let mut intersection = 0usize;
    for w in wb.windows(2) {
        if let Some(c) = counts.get_mut(&(w[0], w[1]))
            && *c > 0
        {
            *c -= 1;
            intersection += 1;
        }
    }
    2.0 * intersection as f64 / ((wa.len() - 1) + (wb.len() - 1)) as f64
}

/// Decide whether two normalized texts are near-duplicates: the character
/// bigram Dice score reaches `char_threshold` and the word bigram Dice score
/// reaches [`WORD_BIGRAM_FLOOR`].
///
/// Returns the character score on a match, so callers keep reporting the
/// number they always did, and `None` otherwise.
///
/// ```
/// use crystalline_core::similarity::near_duplicate;
///
/// let text = "one two three four five six";
/// assert_eq!(near_duplicate(text, text, 0.85), Some(1.0));
/// assert_eq!(near_duplicate(text, "six five four three two one", 0.85), None);
/// ```
pub fn near_duplicate(a: &str, b: &str, char_threshold: f64) -> Option<f64> {
    let chars = dice_coefficient(a, b);
    if chars >= char_threshold && word_bigram_dice(a, b) >= WORD_BIGRAM_FLOOR {
        Some(chars)
    } else {
        None
    }
}

/// Every adjacent character pair in a string, in order. Empty when the string
/// holds fewer than two characters.
fn bigrams(s: &str) -> Vec<(char, char)> {
    let chars: Vec<char> = s.chars().collect();
    if chars.len() < 2 {
        return Vec::new();
    }
    chars.windows(2).map(|w| (w[0], w[1])).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_lowercases_and_collapses() {
        assert_eq!(normalize("Foo   BAR"), "foo bar");
        assert_eq!(normalize("a-b_c"), "a b c");
        assert_eq!(normalize("\n\tspaced\r\n"), "spaced");
    }

    #[test]
    fn normalize_keeps_alphanumerics_only() {
        assert_eq!(normalize("v0.11.2 (rc1)!"), "v0 11 2 rc1");
        assert_eq!(normalize("###"), "");
        assert_eq!(normalize(""), "");
    }

    #[test]
    fn dice_is_one_for_identical_text() {
        assert_eq!(dice_coefficient("the same words", "the same words"), 1.0);
    }

    #[test]
    fn dice_is_zero_for_disjoint_or_too_short_text() {
        assert_eq!(dice_coefficient("abcd", "wxyz"), 0.0);
        assert_eq!(dice_coefficient("a", "a"), 0.0);
        assert_eq!(dice_coefficient("", "anything"), 0.0);
    }

    #[test]
    fn dice_is_symmetric_and_bounded() {
        let a = "the quick brown fox jumps over the lazy dog";
        let b = "the quick brown fox leaps over the lazy dog";
        let ab = dice_coefficient(a, b);
        let ba = dice_coefficient(b, a);
        assert!((ab - ba).abs() < f64::EPSILON, "{ab} vs {ba}");
        assert!((0.0..=1.0).contains(&ab), "{ab} out of range");
        assert!(ab > 0.8, "one word swapped should stay very similar: {ab}");
    }

    #[test]
    fn dice_counts_bigrams_as_a_multiset() {
        // `aa` twice versus once: the multiset intersection is 1, not 2.
        let sim = dice_coefficient("aaa", "aa");
        assert!((sim - 2.0 * 1.0 / 3.0).abs() < 1e-12, "{sim}");
    }

    #[test]
    fn dice_is_stable_under_paragraph_reordering() {
        let one = normalize("First paragraph here. Second paragraph there.");
        let two = normalize("Second paragraph there. First paragraph here.");
        assert!(dice_coefficient(&one, &two) > 0.9);
    }

    const PARAGRAPH: &str = "the build runs on every push to the main branch and compiles \
        the whole workspace before it executes the full test suite then it \
        uploads the artifacts to storage and a failure anywhere in the chain \
        stops the release and pages the on call engineer right away so nobody \
        ships a broken build";

    /// A fixed permutation that keeps every word and destroys word order:
    /// interleave the first half of the words with the second half.
    fn shuffled(text: &str) -> String {
        let words: Vec<&str> = text.split_whitespace().collect();
        let half = words.len() / 2;
        let mut out = Vec::with_capacity(words.len());
        for i in 0..half {
            out.push(words[i]);
            out.push(words[half + i]);
        }
        out.extend(&words[half * 2..]);
        out.join(" ")
    }

    #[test]
    fn word_bigram_is_one_for_identical_and_zero_for_disjoint() {
        assert_eq!(word_bigram_dice("a b c d", "a b c d"), 1.0);
        assert_eq!(word_bigram_dice("a b c d", "w x y z"), 0.0);
    }

    #[test]
    fn word_bigram_is_symmetric_and_bounded() {
        let a = "the quick brown fox jumps over the lazy dog";
        let b = "the quick brown fox leaps over the lazy dog";
        let ab = word_bigram_dice(a, b);
        let ba = word_bigram_dice(b, a);
        assert!((ab - ba).abs() < f64::EPSILON, "{ab} vs {ba}");
        assert!((0.0..=1.0).contains(&ab), "{ab} out of range");
    }

    #[test]
    fn word_bigram_counts_as_a_multiset() {
        // `a a` twice versus once: bigrams [aa, aa] against [aa], intersection 1.
        let sim = word_bigram_dice("a a a", "a a");
        assert!((sim - 2.0 * 1.0 / 3.0).abs() < 1e-12, "{sim}");
    }

    #[test]
    fn word_bigram_sees_word_order() {
        let a = normalize(PARAGRAPH);
        let b = shuffled(&a);
        let (word, chars) = (word_bigram_dice(&a, &b), dice_coefficient(&a, &b));
        assert!(word < 0.2, "word {word}");
        assert!(chars > 0.6, "chars {chars}");
    }

    #[test]
    fn word_bigram_of_too_short_input() {
        assert_eq!(word_bigram_dice("alone", "alone"), 1.0);
        assert_eq!(word_bigram_dice("", ""), 1.0);
        assert_eq!(word_bigram_dice("alone", "other"), 0.0);
        assert_eq!(word_bigram_dice("alone", "alone again"), 0.0);
    }

    #[test]
    fn near_duplicate_rejects_a_shuffled_pair() {
        let a = normalize(PARAGRAPH);
        let b = shuffled(&a);
        assert_eq!(near_duplicate(&a, &b, 0.5), None);
    }

    #[test]
    fn near_duplicate_accepts_identical_and_lightly_edited_copies() {
        let a = normalize(PARAGRAPH);
        assert_eq!(near_duplicate(&a, &a, 0.85), Some(1.0));
        let edited = a
            .replace("main branch", "default branch")
            .replace("engineer", "person")
            .replace("storage", "the bucket");
        let score = near_duplicate(&a, &edited, 0.85);
        assert!(score.is_some(), "edited copy lost: {score:?}");
    }
}
