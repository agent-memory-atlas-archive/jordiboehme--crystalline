/**
 * The sidebar while a domain's Reflection is on screen: the pact, the tree of
 * pages, and the way to the review screen.
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
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ReactElement } from "react";
import { useState } from "react";
import { Link, useLocation } from "react-router";

import { problemDetail } from "../api/client";
import type { TreeNode } from "../api/reflection";
import { fetchReflectionTree, reflectionTreeKey } from "../api/reflection";
import { plural } from "../format";
import {
  reflectionPageRoute,
  reflectionReviewRoute,
  reflectionRoute,
} from "../paths";
import { FOCUS_RING } from "./primitives";

const INDENT_LEVELS = 6;

const ROW = `flex min-w-0 items-center gap-1 rounded px-2 py-1 text-sm hover:bg-slate-100 dark:hover:bg-slate-800 ${FOCUS_RING}`;
const CURRENT = "bg-slate-100 font-medium dark:bg-slate-800";

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
  const home = useLocation().pathname === reflectionRoute(domain);
  return (
    <nav aria-label={`Reflection of ${domain}`} className="flex flex-col gap-2">
      <Link
        to={reflectionRoute(domain)}
        aria-current={home ? "page" : undefined}
        className={`text-caption px-2 font-semibold text-slate-500 dark:text-slate-400 ${FOCUS_RING}`}
      >
        {domain}
      </Link>
      {tree.error && (
        <p className="rounded bg-red-50 px-2 py-1.5 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {problemDetail(tree.error)}
        </p>
      )}
      {tree.data && (
        <ul className="flex flex-col gap-0.5">
          <li>
            <Link
              to={reflectionPageRoute(domain, tree.data.pact.path)}
              aria-current={path === tree.data.pact.path ? "page" : undefined}
              title={tree.data.pact.title}
              className={`${ROW} ${path === tree.data.pact.path ? CURRENT : ""}`}
            >
              <span className="truncate">{tree.data.pact.title}</span>
            </Link>
          </li>
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
      <Link to={reflectionReviewRoute(domain)} className={ROW}>
        Review
      </Link>
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
        </Link>
        {/* Beside the link, so the link's name stays the page's title. */}
        {node.openThreads > 0 && (
          <span
            title={plural(node.openThreads, "open thread", "open threads")}
            className="px-2 text-xs text-slate-500 tabular-nums dark:text-slate-400"
          >
            <span aria-hidden="true">{node.openThreads}</span>
            <span className="sr-only">
              {plural(node.openThreads, "open thread", "open threads")}
            </span>
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
          size={14}
          strokeWidth={1.75}
          className="shrink-0"
        />
        <span className="truncate">{node.name}</span>
      </button>
      {open && (
        <ul
          data-depth={depth + 1}
          className={`flex flex-col gap-0.5 ${depth < INDENT_LEVELS ? "ml-3 border-l border-slate-200 pl-1 dark:border-slate-800" : ""}`}
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
