//! The Reflection as a thread target: how an anchor finds its section in a
//! reflection. An `Id` is a section id; a `Heading` is matched by heading
//! text the way `find_section` matches one.

use crate::reflection::sections::{find_section, split_sections};
use crate::threads::{Anchor, AnchorState, SectionRef, resolve_anchor};

/// Where `anchor` stands in the reflection `source` now.
pub fn anchor_state(source: &str, anchor: &Anchor) -> AnchorState {
    let sections = split_sections(source);
    resolve_anchor(anchor, &|section| match section {
        SectionRef::Id(id) => sections
            .iter()
            .find(|s| s.id.as_deref() == Some(id.as_str()))
            .map(|s| s.text.clone()),
        SectionRef::Heading(heading) => find_section(&sections, heading).map(|s| s.text.clone()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::threads::{Anchor, AnchorState, SectionRef};

    const PAGE: &str = "# D\n\n## Night deploys\n<!-- r:7f3a9c2e -->\n\nDeploys run at night, after the batch.\nDeploys run at night.\n\n## Other\n<!-- r:0b1c2d3e -->\n\nOther text.\n";

    #[test]
    fn a_reflection_anchor_survives_an_unrelated_edit_and_falls_back_after_a_rewrite() {
        let anchor = Anchor {
            section: SectionRef::Id("7f3a9c2e".into()),
            quote: Some("Deploys run at night".into()),
            occurrence: 2,
        };
        let AnchorState::Found { start, end } = anchor_state(PAGE, &anchor) else {
            panic!()
        };
        let section = &crate::reflection::split_sections(PAGE)[1].text;
        assert_eq!(&section[start..end], "Deploys run at night");
        let unrelated = PAGE
            .replace("Other text.", "Other text, edited.")
            .replace("## Night deploys", "## Deploys at night");
        assert!(
            matches!(anchor_state(&unrelated, &anchor), AnchorState::Found { .. }),
            "the id carries a rename"
        );
        let rewritten = PAGE.replace("Deploys run at night.\n", "We deploy in the morning now.\n");
        assert_eq!(anchor_state(&rewritten, &anchor), AnchorState::TextChanged);
        let gone = PAGE.replace("## Night deploys\n<!-- r:7f3a9c2e -->\n", "");
        assert_eq!(anchor_state(&gone, &anchor), AnchorState::SectionGone);
        let by_heading = Anchor {
            section: SectionRef::Heading("other".into()),
            quote: None,
            occurrence: 1,
        };
        assert!(
            matches!(anchor_state(PAGE, &by_heading), AnchorState::Found { .. }),
            "a heading is looked up by its text"
        );
    }

    #[test]
    fn a_multi_line_quote_sent_with_lf_is_found_in_a_page_saved_with_crlf() {
        // A page saved on Windows; the reader's quote comes from the client's
        // LF-joined section text.
        let crlf = format!("---\ntitle: D\n---\n{PAGE}").replace('\n', "\r\n");
        let anchor = Anchor {
            section: SectionRef::Id("7f3a9c2e".into()),
            quote: Some("after the batch.\nDeploys run at night".into()),
            occurrence: 1,
        };
        let AnchorState::Found { start, end } = anchor_state(&crlf, &anchor) else {
            panic!("an LF quote must be found in a CRLF page")
        };
        let section = &crate::reflection::split_sections(&crlf)[1].text;
        assert!(!section.contains('\r'), "section text is LF-joined");
        assert_eq!(
            &section[start..end],
            "after the batch.\nDeploys run at night"
        );
        let by_heading = Anchor {
            section: SectionRef::Heading("Night deploys".into()),
            quote: Some("Deploys run at night.".into()),
            occurrence: 1,
        };
        assert!(
            matches!(anchor_state(&crlf, &by_heading), AnchorState::Found { .. }),
            "a CRLF heading is matched without its CR"
        );
    }
}
