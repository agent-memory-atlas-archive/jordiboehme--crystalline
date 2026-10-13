//! The one heading walker: every ATX heading of a body outside fenced code,
//! with its byte span. The engram section edits (`crate::emit`) and the
//! sections of a reflection both read headings through it, so the two agree
//! about a `#` inside a fence and about where a section ends.

use crate::parse::{locate, parse_heading};

pub(crate) struct HeadingSpan {
    pub(crate) level: u8,
    pub(crate) text: String,
    pub(crate) line_start: usize,
    pub(crate) line_end: usize,
}

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
                if let Some((c, n)) = fence_open(line) {
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
                if let Some((c, n)) = fence_open(line)
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

pub(crate) fn fence_open(line: &str) -> Option<(char, usize)> {
    let indent = line.len() - line.trim_start_matches(' ').len();
    if indent > 3 {
        return None;
    }
    let rest = &line[indent..];
    let first = rest.chars().next()?;
    if first != '`' && first != '~' {
        return None;
    }
    let count = rest.chars().take_while(|c| *c == first).count();
    if count < 3 {
        return None;
    }
    Some((first, count))
}
