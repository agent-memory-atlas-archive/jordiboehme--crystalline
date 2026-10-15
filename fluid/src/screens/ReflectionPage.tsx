/**
 * One reflection, read.
 *
 * The page is drawn section by section from the texts the engine anchors
 * comments on (`sectionTexts`): the frontmatter and the id lines are never
 * part of what is rendered, so neither can show. Each section is its own
 * `<section>` keyed by its id, which is what a search hit, a thread and a
 * review row link to (`#s-<id>`), and what a selection is read against.
 *
 * Reading is for everybody with at least the comment right; editing is a
 * separate screen over the live room (`reflection-edit/`), the way an engram
 * has a reading page and an editor. The source engrams behind a section are
 * one press away for a reader of engrams, and simply absent for a
 * contributor: the server leaves the field out, and so does this page.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";

import { ApiProblem, problemDetail } from "../api/client";
import type { AssetResolver } from "../api/files";
import type { SectionView, SourceState } from "../api/reflection";
import {
  deleteReflection,
  fetchReflection,
  reflectionAssetHome,
  reflectionAssetsKey,
  reflectionDocKey,
} from "../api/reflection";
import type { ReflectionRight } from "../api/reflectionDomains";
import {
  PACT_PATH,
  atLeast,
  invalidateReflection,
  mayEditPage,
} from "../api/reflectionDomains";
import { useAuth } from "../auth/AuthContext";
import { AttachmentsSection } from "../components/AttachmentsSection";
import { DestructiveAction } from "../components/DestructiveAction";
import { LazyBoundary } from "../components/LazyBoundary";
import { Markdown } from "../components/Markdown";
import {
  ReflectionModeSwitch,
  useReflectionStatus,
} from "../components/ReflectionModeSwitch";
import { ReflectionStateNotice } from "../components/ReflectionStateNotice";
import { ReflectionThreads } from "../components/ReflectionThreads";
import { BUTTON, Chip } from "../components/primitives";
import { Skeleton } from "../components/Skeleton";
import { engramRoute, reflectionEditRoute, reflectionRoute } from "../paths";
import { FOCUS_HEADING, useHeadingFocusRequest } from "../focusHeading";
import { lazyChunk } from "../lazyChunk";
import { discardPageDrafts } from "../reflectionPageDrafts";
import { SECTION_ATTR } from "../reflectionQuotes";
import type { SectionText } from "../reflectionText";
import { sectionTexts } from "../reflectionText";

const MoveReflectionDialog = lazyChunk(() =>
  import("../components/MoveReflectionDialog").then((m) => ({
    default: m.MoveReflectionDialog,
  })),
);

const MoveAssetDialog = lazyChunk(() =>
  import("../components/MoveAssetDialog").then((m) => ({
    default: m.MoveAssetDialog,
  })),
);

/** What removing a Reflection file leaves behind, said before it happens. */
function removeFileText(name: string): string {
  return `Remove ${name}? Pages keep their links until edited. The reflect queue names them as missing.`;
}

const LINK =
  "text-sky-700 underline underline-offset-2 hover:no-underline dark:text-sky-400";

/** A source's state as a chip; a current source needs none. */
// eslint-disable-next-line react-refresh/only-export-components
export function sourceChip(state: SourceState): ReactElement | null {
  switch (state) {
    case "current":
      return null;
    case "changed":
      return <Chip variant="caution">changed</Chip>;
    case "retired":
      return <Chip variant="retired">retired</Chip>;
    case "missing":
      return <Chip variant="danger">missing</Chip>;
  }
}

export default function ReflectionPage(): ReactElement {
  const { domain = "", "*": path = "" } = useParams();
  const status = useReflectionStatus(domain);
  // The move dialog while it is open: the title it names and the path it is
  // anchored on. A move re-anchors it on the new path (it has to outlive the
  // jump to that address); any other change of route shuts it.
  const [moving, setMoving] = useState<{ title: string; at: string } | null>(
    null,
  );
  // The file move dialog while it is open, by the file's stored path. It
  // belongs to the page it was opened on, so any change of route shuts it.
  const [movingFile, setMovingFile] = useState<string | null>(null);
  const [seen, setSeen] = useState(path);
  if (seen !== path) {
    setSeen(path);
    if (moving !== null && moving.at !== path) {
      setMoving(null);
    }
    setMovingFile(null);
  }
  const account = useAuth().user?.name ?? "anonymous";
  if (status.isPending) {
    return <Skeleton label="Loading the page" rows={6} />;
  }
  if (status.error) {
    return (
      <p className="text-sm text-red-800 dark:text-red-200">
        {problemDetail(status.error)}
      </p>
    );
  }
  if (status.data.state !== "on") {
    return <ReflectionStateNotice status={status.data} />;
  }
  return (
    <>
      <PageBody
        domain={domain}
        path={path}
        right={status.data.right}
        engramsVisible={status.data.engramsVisible}
        onMove={(title) => {
          setMoving({ title, at: path });
        }}
        onMoveFile={setMovingFile}
        account={account}
      />
      {/*
        Held here, not in the body: after a move the body shows a skeleton
        while the new address loads, and the dialog must outlive that to list
        the pages it could not relink.
      */}
      {moving !== null && (
        <LazyBoundary fallback={null}>
          <MoveReflectionDialog
            domain={domain}
            path={path}
            title={moving.title}
            onMoved={(to) => {
              setMoving({ title: moving.title, at: to });
            }}
            onClose={() => {
              setMoving(null);
            }}
          />
        </LazyBoundary>
      )}
      {movingFile !== null && (
        <LazyBoundary fallback={null}>
          <MoveAssetDialog
            domain={domain}
            path={movingFile}
            onClose={() => {
              setMovingFile(null);
            }}
          />
        </LazyBoundary>
      )}
    </>
  );
}

function PageBody({
  domain,
  path,
  right,
  engramsVisible,
  onMove,
  onMoveFile,
  account,
}: {
  domain: string;
  path: string;
  right: ReflectionRight;
  engramsVisible: boolean;
  onMove: (title: string) => void;
  /** Opens the file move dialog, which the page holds. */
  onMoveFile: (path: string) => void;
  account: string;
}): ReactElement {
  const [deleted, setDeleted] = useState(false);
  const doc = useQuery({
    queryKey: reflectionDocKey(domain, path),
    queryFn: () => fetchReflection(domain, path),
    // Off once the page is deleted: dropping it from the cache must not make
    // this screen fetch it again before the route leaves.
    enabled: !deleted,
  });
  const { hash } = useLocation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  useHeadingFocusRequest(doc.data !== undefined);
  const remove = useMutation({
    mutationFn: () => deleteReflection(domain, path),
    onSuccess: () => {
      setDeleted(true);
      discardPageDrafts(account, domain, path);
      // The page is gone: drop it from the cache before leaving, so nothing
      // refetches it into a 404.
      queryClient.removeQueries({ queryKey: reflectionDocKey(domain, path) });
      invalidateReflection(queryClient, domain);
      void navigate(reflectionRoute(domain), {
        replace: true,
        state: FOCUS_HEADING,
      });
    },
  });
  const articleRef = useRef<HTMLElement | null>(null);
  const sections = useMemo<SectionText[]>(
    () => (doc.data ? sectionTexts(doc.data.markdown, doc.data.sections) : []),
    [doc.data],
  );
  // One resolver per page: images and files load from the Reflection itself.
  const assets = useMemo(
    () => reflectionAssetHome(domain, path),
    [domain, path],
  );
  // A link to a section (`#s-<id>`) or a thread (`#<thread id>`, which is
  // t-<hex> already: add no prefix) scrolls there once
  // the page has something to scroll to.
  useEffect(() => {
    if (!doc.data || hash.length < 2) {
      return;
    }
    document
      .getElementById(decodeURIComponent(hash.slice(1)))
      ?.scrollIntoView({ block: "start" });
  }, [doc.data, hash]);

  if (doc.error) {
    const missing = doc.error instanceof ApiProblem && doc.error.status === 404;
    return (
      <div className="flex flex-col items-start gap-3">
        <h1 className="text-display">
          {missing ? "Page not found" : "The page could not be read"}
        </h1>
        {missing ? (
          <p className="text-sm">{`No page at ${path} in ${domain}.`}</p>
        ) : (
          <p role="alert" className="text-sm text-red-800 dark:text-red-200">
            {problemDetail(doc.error)}
          </p>
        )}
        <Link to={reflectionRoute(domain)} className={`text-sm ${LINK}`}>
          {`See the Reflection of ${domain}`}
        </Link>
      </div>
    );
  }
  if (!doc.data) {
    return <Skeleton label="Loading the page" rows={6} />;
  }
  const page = doc.data;
  // The page's own `# Title` is its heading when it has one; otherwise the
  // header draws the title, so the page always has exactly one.
  const ownTitle = /^\s*#[ \t]/.test(sections[0]?.text ?? "");
  // Replace, move and remove are curate verbs, offered on the reading page
  // only: a move waits while a linking page is open in a room, the
  // curator's own included.
  const curate = atLeast(right, "curate");
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-caption text-slate-500 dark:text-slate-400">
            <Link to={reflectionRoute(domain)} className={LINK}>
              {domain}
            </Link>
            {` / ${path}`}
          </p>
          <div className="flex items-center gap-2">
            <ReflectionModeSwitch domain={domain} current="reflection" />
            {mayEditPage(right, path) && (
              <Link
                to={reflectionEditRoute(domain, path)}
                className={BUTTON.primary}
              >
                Edit
              </Link>
            )}
            {atLeast(right, "edit") && path !== PACT_PATH && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    onMove(page.title);
                  }}
                  className={BUTTON.secondary}
                >
                  Move
                </button>
                <DestructiveAction
                  label="Delete"
                  confirmLabel="Confirm delete"
                  pending={remove.isPending}
                  onConfirm={() => {
                    remove.mutate();
                  }}
                />
              </>
            )}
          </div>
        </div>
        {remove.error && (
          <p
            role="alert"
            className="rounded bg-red-50 px-2 py-1 text-sm text-red-800 dark:bg-red-950 dark:text-red-200"
          >
            {problemDetail(remove.error)}
          </p>
        )}
        {!ownTitle && <h1 className="text-display">{page.title}</h1>}
        {page.livePresent.length > 0 && (
          <p
            role="status"
            className="text-sm text-slate-500 dark:text-slate-400"
          >
            {`${page.livePresent.join(", ")} editing now`}
          </p>
        )}
      </header>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <article ref={articleRef} className="flex flex-col gap-4">
            {sections.map((section, index) => (
              <PageSection
                key={section.id ?? `h${index}:${section.heading}`}
                domain={domain}
                assets={assets}
                index={index}
                section={section}
                engramsVisible={engramsVisible}
                view={
                  page.sections.find(
                    (s) => s.id === section.id && s.heading === section.heading,
                  ) ?? null
                }
              />
            ))}
          </article>
          {/*
          Outside the article: selections for threads are read against it,
          and this list is not part of the page's text.
        */}
          <AttachmentsSection
            domain={domain}
            body={page.markdown}
            home={assets}
            canDelete={curate}
            canReplace={curate}
            onMove={curate ? onMoveFile : undefined}
            onRemoved={() => {
              invalidateReflection(queryClient, domain);
              void queryClient.invalidateQueries({
                queryKey: reflectionAssetsKey(domain),
              });
            }}
            confirmText={removeFileText}
          />
        </div>
        <aside aria-label="Threads" className="flex flex-col gap-3">
          <ReflectionThreads
            domain={domain}
            path={path}
            doc={page}
            sections={sections}
            right={right}
            articleRef={articleRef}
          />
        </aside>
      </div>
    </div>
  );
}

function PageSection({
  domain,
  assets,
  index,
  section,
  engramsVisible,
  view,
}: {
  /** For the source links only; the rendered body takes no domain (see above). */
  domain: string;
  /** The Reflection's own files: images, file links and refused engram files. */
  assets: AssetResolver;
  /** Position on the page: makes the DOM id of an id-less section unique. */
  index: number;
  section: SectionText;
  engramsVisible: boolean;
  view: SectionView | null;
}): ReactElement {
  const key = section.id ?? section.heading;
  // A section without an id yet has no stable address; its position keeps
  // two same-named headings apart.
  const domId = section.id === null ? `s-h${index}` : `s-${section.id}`;
  return (
    <section
      id={domId}
      {...{ [SECTION_ATTR]: key }}
      className="flex flex-col gap-1"
    >
      {/*
        No `domain`: it would resolve `assets/` links through the engram
        files route. `assets` resolves them through the Reflection's own.
      */}
      <Markdown source={section.text} assets={assets} sourceSpans />
      {engramsVisible &&
        view?.sources !== null &&
        view?.sources !== undefined &&
        view.sources.length > 0 && (
          <Sources domain={domain} heading={section.heading} view={view} />
        )}
    </section>
  );
}

function Sources({
  domain,
  heading,
  view,
}: {
  domain: string;
  heading: string;
  view: SectionView;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const panel = useId();
  return (
    <div className="text-sm">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        aria-label={`Sources for ${heading}`}
        onClick={() => {
          setOpen(!open);
        }}
        className={BUTTON.ghost}
      >
        Sources
      </button>
      <ul id={panel} hidden={!open} className="mt-1 flex flex-col gap-1 pl-2">
        {(view.sources ?? []).map((source) => (
          <li key={source.permalink} className="flex items-center gap-2">
            <Link to={engramRoute(domain, source.permalink)} className={LINK}>
              {source.title}
            </Link>
            {sourceChip(source.state)}
          </li>
        ))}
      </ul>
    </div>
  );
}
