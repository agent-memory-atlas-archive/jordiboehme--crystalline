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

/// The fewest words a normalized text needs before the word check in
/// [`near_duplicate`] applies to it.
///
/// A text of `n` words has `n - 1` word pairs and one changed word costs up to
/// two of them, so a copy with one edit keeps `(n - 3) / (n - 1)` of its pairs.
/// That reaches [`WORD_BIGRAM_FLOOR`] from five words on; below, a single
/// edit can already fail the word check, so the character score decides alone.
pub const WORD_GATE_MIN_WORDS: usize = 5;

/// The longest mean word length, in characters, at which the word check in
/// [`near_duplicate`] still applies to a normalized text.
///
/// Languages written without spaces, such as Chinese and Japanese, fold into
/// a few clause-long "words" (the fold turns their punctuation into spaces),
/// so one changed character costs a whole word and its pairs. English prose
/// averages about five characters a word and German technical prose about
/// seven, while comma-split Chinese clauses already average 12 and Japanese
/// ones more (the tests measure both). 10 leaves room on either side. Above
/// it, the character score decides alone, as it did before the word check
/// existed.
pub const WORD_GATE_MAX_MEAN_LEN: usize = 10;

/// Whether a normalized text is split into enough short words for the word
/// bigram score to say something about it: at least [`WORD_GATE_MIN_WORDS`]
/// words with a mean length of at most [`WORD_GATE_MAX_MEAN_LEN`] characters.
fn word_gate_applies(text: &str) -> bool {
    let (words, chars) = text
        .split_whitespace()
        .fold((0usize, 0usize), |(w, c), word| {
            (w + 1, c + word.chars().count())
        });
    words >= WORD_GATE_MIN_WORDS && chars <= WORD_GATE_MAX_MEAN_LEN * words
}

/// Decide whether two normalized texts are near-duplicates: the character
/// bigram Dice score reaches `char_threshold` and the word bigram Dice score
/// reaches [`WORD_BIGRAM_FLOOR`].
///
/// The word check only applies when both texts are split into words well
/// enough for it (see [`WORD_GATE_MIN_WORDS`] and [`WORD_GATE_MAX_MEAN_LEN`]).
/// A short text or one in a language written without spaces is decided by the
/// character score alone.
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
    let words_agree = || {
        !(word_gate_applies(a) && word_gate_applies(b))
            || word_bigram_dice(a, b) >= WORD_BIGRAM_FLOOR
    };
    if chars >= char_threshold && words_agree() {
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

    /// A Japanese paragraph. The fold turns its punctuation into spaces, so
    /// it splits into four clause-long "words".
    const JAPANESE: &str = "ビルドはメインブランチへのプッシュごとに実行されテストスイート全体を\
        走らせる前にワークスペース全体をコンパイルします。その後成果物をストレージに\
        アップロードし、どこかで失敗するとリリースは止まり当番のエンジニアにすぐ連絡が\
        届きます。壊れたビルドを出荷する人はいません。";

    /// A Chinese paragraph of the same text, four clauses after the fold.
    const CHINESE: &str = "每次推送到主分支时都会先编译整个工作区再执行完整的测试套件。\
        之后它把产物上传到存储中，链条中任何一处失败都会停止发布并立即通知值班工程师。\
        这样就没有人会发布一个损坏的构建。";

    #[test]
    fn languages_without_spaces_skip_the_word_check() {
        for text in [JAPANESE, CHINESE] {
            let a = normalize(text);
            assert!(!word_gate_applies(&a), "gate applies to {a}");
        }
        // The same Chinese text with a comma at every clause still folds
        // into clauses averaging over ten characters.
        let commas = normalize(
            "每次推送到主分支时都会运行构建，先编译整个工作区，然后执行完整的测试套件。\
             之后它把产物上传到存储中，链条中任何一处失败都会停止发布，并立即通知值班工程师，\
             这样就没有人会发布一个损坏的构建。",
        );
        assert!(!word_gate_applies(&commas), "gate applies to {commas}");
        assert!(word_gate_applies(&normalize(PARAGRAPH)));
        let german = normalize(
            "Der Build läuft bei jedem Push auf den Hauptzweig, übersetzt den ganzen \
             Arbeitsbereich und führt danach die vollständige Testsammlung aus.",
        );
        assert!(word_gate_applies(&german), "gate skips {german}");
    }

    #[test]
    fn near_duplicate_accepts_a_japanese_copy_with_one_character_changed() {
        let a = normalize(JAPANESE);
        let b = normalize(&JAPANESE.replace("すぐ", "すく"));
        assert_ne!(a, b);
        // The fixture only proves the fix if the word check alone would have
        // rejected it.
        assert!(word_bigram_dice(&a, &b) < WORD_BIGRAM_FLOOR);
        let score = near_duplicate(&a, &b, 0.85);
        assert!(score.is_some_and(|s| s > 0.95), "{score:?}");
    }

    #[test]
    fn near_duplicate_accepts_a_chinese_copy_with_one_character_changed() {
        let a = normalize(CHINESE);
        let b = normalize(&CHINESE.replace("立即", "立刻"));
        assert_ne!(a, b);
        assert!(word_bigram_dice(&a, &b) < WORD_BIGRAM_FLOOR);
        let score = near_duplicate(&a, &b, 0.85);
        assert!(score.is_some_and(|s| s > 0.95), "{score:?}");
    }

    #[test]
    fn short_text_is_decided_by_the_character_score() {
        // One edit in the middle of four words costs two of three word pairs.
        let a = "alpha beta gamma delta";
        let b = "alpha betas gamma delta";
        assert!(!word_gate_applies(a));
        assert!(word_bigram_dice(a, b) < WORD_BIGRAM_FLOOR);
        assert!(near_duplicate(a, b, 0.85).is_some());
        // From five words on the word check applies and one edit passes it.
        let a = "alpha beta gamma delta epsilon";
        let b = "alpha beta gammas delta epsilon";
        assert!(word_gate_applies(a));
        assert!(word_bigram_dice(a, b) >= WORD_BIGRAM_FLOOR);
    }
}
