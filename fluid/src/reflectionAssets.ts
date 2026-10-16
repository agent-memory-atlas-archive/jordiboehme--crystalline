/**
 * What a reflection's links point at: the Reflection's own files, an engram
 * attachment, or something else.
 *
 * A mirror of `crates/core/src/reflection/assets.rs` (`classify_target`,
 * `reflection_asset_refs`, `engram_attachment_embeds`) and of `relative_to`
 * in `reflection/links.rs`, which are the authority. The shared corpus
 * `crates/core/tests/fixtures/reflection_asset_corpus.json` is read by both
 * suites: a change to one side's answer is a change to that fixture and to
 * the other side in the same commit.
 *
 * Pure, and imported by the lazy Reflection modules only.
 */

import { decodeTarget, linkTokensIn } from "./editor/imageFormat";

export type ReflectionTarget =
  | { kind: "reflection"; path: string } // inside reflections/: "assets/<rel>"
  | { kind: "engram" }
  | { kind: "other" };

const OTHER: ReflectionTarget = { kind: "other" };
const ENGRAM: ReflectionTarget = { kind: "engram" };
const SCHEME = "crystalline://";
const ASSETS_FOLDER = "assets";
const REFLECTIONS_DIR = "reflections";

/** Core `is_under_assets`: the first segment is `assets`, in any letter case. */
function isUnderAssets(rel: string): boolean {
  return (rel.split("/")[0] ?? "").toLowerCase() === ASSETS_FOLDER;
}

/** The folder part of a path: everything before the last `/`, empty at the root. */
function folderOf(path: string): string {
  const at = path.lastIndexOf("/");
  return at < 0 ? "" : path.slice(0, at);
}

/** Core `resolve`: null when the target climbs above the domain root. */
function resolveFrom(fromFile: string, target: string): string | null {
  const parts = folderOf(fromFile)
    .split("/")
    .filter((s) => s !== "");
  for (const segment of target.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (parts.pop() === undefined) {
        return null;
      }
    } else {
      parts.push(segment);
    }
  }
  return parts.join("/");
}

/** The mirror of core `classify_target`: decoded, `./` stripped, fragment and title already cut. */
export function classifyReflectionTarget(
  target: string,
  pagePath: string,
): ReflectionTarget {
  if (target.startsWith(SCHEME)) {
    // `CrystallineUrl::parse` then `asset_ref`: an engram attachment is a
    // non-glob address whose permalink starts with `assets/`.
    const rest = target.slice(SCHEME.length);
    const slash = rest.indexOf("/");
    const domain = slash < 0 ? rest : rest.slice(0, slash);
    const tail = slash < 0 ? "" : rest.slice(slash + 1);
    const glob = tail === "*" || tail.endsWith("/*");
    return domain !== "" && !glob && tail.startsWith("assets/")
      ? ENGRAM
      : OTHER;
  }
  // Any other URL scheme (RFC 3986, case-insensitive) is a URL, never a file.
  if (target === "" || /^[a-z][a-z0-9+.-]*:/i.test(target)) {
    return OTHER;
  }
  // A browser reads `\` as `/` in a relative link.
  const slashed = target.replaceAll("\\", "/");
  if (slashed.startsWith("/")) {
    return isUnderAssets(slashed.slice(1)) ? ENGRAM : OTHER;
  }
  const landed = resolveFrom(`${REFLECTIONS_DIR}/${pagePath}`, slashed);
  if (landed === null) {
    return OTHER;
  }
  if ((landed.split("/")[0] ?? "").toLowerCase() === REFLECTIONS_DIR) {
    const slash = landed.indexOf("/");
    const inner = slash < 0 ? "" : landed.slice(slash + 1);
    if (!isUnderAssets(inner)) {
      return OTHER;
    }
    const sep = inner.indexOf("/");
    const path =
      sep < 0 ? ASSETS_FOLDER : `${ASSETS_FOLDER}/${inner.slice(sep + 1)}`;
    // `assets/` with nothing after it names no file.
    return path.length > `${ASSETS_FOLDER}/`.length
      ? { kind: "reflection", path }
      : OTHER;
  }
  return isUnderAssets(landed) ? ENGRAM : OTHER;
}

/**
 * A link target as the core's scan hands it out: decoded once, a leading
 * `./` stripped, cut at the first `#`. Null for an empty remainder, which the
 * scan drops.
 */
function scanned(written: string): string | null {
  const decoded = decodeTarget(written);
  const plain = decoded.startsWith("./") ? decoded.slice(2) : decoded;
  const hash = plain.indexOf("#");
  const target = hash < 0 ? plain : plain.slice(0, hash);
  return target === "" ? null : target;
}

/** `classifyReflectionTarget` over a link target as written (decodes, strips `./`, cuts `#`). */
export function reflectionTargetOf(
  written: string,
  pagePath: string,
): ReflectionTarget {
  const target = scanned(written);
  return target === null ? OTHER : classifyReflectionTarget(target, pagePath);
}

/** Core `link_targets`: the distinct scanned targets, in order of first appearance. */
function linkTargets(source: string): string[] {
  const out: string[] = [];
  for (const token of linkTokensIn(source)) {
    const target = scanned(token);
    if (target !== null && !out.includes(target)) {
      out.push(target);
    }
  }
  return out;
}

/** Mirror of core `reflection_asset_refs`, through `imageFormat`'s line scanner and fence rule. */
export function reflectionAssetRefs(
  source: string,
  pagePath: string,
): string[] {
  const out: string[] = [];
  for (const target of linkTargets(source)) {
    const found = classifyReflectionTarget(target, pagePath);
    if (found.kind === "reflection" && !out.includes(found.path)) {
      out.push(found.path);
    }
  }
  return out;
}

/** Mirror of core `engram_attachment_embeds`. */
export function engramAttachmentEmbeds(
  source: string,
  pagePath: string,
): string[] {
  return linkTargets(source).filter(
    (target) => classifyReflectionTarget(target, pagePath).kind === "engram",
  );
}

/** Mirror of core `relative_to`: from `guides/a.md` to `assets/x.png` is `../assets/x.png`. */
export function relativeTo(pagePath: string, target: string): string {
  const from = folderOf(pagePath)
    .split("/")
    .filter((s) => s !== "");
  const to = target.split("/");
  let common = 0;
  while (
    common < from.length &&
    common < to.length &&
    from[common] === to[common]
  ) {
    common += 1;
  }
  return [
    ...Array<string>(from.length - common).fill(".."),
    ...to.slice(common),
  ].join("/");
}
