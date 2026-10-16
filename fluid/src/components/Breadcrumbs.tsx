/**
 * The path row under the top bar: where this document lives, one crumb per
 * folder. Folder crumbs are plain text - no folder route exists to point at -
 * and the leaf names the page itself. Middle crumbs hide on narrow viewports
 * so a deep path degrades to "domain > title" rather than wrapping.
 */

import type { ReactElement } from "react";
import { Link } from "react-router";

import { folderRoute, reflectionRoute } from "../paths";
import { CHROME_LINK, FOCUS_RING } from "./primitives";

export interface Crumb {
  label: string;
  href: string | null;
  /** Shown on paper only: the bar names the domain on screen. */
  printOnly?: boolean;
}

/** The folder levels of a path, each a link to its folder's own page. */
function folderCrumbs(domain: string, segments: string[]): Crumb[] {
  return segments.slice(0, -1).map((folder, at) => ({
    label: folder,
    href: folderRoute(domain, segments.slice(0, at + 1).join("/")),
  }));
}

/**
 * An engram's trail: `folder / Title`. The domain is in the top bar, so it
 * only appears on paper, where the bar does not.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function crumbsOf(
  domain: string,
  permalink: string,
  title: string,
): Crumb[] {
  const segments = permalink.split("/").filter((segment) => segment !== "");
  return [
    { label: domain, href: null, printOnly: true },
    ...folderCrumbs(domain, segments),
    { label: title, href: null },
  ];
}

/**
 * A Reflection page's trail: `Reflection / folder / Title`, by the page's
 * title and not its file name. Reflection folders have no page of their own.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function reflectionCrumbsOf(
  domain: string,
  path: string,
  title: string,
): Crumb[] {
  const segments = path.split("/").filter((segment) => segment !== "");
  return [
    { label: "Reflection", href: reflectionRoute(domain) },
    ...segments.slice(0, -1).map((folder) => ({ label: folder, href: null })),
    { label: title, href: null },
  ];
}

/** The separator, drawn and not spoken. */
function Slash(): ReactElement {
  return (
    <span aria-hidden="true" className="shrink-0 text-faint">
      /
    </span>
  );
}

export function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }): ReactElement {
  const last = crumbs.length - 1;
  // The first crumb a reader sees on screen: the print-only domain has no
  // separator before whatever follows it on screen.
  const shown = crumbs.filter((crumb) => crumb.printOnly !== true);
  return (
    // Deliberately NOT print:hidden: on paper the details panel is hidden,
    // so the trail is the one line that still says where this document
    // lives (domain, folders, title) - the printed address.
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 flex-nowrap items-center gap-1 text-caption text-slate-500 dark:text-slate-400">
        {crumbs.map((crumb, at) => {
          const printOnly = crumb.printOnly === true;
          const first = crumb === shown[0];
          const middle = !printOnly && crumb !== shown[0] && at !== last;
          return (
            <li
              key={`${String(at)}-${crumb.label}`}
              // Middle levels give way first: they shrink four times as fast
              // as the ends, so a long trail truncates in the middle.
              className={`min-w-0 items-center gap-1 ${
                printOnly ? "hidden print:flex" : "flex"
              } ${middle ? "min-w-12 shrink-[4]" : at === last ? "min-w-16" : first ? "shrink-0" : ""}`}
            >
              {!first && !printOnly && <Slash />}
              {printOnly && (
                <>
                  <span className="max-w-48 truncate">{crumb.label}</span>
                  <Slash />
                </>
              )}
              {!printOnly && crumb.href !== null && (
                <Link
                  to={crumb.href}
                  className={`min-w-0 max-w-48 truncate rounded ${CHROME_LINK} ${FOCUS_RING}`}
                >
                  {crumb.label}
                </Link>
              )}
              {!printOnly && crumb.href === null && (
                <span
                  aria-current={at === last ? "page" : undefined}
                  className={`min-w-0 truncate ${at === last ? "max-w-72 font-medium text-ink-2" : "max-w-48"}`}
                >
                  {crumb.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
