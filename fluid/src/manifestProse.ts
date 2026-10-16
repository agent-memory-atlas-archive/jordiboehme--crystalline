/**
 * A MANIFEST cut into the parts the domain front page draws (spec 5.3).
 *
 * The page reads the document, it does not edit it, so nothing here changes
 * what the MANIFEST says: it only says which part is drawn where. The
 * frontmatter goes (the server reads it into the policies), the first `# H1`
 * becomes the eyebrow, the first paragraph after it the lead, and the `##`
 * sections are split in two: the prose a person reads and the configuration
 * sections an agent's tools read, which the right rail shows once.
 *
 * Headings are matched the way the core parser matches them
 * (`section_key` in crates/core/src/manifest.rs): whitespace collapsed,
 * lowercased, H2 only, never inside a fenced code block, and a section runs
 * to the next H1 or H2, so a deeper heading stays inside it.
 */

import type { ManifestSections } from "./api/domain";

/** One `##` section of the body, as written. */
export interface ManifestSection {
  /** The heading text as the author wrote it. */
  heading: string;
  /** The folded key the parser matches it by. */
  key: string;
  /** The markdown under the heading, up to the next H1 or H2. */
  body: string;
  /** The body without its top-level bullets: what it says beside them. */
  notes: string;
}

/** The MANIFEST as the front page draws it. */
export interface ManifestProse {
  /** The body's `# H1`, or null when the body has none. */
  eyebrow: string | null;
  /** The first paragraph after the H1, or null when there is none. */
  lead: string | null;
  /** Anything else before the first `##`, drawn after the lead. */
  intro: string;
  /** The prose sections, in file order. */
  sections: ManifestSection[];
  /** The configuration sections, in file order. */
  config: ManifestSection[];
}

/** The two routing sections: the payload names them as fields of its own. */
export const WHEN_TO_USE_KEY = "when to use";
export const SCOPE_KEY = "scope";

/** The parser's folding of a heading: whitespace collapsed, lowercased. */
export function sectionKey(title: string): string {
  return title.trim().split(/\s+/).join(" ").toLowerCase();
}

/**
 * The sections the rail shows instead of the prose.
 *
 * Read from the server's own registry of startable sections
 * (`starter_stanzas` in the core crate) rather than from a list kept here:
 * every registered section that is not one of the two routing sections is
 * configuration, so a section added to the registry leaves the prose without
 * a change on this side. A daemon that predates the registry sends no
 * starters; the two configuration sections it already parses stand in then.
 * A server that sent no sections at all cuts nothing: the document is drawn
 * whole, as it was before.
 */
export function configKeys(sections: ManifestSections | null): Set<string> {
  const keys = new Set<string>();
  if (sections === null) {
    return keys;
  }
  for (const starter of sections.starters) {
    const key = sectionKey(starter.section);
    if (key !== WHEN_TO_USE_KEY && key !== SCOPE_KEY) {
      keys.add(key);
    }
  }
  if (sections.starters.length === 0) {
    keys.add("provisioning");
    keys.add("tag aliases");
  }
  return keys;
}

/** The lines of a text, a CRLF file read the same as an LF one. */
function linesOf(text: string): string[] {
  return text.split(/\r?\n/);
}

/** The body's lines, without its frontmatter block. */
function bodyLines(markdown: string): string[] {
  const lines = linesOf(markdown);
  if (lines[0]?.trim() !== "---") {
    return lines;
  }
  const end = lines.findIndex(
    (line, index) => index > 0 && line.trim() === "---",
  );
  return end === -1 ? lines : lines.slice(end + 1);
}

/** `{ level, text }` for an ATX heading line, or null. */
function heading(line: string): { level: number; text: string } | null {
  const match = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*#*[ \t]*$/.exec(line);
  if (match === null) {
    return null;
  }
  return { level: match[1]?.length ?? 0, text: (match[2] ?? "").trim() };
}

/** A fence marker: its character and length, or null (`fence_marker`). */
function fenceMarker(line: string): { char: string; count: number } | null {
  const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
  const run = match?.[1];
  return run === undefined ? null : { char: run[0] ?? "", count: run.length };
}

/**
 * The core crate's `FenceTracker`: a fence opens on a marker and closes only
 * on a marker of the same character, at least as long, with nothing after
 * it. `inFence` is true for both marker lines and every line between.
 */
function fenceTracker(): (line: string) => boolean {
  let open: { char: string; count: number } | null = null;
  return (line) => {
    if (open === null) {
      const marker = fenceMarker(line);
      open = marker;
      return marker !== null;
    }
    if (closes(open, line)) {
      open = null;
    }
    return true;
  };
}

/** Whether `line` closes a fence opened by `open` (`FenceTracker`'s rule). */
function closes(open: { char: string; count: number }, line: string): boolean {
  const marker = fenceMarker(line);
  return (
    marker !== null &&
    marker.char === open.char &&
    marker.count >= open.count &&
    line.trimStart().slice(marker.count).trim() === ""
  );
}

/** Split `markdown` (frontmatter and all) for the front page. */
export function splitManifest(
  markdown: string,
  config: Set<string>,
): ManifestProse {
  const lines = bodyLines(markdown);
  let eyebrow: string | null = null;
  const head: string[] = [];
  const sections: ManifestSection[] = [];
  let current: { heading: string; key: string; lines: string[] } | null = null;
  const inFence = fenceTracker();
  for (const line of lines) {
    const h = inFence(line) ? null : heading(line);
    if (h !== null && h.level === 2) {
      if (current !== null) {
        sections.push(finish(current));
      }
      current = { heading: h.text, key: sectionKey(h.text), lines: [] };
      continue;
    }
    if (h !== null && h.level === 1) {
      if (eyebrow === null && current === null && head.join("").trim() === "") {
        eyebrow = h.text;
        continue;
      }
      // A later H1 ends a section for the parser, but drawn on its own it
      // would jump above the sections it follows; it stays where it was
      // written, inside the section before it.
    }
    if (current !== null) {
      current.lines.push(line);
    } else {
      head.push(line);
    }
  }
  if (current !== null) {
    sections.push(finish(current));
  }
  // A configuration heading the parser has already seen is ignored by it
  // (first duplicate wins), so the rail keeps the first one only.
  const seen = new Set<string>();
  const configSections = sections.filter((s) => {
    if (!config.has(s.key) || seen.has(s.key)) {
      return false;
    }
    seen.add(s.key);
    return true;
  });
  const { lead, rest } = firstParagraph(head);
  return {
    eyebrow,
    lead,
    intro: rest,
    sections: sections.filter((s) => !config.has(s.key)),
    config: configSections,
  };
}

function finish(section: {
  heading: string;
  key: string;
  lines: string[];
}): ManifestSection {
  // What a configuration section says beside its declarations: every line
  // that is not a top-level bullet or part of one. An indented line
  // (a continuation, a nested bullet) stays with the bullet above it, across
  // a blank line too; a fence at the margin is prose and runs to its close.
  const notes: string[] = [];
  let fence: { char: string; count: number } | null = null;
  let inBullet = false;
  for (const line of section.lines) {
    if (fence !== null) {
      notes.push(line);
      if (closes(fence, line)) {
        fence = null;
      }
      continue;
    }
    const marker = fenceMarker(line);
    if (marker !== null && !(inBullet && /^[ \t]/.test(line))) {
      fence = marker;
      inBullet = false;
      notes.push(line);
      continue;
    }
    if (line.startsWith("- ")) {
      inBullet = true;
      continue;
    }
    if (line.trim() === "") {
      if (!inBullet) {
        notes.push(line);
      }
      continue;
    }
    if (inBullet && /^[ \t]/.test(line)) {
      continue;
    }
    inBullet = false;
    notes.push(line);
  }
  return {
    heading: section.heading,
    key: section.key,
    body: section.lines.join("\n").trim(),
    notes: notes
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  };
}

/**
 * The first paragraph of `lines` and what follows it. Only plain text counts
 * as the lead: a list, a quote, a table, a fence or a heading first means the
 * page has no lead and draws all of it as prose.
 */
function firstParagraph(lines: string[]): {
  lead: string | null;
  rest: string;
} {
  const start = lines.findIndex((line) => line.trim() !== "");
  if (start === -1) {
    return { lead: null, rest: "" };
  }
  const first = lines[start] ?? "";
  if (/^\s*([-*+>|#]|\d+[.)]\s|```|~~~|<|!\[)/.test(first)) {
    return { lead: null, rest: lines.join("\n").trim() };
  }
  let end = start;
  while (end < lines.length && (lines[end] ?? "").trim() !== "") {
    end += 1;
  }
  return {
    lead: lines.slice(start, end).join("\n").trim(),
    rest: lines.slice(end).join("\n").trim(),
  };
}
