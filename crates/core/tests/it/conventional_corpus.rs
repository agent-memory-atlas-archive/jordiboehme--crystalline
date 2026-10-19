//! The shared conventional-comment corpus: one fixture, two parsers.
//!
//! fluid/src/markdown/conventionalComment.test.ts runs the same file through
//! `parseConventional`, so a rule one parser learns and the other does not
//! fails one of the two suites instead of drawing a label on one side only.

use crystalline_core::conventional::{Label, parse_conventional};

#[derive(serde::Deserialize)]
struct Case {
    name: String,
    line: String,
    label: Option<String>,
    #[serde(default)]
    decorations: Vec<String>,
    #[serde(default)]
    subject: String,
    #[serde(default)]
    blocking: bool,
}

#[test]
fn the_parser_agrees_with_the_shared_corpus() {
    let raw = include_str!("../fixtures/conventional-comments.json");
    let cases: Vec<Case> = serde_json::from_str(raw).expect("corpus parses");
    assert!(cases.len() >= 30, "corpus lost cases");
    for case in cases {
        let parsed = parse_conventional(&case.line);
        match &case.label {
            None => assert_eq!(parsed, None, "case '{}' is plain text", case.name),
            Some(label) => {
                let parsed = parsed.unwrap_or_else(|| panic!("case '{}' parses", case.name));
                assert_eq!(parsed.label.as_str(), label, "case '{}'", case.name);
                assert_eq!(parsed.decorations, case.decorations, "case '{}'", case.name);
                assert_eq!(parsed.subject, case.subject, "case '{}'", case.name);
                assert_eq!(parsed.is_blocking(), case.blocking, "case '{}'", case.name);
            }
        }
    }
}

#[test]
fn every_label_reads_back_as_itself() {
    assert_eq!(Label::ALL.len(), 9);
    for label in Label::ALL {
        let line = format!("{}: x", label.as_str());
        assert_eq!(parse_conventional(&line).map(|c| c.label), Some(label));
    }
}
