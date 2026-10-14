//! The one heading walker: every ATX heading of a body outside fenced code,
//! with its byte span. The engram section edits (`crate::emit`) and the
//! sections of a reflection both read headings through it, so the two agree
//! about a `#` inside a fence and about where a section ends.

use crate::parse::{fence_marker, locate, parse_heading};

/// One ATX heading of a body, outside fenced code.
pub(crate) struct HeadingSpan {
    /// The number of `#`, 1 to 6.
    pub(crate) level: u8,
    /// The heading text, without the `#` run and any closing `#` run.
    pub(crate) text: String,
    /// Byte offset of the heading line's first byte in the source.
    pub(crate) line_start: usize,
    /// Byte offset just past the heading line, its line ending included.
    pub(crate) line_end: usize,
}

/// Every heading of `source`'s body in file order, skipping the frontmatter
/// and every line inside fenced code. A fence opens and closes by the one
/// fence rule the body walker uses (`crate::parse::fence_marker`), so a
/// fence means the same thing to every reader of a body.
pub(crate) fn heading_spans(source: &str) -> Vec<HeadingSpan> {
    let (_, _, body_start) = locate(source);
    let mut spans = Vec::new();
    let mut fence: Option<(char, usize)> = None;
    let mut offset = body_start;
    for raw in source[body_start..].split_inclusive('\n') {
        let line = raw.strip_suffix('\n').unwrap_or(raw).trim_end_matches('\r');
        let line_start = offset;
        let line_end = offset + raw.len();
        offset = line_end;

        match fence {
            None => {
                if let Some((c, n, _)) = fence_marker(line) {
                    fence = Some((c, n));
                    continue;
                }
                if let Some((level, text)) = parse_heading(line) {
                    spans.push(HeadingSpan {
                        level,
                        text,
                        line_start,
                        line_end,
                    });
                }
            }
            Some((fc, fcount)) => {
                if let Some((c, n, _)) = fence_marker(line)
                    && c == fc
                    && n >= fcount
                {
                    let after = &line.trim_start()[n..];
                    if after.trim().is_empty() {
                        fence = None;
                    }
                }
            }
        }
    }
    spans
}
