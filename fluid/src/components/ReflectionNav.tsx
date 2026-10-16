/**
 * The sidebar while a domain's Reflection is on screen (spec 4.4): Overview
 * (the Reflection home), How we write (the pact, or "Write the pact" while
 * there is none), Review with the open thread count, then the pages by title
 * under a PAGES label, then New page. Review is a destination rather than a
 * page, so it sits with Overview at the top instead of in the tree.
 *
 * The whole tree is one read. A Reflection is written for people at the
 * level its pact agrees on, so it holds tens or hundreds of pages rather than
 * the tens of thousands of engrams a domain can hold, and the contract
 * answers the whole tree at once (`GET .../reflection/tree`). Folders are
 * two controls like the engram tree's: the chevron button opens and shuts
 * the folder in the sidebar; there is no folder page to link to.
 *
 * Depth is the Reflection's own business (the pact says how deep the tree
 * goes), so nothing here caps it. What is capped is the indentation: six
 * levels of it, then rows stop moving right, so a page twelve folders down
 * still has room for its name.
 */

import { useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  House,
  Inbox,
  Plus,
} from "lucide-react";
import type { ReactElement } from "react";
import { useState } from "react";
import { Link, useLocation } from "react-router";

import { problemDetail } from "../api/client";
import type { TreeNode } from "../api/reflection";
import {
  fetchReflectionTree,
  openThreadCount,
  reflectionTreeKey,
} from "../api/reflection";
import { atLeast } from "../api/reflectionDomains";
import { lazyChunk } from "../lazyChunk";
import { plural } from "../format";
import {
  reflectionPageRoute,
  reflectionReviewRoute,
  reflectionRoute,
} from "../paths";
import { LazyBoundary } from "./LazyBoundary";
import { useReflectionStatus } from "./ReflectionModeSwitch";
import { SIDE } from "./primitives";
import { WritePact } from "./WritePact";

const NewReflectionDialog = lazyChunk(() =>
  import("./NewReflectionDialog").then((m) => ({
    default: m.NewReflectionDialog,
  })),
);

const INDENT_LEVELS = 6;

const ROW = SIDE.row;
const CURRENT = SIDE.current;

/** Whether `folder` is `path` or one of its ancestors. */
function holds(folder: string, path: string): boolean {
  return path.startsWith(`${folder}/`);
}

export function ReflectionNav({
  domain,
  path,
}: {
  domain: string;
  path: string;
}): ReactElement {
  const tree = useQuery({
    queryKey: reflectionTreeKey(domain),
    queryFn: () => fetchReflectionTree(domain),
  });
  const at = useLocation().pathname;
  const home = at === reflectionRoute(domain);
  const reviewing = at === reflectionReviewRoute(domain);
  const status = useReflectionStatus(domain);
  const mayEdit =
    status.data !== undefined && atLeast(status.data.right, "edit");
  const mayCurate =
    status.data !== undefined && atLeast(status.data.right, "curate");
  const [creating, setCreating] = useState(false);
  const [launcher, setLauncher] = useState<HTMLElement | null>(null);
  const pact = tree.data?.pact;
  const threads = tree.data === undefined ? 0 : openThreadCount(tree.data);
  return (
    <nav
      aria-label={`Reflection of ${domain}`}
      className="flex flex-col gap-0.5"
    >
      <Link
        to={reflectionRoute(domain)}
        aria-current={home ? "page" : undefined}
        className={`${ROW} ${home ? CURRENT : ""}`}
      >
        <House
          aria-hidden="true"
          size={16}
          strokeWidth={1.75}
          className={SIDE.icon}
        />
        <span className="truncate">Overview</span>
      </Link>
      {pact?.exists === true ? (
        <Link
          to={reflectionPageRoute(domain, pact.path)}
          aria-current={path === pact.path ? "page" : undefined}
          title={pact.title}
          className={`${ROW} ${path === pact.path ? CURRENT : ""}`}
        >
          <BookOpen
            aria-hidden="true"
            size={16}
            strokeWidth={1.75}
            className={SIDE.icon}
          />
          <span className="truncate">How we write</span>
        </Link>
      ) : (
        // Offered to a curator only, and not on the home itself: the home
        // carries the same act beside its pact heading, the way the domain
        // front page carries its own New engram.
        pact !== undefined &&
        mayCurate &&
        !home && <WritePact domain={domain} look="row" />
      )}
      {/* The count beside the link, so the link's name stays "Review". */}
      <div className="flex min-w-0 items-center">
        <Link
          to={reflectionReviewRoute(domain)}
          aria-current={reviewing ? "page" : undefined}
          className={`${ROW} flex-1 ${reviewing ? CURRENT : ""}`}
        >
          <Inbox
            aria-hidden="true"
            size={16}
            strokeWidth={1.75}
            className={SIDE.icon}
          />
          <span className="truncate">Review</span>
          {threads > 0 && (
            <span
              aria-hidden="true"
              title={plural(threads, "open thread", "open threads")}
              className="ml-auto rounded-full bg-accent-tint px-[7px] py-px text-[11.5px] font-semibold text-accent-800 tabular-nums dark:text-accent-200"
            >
              {threads}
            </span>
          )}
        </Link>
        {threads > 0 && (
          <span className="sr-only">
            {`${plural(threads, "open thread", "open threads")} in all`}
          </span>
        )}
      </div>
      <h2 className={SIDE.label}>Pages</h2>
      {tree.error && (
        <p className="rounded bg-red-50 px-2.5 py-1.5 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {problemDetail(tree.error)}
        </p>
      )}
      {tree.data && (
        <ul className="flex flex-col gap-0.5">
          {tree.data.nodes.map((node) => (
            <Node
              key={node.path}
              domain={domain}
              node={node}
              path={path}
              depth={0}
            />
          ))}
        </ul>
      )}
      {mayEdit && (
        <button
          type="button"
          onClick={(event) => {
            setLauncher(event.currentTarget);
            setCreating(true);
          }}
          className={`${ROW} ${SIDE.add} mt-1.5 w-full`}
        >
          <Plus
            aria-hidden="true"
            size={16}
            strokeWidth={1.75}
            className={SIDE.icon}
          />
          New page
        </button>
      )}
      {creating && (
        <LazyBoundary fallback={null}>
          <NewReflectionDialog
            domain={domain}
            returnFocusTo={launcher}
            folder={
              path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""
            }
            onClose={() => {
              setCreating(false);
            }}
          />
        </LazyBoundary>
      )}
    </nav>
  );
}

function Node({
  domain,
  node,
  path,
  depth,
}: {
  domain: string;
  node: TreeNode;
  path: string;
  depth: number;
}): ReactElement {
  const [open, setOpen] = useState(
    () => node.kind === "folder" && holds(node.path, path),
  );
  // Walking to a page under a shut folder opens the folders on its way; a
  // folder the reader opened stays open.
  const onTheWay = node.kind === "folder" && holds(node.path, path);
  // Adjusted while rendering, the way React documents it for state that
  // follows a prop, rather than in an effect.
  const [wasOnTheWay, setWasOnTheWay] = useState(onTheWay);
  if (onTheWay !== wasOnTheWay) {
    setWasOnTheWay(onTheWay);
    if (onTheWay) {
      setOpen(true);
    }
  }
  if (node.kind === "reflection") {
    const current = node.path === path;
    return (
      <li className="flex min-w-0 items-center">
        <Link
          to={reflectionPageRoute(domain, node.path)}
          aria-current={current ? "page" : undefined}
          title={node.title}
          className={`${ROW} flex-1 ${current ? CURRENT : ""}`}
        >
          <span className="truncate">{node.title}</span>
          {/* Drawn inside the row and not spoken there, so the link's name
              stays the page's title; the words follow beside it. */}
          {node.openThreads > 0 && (
            <span
              aria-hidden="true"
              title={plural(node.openThreads, "open thread", "open threads")}
              className={SIDE.count}
            >
              {node.openThreads}
            </span>
          )}
        </Link>
        {node.openThreads > 0 && (
          <span className="sr-only">
            {plural(node.openThreads, "open thread", "open threads")}
          </span>
        )}
      </li>
    );
  }
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${open ? "Collapse" : "Expand"} ${node.name}`}
        onClick={() => {
          setOpen(!open);
        }}
        className={`${ROW} w-full`}
      >
        <Chevron
          aria-hidden="true"
          size={16}
          strokeWidth={1.75}
          className={SIDE.icon}
        />
        <span className="truncate">{node.name}</span>
      </button>
      {open && (
        <ul
          data-depth={depth + 1}
          className={`flex flex-col gap-0.5 ${depth < INDENT_LEVELS ? "ml-[17px] border-l border-hair pl-1" : ""}`}
        >
          {node.children.map((child) => (
            <Node
              key={child.path}
              domain={domain}
              node={child}
              path={path}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export default ReflectionNav;
