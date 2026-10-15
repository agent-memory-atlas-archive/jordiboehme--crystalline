/**
 * A domain's Reflection: the tree, one reflection, its threads, the reflect
 * queue, the review split and search, as the REST contract answers them.
 *
 * Imported only by the lazy Reflection screens (see `reflectionDomains.ts`
 * for the eager part). Every route passes the engine's JSON through, which
 * the OpenAPI document types as an opaque object, so every reader here reads
 * fields rather than casting. Every query key starts with
 * `reflectionKey(domain)`, so one invalidation refreshes a whole domain's
 * Reflection after a write.
 */

import { API_BASE, api, encodePermalink, encodeSegment } from "./client";
import {
  type AssetHome,
  type AttachmentRow,
  type UploadedAttachment,
  readAttachmentRows,
  readUploaded,
} from "./files";
import { asArray, asNumber, asObject, asString, asStrings } from "./json";
import { reflectionKey } from "./reflectionDomains";
import { reflectionTargetOf, relativeTo } from "../reflectionAssets";

export { reflectionKey };

export type SourceState = "current" | "changed" | "retired" | "missing";
export interface SourceView {
  permalink: string;
  title: string;
  state: SourceState;
}

export type TreeNode =
  | { kind: "folder"; name: string; path: string; children: TreeNode[] }
  | {
      kind: "reflection";
      name: string;
      path: string;
      title: string;
      openThreads: number;
      sections: number;
    };

export interface ReflectionTree {
  domain: string;
  pact: { path: string; title: string; exists: boolean; openThreads: number };
  nodes: TreeNode[];
}

export interface SectionView {
  id: string | null;
  heading: string;
  line: number;
  changed: boolean;
  /** Null when the server left the field out: the caller reads no engrams. */
  sources: SourceView[] | null;
}

export type AnchorState = "found" | "text_changed" | "section_gone";
export interface ThreadEntry {
  at: string;
  kind: "comment" | "resolve" | "reopen";
  author: { name: string; agent: boolean };
  text: string;
}
export interface ThreadView {
  id: string;
  path: string;
  anchor: {
    section: string;
    quote: string | null;
    occurrence: number;
    state: AnchorState;
  };
  status: "open" | "resolved";
  waitingOn: "people" | "agent";
  openedAt: string;
  ageSecs: number;
  entries: ThreadEntry[];
}

export interface ReflectionDoc {
  domain: string;
  path: string;
  title: string;
  markdown: string;
  checksum: string;
  sections: SectionView[];
  threads: ThreadView[];
  /** Who is in the live room right now; empty when no room is open. */
  livePresent: string[];
}

export interface QueueItem {
  n: number;
  kind: "feedback" | "update" | "review";
  what: string;
  path: string;
  section: string | null;
  heading: string | null;
  ageSecs: number;
  changedBy: string[];
  /** Id lines are left in by the engine; strip them before showing. */
  diff: string | null;
  sources: SourceView[] | null;
  folder: string | null;
  engrams: string[];
  count: number | null;
  thread: string | null;
  /** `off_structure` only: the pact's Structure globs the page is outside of. */
  structure: string[];
}
export interface ReflectQueue {
  total: number;
  kinds: { feedback: number; update: number; review: number };
  items: QueueItem[];
  guidance: string | null;
}

export interface ReviewGroup {
  path: string;
  title: string;
  threads: ThreadView[];
}
export interface ReflectionReview {
  waitingForPeople: ReviewGroup[];
  waitingForTheAgent: ReviewGroup[];
  queue: ReflectQueue;
}

export interface SearchHit {
  path: string;
  title: string;
  /** A section id, `_top` for the text before the first heading, or null for a heading with no id yet. */
  section: string | null;
  heading: string;
  snippet: string;
}

/** The modes the Reflection's search runs (engram search's `title` is not one of them). */
export const REFLECTION_SEARCH_MODES = ["hybrid", "text", "semantic"] as const;
export type ReflectionSearchMode = (typeof REFLECTION_SEARCH_MODES)[number];
export const DEFAULT_REFLECTION_SEARCH_MODE: ReflectionSearchMode = "hybrid";

/** A mode from the address, the default for anything else. */
export function readReflectionSearchMode(
  value: string | null,
): ReflectionSearchMode {
  return (REFLECTION_SEARCH_MODES as readonly string[]).includes(value ?? "")
    ? (value as ReflectionSearchMode)
    : DEFAULT_REFLECTION_SEARCH_MODE;
}

/**
 * One page of hits. `mode` is what ran, not what was asked for: hybrid and
 * semantic answer as text while the pages are not embedded yet.
 */
export interface ReflectionSearch {
  mode: ReflectionSearchMode | null;
  total: number;
  page: number;
  limit: number;
  hits: SearchHit[];
}

export interface MoveReceipt {
  to: string;
  /** Pages that still link the old path because they could not be rewritten. */
  linksFailed: { path: string; reason: string }[];
}

function readLinksFailed(value: unknown): MoveReceipt["linksFailed"] {
  return asArray(value).flatMap((f) => {
    const row = asObject(f);
    const path = asString(row?.path);
    return path === null ? [] : [{ path, reason: asString(row?.reason) ?? "" }];
  });
}

function readSource(value: unknown): SourceView | null {
  const record = asObject(value);
  const permalink = asString(record?.permalink);
  if (permalink === null) {
    return null;
  }
  const state = asString(record?.state);
  return {
    permalink,
    title: asString(record?.title) ?? permalink,
    state:
      state === "changed" || state === "retired" || state === "missing"
        ? state
        : "current",
  };
}

function readSources(value: unknown): SourceView[] | null {
  return Array.isArray(value)
    ? value.map(readSource).filter((s): s is SourceView => s !== null)
    : null;
}

function readNode(value: unknown): TreeNode | null {
  const record = asObject(value);
  const path = asString(record?.path);
  const name = asString(record?.name) ?? path;
  if (path === null || name === null) {
    return null;
  }
  if (record?.kind === "folder") {
    return {
      kind: "folder",
      name,
      path,
      children: asArray(record.children)
        .map(readNode)
        .filter((n): n is TreeNode => n !== null),
    };
  }
  if (record?.kind === "reflection") {
    return {
      kind: "reflection",
      name,
      path,
      title: asString(record.title) ?? name,
      openThreads: asNumber(record.open_threads) ?? 0,
      sections: asNumber(record.sections) ?? 0,
    };
  }
  return null;
}

export function readTree(payload: unknown): ReflectionTree {
  const record = asObject(payload);
  const pact = asObject(record?.pact);
  return {
    domain: asString(record?.domain) ?? "",
    pact: {
      path: asString(pact?.path) ?? "PACT.md",
      title: asString(pact?.title) ?? "PACT.md",
      exists: pact?.exists === true,
      openThreads: asNumber(pact?.open_threads) ?? 0,
    },
    nodes: asArray(record?.nodes)
      .map(readNode)
      .filter((n): n is TreeNode => n !== null),
  };
}

function readEntry(value: unknown): ThreadEntry | null {
  const record = asObject(value);
  const at = asString(record?.at);
  const kind = asString(record?.kind);
  const author = asObject(record?.author);
  if (
    at === null ||
    (kind !== "comment" && kind !== "resolve" && kind !== "reopen")
  ) {
    return null;
  }
  return {
    at,
    kind,
    author: {
      name: asString(author?.name) ?? "someone",
      agent: author?.agent === true,
    },
    text: typeof record?.text === "string" ? record.text : "",
  };
}

export function readThread(value: unknown): ThreadView | null {
  const record = asObject(value);
  const id = asString(record?.id);
  const anchor = asObject(record?.anchor);
  const section = asString(anchor?.section);
  if (id === null || section === null) {
    return null;
  }
  const state = asString(anchor?.state);
  return {
    id,
    path: asString(record?.path) ?? "",
    anchor: {
      section,
      quote: asString(anchor?.quote),
      occurrence: asNumber(anchor?.occurrence) ?? 1,
      // Anything unknown never paints: failing toward "the text changed"
      // shows the quote as text instead of highlighting a guess.
      state:
        state === "found" || state === "section_gone" ? state : "text_changed",
    },
    status: record?.status === "resolved" ? "resolved" : "open",
    waitingOn: record?.waiting_on === "people" ? "people" : "agent",
    openedAt: asString(record?.opened_at) ?? "",
    ageSecs: asNumber(record?.age_secs) ?? 0,
    entries: asArray(record?.entries)
      .map(readEntry)
      .filter((e): e is ThreadEntry => e !== null),
  };
}

function readThreads(value: unknown): ThreadView[] {
  return asArray(value)
    .map(readThread)
    .filter((t): t is ThreadView => t !== null);
}

export function readDoc(payload: unknown): ReflectionDoc {
  const record = asObject(payload);
  return {
    domain: asString(record?.domain) ?? "",
    path: asString(record?.path) ?? "",
    title: asString(record?.title) ?? asString(record?.path) ?? "",
    markdown: typeof record?.markdown === "string" ? record.markdown : "",
    checksum: asString(record?.checksum) ?? "",
    sections: asArray(record?.sections).flatMap((value) => {
      const s = asObject(value);
      const line = asNumber(s?.line);
      if (line === null) {
        return [];
      }
      return [
        {
          id: asString(s?.id),
          heading: asString(s?.heading) ?? "",
          line,
          changed: s?.changed === true,
          sources: readSources(s?.sources),
        },
      ];
    }),
    threads: readThreads(record?.threads),
    livePresent: asStrings(asObject(record?.live)?.present),
  };
}

function readItem(value: unknown): QueueItem | null {
  const r = asObject(value);
  const kind = asString(r?.kind);
  if (kind !== "feedback" && kind !== "update" && kind !== "review") {
    return null;
  }
  return {
    n: asNumber(r?.n) ?? 0,
    kind,
    what: asString(r?.what) ?? "",
    path: asString(r?.path) ?? "",
    section: asString(r?.section),
    heading: asString(r?.heading),
    ageSecs: asNumber(r?.age_secs) ?? 0,
    changedBy: asStrings(r?.changed_by),
    diff: asString(r?.diff),
    sources: readSources(r?.sources),
    folder: asString(r?.folder),
    engrams: asStrings(r?.engrams),
    count: asNumber(r?.count),
    thread: asString(r?.thread),
    structure: asStrings(r?.structure),
  };
}

export function readQueue(payload: unknown): ReflectQueue {
  const r = asObject(payload);
  const kinds = asObject(r?.kinds);
  return {
    total: asNumber(r?.total) ?? 0,
    kinds: {
      feedback: asNumber(kinds?.feedback) ?? 0,
      update: asNumber(kinds?.update) ?? 0,
      review: asNumber(kinds?.review) ?? 0,
    },
    items: asArray(r?.queue)
      .map(readItem)
      .filter((i): i is QueueItem => i !== null),
    guidance: asString(r?.guidance),
  };
}

function readGroups(value: unknown): ReviewGroup[] {
  return asArray(value).flatMap((g) => {
    const r = asObject(g);
    const path = asString(r?.path);
    return path === null
      ? []
      : [
          {
            path,
            title: asString(r?.title) ?? path,
            threads: readThreads(r?.threads),
          },
        ];
  });
}

export function readReview(payload: unknown): ReflectionReview {
  const r = asObject(payload);
  return {
    waitingForPeople: readGroups(r?.waiting_for_people),
    waitingForTheAgent: readGroups(r?.waiting_for_the_agent),
    queue: readQueue(r?.queue),
  };
}

export function readSearch(payload: unknown): ReflectionSearch {
  const record = asObject(payload);
  const mode = asString(record?.mode);
  const hits = asArray(record?.hits).flatMap((h) => {
    const r = asObject(h);
    const path = asString(r?.path);
    return path === null
      ? []
      : [
          {
            path,
            title: asString(r?.title) ?? path,
            section: asString(r?.section),
            heading: asString(r?.heading) ?? "",
            snippet: asString(r?.snippet) ?? "",
          },
        ];
  });
  return {
    mode:
      mode !== null &&
      (REFLECTION_SEARCH_MODES as readonly string[]).includes(mode)
        ? (mode as ReflectionSearchMode)
        : null,
    total: asNumber(record?.total) ?? hits.length,
    page: asNumber(record?.page) ?? 1,
    limit: asNumber(record?.limit) ?? hits.length,
    hits,
  };
}

export function reflectionTreeKey(domain: string): readonly unknown[] {
  return [...reflectionKey(domain), "tree"];
}
export function reflectionDocKey(
  domain: string,
  path: string,
): readonly unknown[] {
  return [...reflectionKey(domain), "doc", path];
}
export function reflectionThreadsKey(
  domain: string,
  path: string,
  status: "open" | "resolved" | "all",
): readonly unknown[] {
  return [...reflectionKey(domain), "threads", path, status];
}
export function reflectionReviewKey(domain: string): readonly unknown[] {
  return [...reflectionKey(domain), "review"];
}
export function reflectionSearchKey(
  domain: string,
  query: string,
  mode: ReflectionSearchMode,
  page: number,
): readonly unknown[] {
  return [...reflectionKey(domain), "search", query, mode, page];
}

function base(domain: string): string {
  return `/domains/${encodeSegment(domain)}`;
}
function pagePath(domain: string, path: string): string {
  return `${base(domain)}/reflections/${encodePermalink(path)}`;
}

export async function fetchReflectionTree(
  domain: string,
): Promise<ReflectionTree> {
  return readTree(await api<unknown>(`${base(domain)}/reflection/tree`));
}

export async function fetchReflection(
  domain: string,
  path: string,
): Promise<ReflectionDoc> {
  return readDoc(await api<unknown>(pagePath(domain, path)));
}

export interface SaveReceipt {
  checksum: string;
  created: boolean;
  idsAssigned: string[];
  /** Whether this write advanced the baseline. */
  curated: boolean;
  /** Set when the write landed in an open live room. */
  landedLive: boolean;
  /** Who is in the open room; empty when none is open. */
  present: string[];
  /** When the write is on disk only: what the room meets, `conflict` or `waiting`. */
  room: "conflict" | "waiting" | null;
  /** A sentence saying what the people in the room meet, as the server words it. */
  roomNote: string | null;
}

export async function saveReflection(
  domain: string,
  path: string,
  markdown: string,
  options: { expectedChecksum?: string; create?: boolean } = {},
): Promise<SaveReceipt> {
  const body: Record<string, unknown> = { markdown };
  if (options.expectedChecksum !== undefined) {
    body.expected_checksum = options.expectedChecksum;
  }
  if (options.create === true) {
    body.create = true;
  }
  const r = asObject(
    await api<unknown>(pagePath(domain, path), {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  );
  return {
    checksum: asString(r?.checksum) ?? "",
    created: r?.created === true,
    idsAssigned: asStrings(r?.ids_assigned),
    curated: r?.curated === true,
    landedLive: r?.landed === "live",
    present: asStrings(r?.present),
    room: r?.room === "conflict" || r?.room === "waiting" ? r.room : null,
    roomNote: asString(r?.room_note),
  };
}

export async function deleteReflection(
  domain: string,
  path: string,
): Promise<void> {
  await api(pagePath(domain, path), { method: "DELETE" });
}

export async function moveReflection(
  domain: string,
  from: string,
  to: string,
): Promise<MoveReceipt> {
  const r = asObject(
    await api<unknown>(`${base(domain)}/reflection/move`, {
      method: "POST",
      body: JSON.stringify({ from, to }),
    }),
  );
  return {
    to: asString(r?.to) ?? to,
    linksFailed: readLinksFailed(r?.links_failed),
  };
}

export async function fetchThreads(
  domain: string,
  options: { path?: string; status?: "open" | "resolved" | "all" } = {},
): Promise<ThreadView[]> {
  const query = new URLSearchParams();
  query.set("status", options.status ?? "open");
  if (options.path !== undefined) {
    query.set("path", options.path);
  }
  return readThreads(
    asObject(
      await api<unknown>(
        `${base(domain)}/reflection/threads?${query.toString()}`,
      ),
    )?.threads,
  );
}

export interface OpenThreadInput {
  path: string;
  /** A section id, `_top` for the intro, or the heading of a section with no id yet. */
  section: string;
  quote?: string;
  occurrence?: number;
  text: string;
}

export async function openThread(
  domain: string,
  input: OpenThreadInput,
): Promise<ThreadView | null> {
  return readThread(
    await api<unknown>(`${base(domain)}/reflection/threads`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  );
}

export async function stepThread(
  domain: string,
  id: string,
  action: "answer" | "resolve" | "reopen",
  body: { path: string; text?: string; outcome?: string },
): Promise<ThreadView | null> {
  return readThread(
    await api<unknown>(
      `${base(domain)}/reflection/threads/${encodeSegment(id)}/${action}`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    ),
  );
}

export async function fetchReview(domain: string): Promise<ReflectionReview> {
  return readReview(await api<unknown>(`${base(domain)}/reflection/review`));
}

/**
 * `GET .../reflection/search`. The default mode and the first page are left
 * out of the address, as engram search leaves them out of its own.
 */
export async function searchReflections(
  domain: string,
  options: {
    query: string;
    mode?: ReflectionSearchMode;
    page?: number;
    limit?: number;
  },
): Promise<ReflectionSearch> {
  const q = new URLSearchParams({
    q: options.query,
    limit: String(options.limit ?? 20),
  });
  if (
    options.mode !== undefined &&
    options.mode !== DEFAULT_REFLECTION_SEARCH_MODE
  ) {
    q.set("search_type", options.mode);
  }
  if (options.page !== undefined && options.page > 1) {
    q.set("page", String(options.page));
  }
  return readSearch(
    await api<unknown>(`${base(domain)}/reflection/search?${q.toString()}`),
  );
}

/** The cache key of a domain's Reflection file listing. */
export function reflectionAssetsKey(domain: string): readonly unknown[] {
  return [...reflectionKey(domain), "assets"];
}

/** A Reflection file's path inside `reflections/` (`assets/...`) on the file route. */
function assetRoute(domain: string, path: string): string {
  const rest = path.startsWith("assets/") ? path.slice("assets/".length) : path;
  return `${base(domain)}/reflection/assets/${encodePermalink(rest)}`;
}

/** The URL the browser reads a Reflection file at; `path` is `assets/...`. */
export function reflectionAssetUrl(domain: string, path: string): string {
  return `${API_BASE}${assetRoute(domain, path)}`;
}

export async function fetchReflectionAssets(
  domain: string,
): Promise<AttachmentRow[]> {
  return readAttachmentRows(
    asObject(await api<unknown>(`${base(domain)}/reflection/assets`))?.assets,
  );
}

export type UploadedReflectionAsset = UploadedAttachment & {
  /** Whether the path held no file before. */
  created: boolean;
};

/** One PUT of a file's bytes; the two callers below decide what it may overwrite. */
async function putReflectionAsset(
  domain: string,
  path: string,
  file: Blob,
): Promise<UploadedReflectionAsset> {
  const payload = await api<unknown>(assetRoute(domain, path), {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  return {
    ...readUploaded(payload, path, file.size),
    created: asObject(payload)?.created === true,
  };
}

/** A new file under a path the upload flow picked as free. */
export async function uploadReflectionAsset(
  domain: string,
  path: string,
  file: Blob,
): Promise<UploadedReflectionAsset> {
  return putReflectionAsset(domain, path, file);
}

/**
 * New bytes for a file that exists, under its own path: a curator's Replace.
 * Kept apart from {@link uploadReflectionAsset} on purpose, so a create-only
 * precondition added to new uploads never refuses a replace.
 */
export async function replaceReflectionAsset(
  domain: string,
  path: string,
  file: Blob,
): Promise<UploadedReflectionAsset> {
  return putReflectionAsset(domain, path, file);
}

export async function deleteReflectionAsset(
  domain: string,
  path: string,
): Promise<void> {
  await api(assetRoute(domain, path), { method: "DELETE" });
}

export interface AssetMoveReceipt extends MoveReceipt {
  from: string;
  /** Pages whose link was rewritten to the new path. */
  linksRewritten: number;
  /** A sentence from the server when the file moved but its index row did not follow. */
  note: string | null;
}

export async function moveReflectionAsset(
  domain: string,
  from: string,
  to: string,
): Promise<AssetMoveReceipt> {
  const r = asObject(
    await api<unknown>(`${base(domain)}/reflection/move-asset`, {
      method: "POST",
      body: JSON.stringify({ from, to }),
    }),
  );
  return {
    from: asString(r?.from) ?? from,
    to: asString(r?.to) ?? to,
    linksRewritten: asNumber(r?.links_rewritten) ?? 0,
    linksFailed: readLinksFailed(r?.links_failed),
    note: asString(r?.note),
  };
}

/** Said when a page links an engram attachment (proposal; see the B9 plan, open question 4). */
export const ENGRAM_FILE =
  "This file is not in the Reflection. A curator copies it into the Reflection's files.";

/** How much of a file's sha256 its URL carries: enough to tell versions apart. */
const VERSION_CHARS = 12;

/** Path to sha256 for every file a listing holds, for {@link reflectionAssetHome}. */
export function assetVersions(
  rows: readonly AttachmentRow[] | undefined,
): ReadonlyMap<string, string> {
  return new Map((rows ?? []).map((row) => [row.path, row.sha256]));
}

/**
 * The Reflection's file store for the page at `pagePath`: its listing, the
 * routes, and the page-relative links core's `classify_target` reads. Callers
 * pass a memoized home. Lazy only: the link rules are not in the entry bundle.
 * `versions` (path to sha256, {@link assetVersions} of the listing) makes
 * `url` name each file's current bytes.
 */
export function reflectionAssetHome(
  domain: string,
  pagePath: string,
  versions?: ReadonlyMap<string, string>,
): AssetHome {
  return {
    key: reflectionAssetsKey(domain),
    list: () => fetchReflectionAssets(domain),
    upload: (path, file) => uploadReflectionAsset(domain, path, file),
    replace: (path, file) => replaceReflectionAsset(domain, path, file),
    remove: (path) => deleteReflectionAsset(domain, path),
    // The version is for the browser only: a replaced file keeps its path,
    // so without it an <img> and the editor's preview keep the old picture.
    // Only the URL carries it; `linkTo` and `resolve` never do, so no
    // document is ever written with it.
    url: (path) => {
      const sha = versions?.get(path);
      const plain = reflectionAssetUrl(domain, path);
      return sha === undefined || sha === ""
        ? plain
        : `${plain}?v=${encodeURIComponent(sha.slice(0, VERSION_CHARS))}`;
    },
    resolve: (target) => {
      const r = reflectionTargetOf(target, pagePath);
      return r.kind === "reflection" ? r.path : null;
    },
    refused: (target) =>
      reflectionTargetOf(target, pagePath).kind === "engram"
        ? ENGRAM_FILE
        : null,
    linkTo: (path) => relativeTo(pagePath, path),
  };
}
