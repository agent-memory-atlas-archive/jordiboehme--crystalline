/**
 * The sidebar once a domain is open: which domain you are in, and what is in
 * it.
 *
 * A domain is a place somebody works in rather than an entry they picked once,
 * so while they are inside one the sidebar stops being a list of everything and
 * becomes the way around this one thing: an Overview row that goes to the
 * domain's front page, and the folder tree below it, which is the domain's
 * own shape rather than a flat listing of it. The domain's name is not
 * repeated here (spec 4.4): the top bar's switcher names it, and it is also
 * the way across to another domain and back out to every domain.
 *
 * The tree is walked rather than downloaded. `GET /domains/{d}/tree` answers
 * one folder at a time - its subfolder names and the engrams directly in it -
 * and this asks for a folder only when somebody opens it. A deep fetch would
 * mean pulling every engram of a domain into the frame around every screen,
 * and the folder structure below the first level would still have to be
 * inferred from engram paths. Each folder is cached under the same key the
 * domain screen uses (`treeKey`), so the root costs nothing when a reader is
 * already looking at it and an expanded folder stays expanded for free.
 *
 * The folders on the way to the engram being read start open, because a mark
 * on a row nobody can see marks nothing. The folder being browsed on the
 * screen beside the tree counts as being there too: it opens, and its row
 * carries the same you-are-here mark an engram row does - until a frontmatter
 * filter goes on, when the screen leaves the folder for the whole domain and
 * no row may claim to be the page on screen. Opening and marking are two
 * questions here, and the second one is the screen's own to answer.
 *
 * A folder row is two controls rather than one. Its name is a link to that
 * folder on the domain screen, which is where a folder of any size can be
 * paged; its folder icon is a button that looks inside the sidebar without
 * moving the screen. They are siblings, never nested: a link inside a button
 * is an accessibility violation, and a reader would have no way to say which
 * of the two they meant. A level the server had to cut ends in one more row - the
 * whole folder, on the screen - because the sidebar is a way around a domain
 * rather than a place to render ten thousand rows.
 */

import { useQuery } from "@tanstack/react-query";
import {
  FileText,
  FolderOpen,
  Folder as FolderShut,
  House,
  Plus,
} from "lucide-react";
import { Link, useMatch, useSearchParams } from "react-router";

import { problemDetail } from "../api/client";
import { treeQuery } from "../api/domain";
import type { EngramRow } from "../api/engrams";
import { hasFilters } from "../api/engrams";
import { useDomainWritable } from "../domainWritable";
import { frontmatterFilters } from "../filters";
import { plural } from "../format";
import { isRetired } from "../lifecycle";
import { domainRoute, engramRoute, folderRoute } from "../paths";
import { ENGRAM_PREFETCH, PREFETCH } from "../prefetch";
import { Loading } from "./Loading";
import { FOCUS_RING, SIDE } from "./primitives";
import { useFolderOpen, useSidebarState } from "./sidebarState";

export interface DomainNavProps {
  /** The domain the route is inside. */
  domain: string;
  /**
   * The permalink being read or edited, or the empty string on the domain's
   * own home screen, where there is none.
   */
  permalink: string;
}

export function DomainNav({ domain, permalink }: DomainNavProps) {
  const { canWrite } = useDomainWritable(domain);
  const sidebar = useSidebarState();
  const [params] = useSearchParams();
  // Whether the domain's own page is what stands beside the tree: the exact
  // route, no engram, no editor. Only that page writes `path`, so the folder
  // being browsed is read from the URL there and nowhere else, and the pair
  // is one state rather than two that could contradict each other.
  const onDomainPage = useMatch("/d/:domain") !== null;
  const browsing = onDomainPage ? (params.get("path") ?? "") : "";
  // Which folder may call itself the page the reader is on - not the same
  // question. Under a frontmatter filter the screen leaves the folder and
  // lists the whole domain, so no folder is the current page: the mark would
  // name a page nobody is on, on a link that drops the filter when it is
  // followed. The predicate is the screen's own (`hasFilters` over
  // `frontmatterFilters`), read from the same URL, so the frame and the screen
  // cannot disagree about which view is up. The branch still opens, because a
  // filter is a lens over the domain rather than a reason to fold away where
  // the reader just was.
  const marked = hasFilters(frontmatterFilters(params)) ? "" : browsing;
  const overview = onDomainPage && browsing === "";

  return (
    <div className="flex flex-col gap-0.5">
      <Link
        to={domainRoute(domain)}
        {...PREFETCH.domain}
        // Current while the domain's front page is open: no folder, whatever
        // filter. A folder is its own page and its own row in the tree says
        // so; an engram or the editor is somewhere else again.
        aria-current={overview ? "page" : undefined}
        className={`${SIDE.row} ${overview ? SIDE.current : ""}`}
      >
        <House
          aria-hidden="true"
          size={16}
          strokeWidth={1.75}
          className={SIDE.icon}
        />
        <span className="truncate">Overview</span>
      </Link>

      <h2 className={SIDE.label}>Engrams</h2>
      <TreeBranch
        domain={domain}
        path=""
        permalink={permalink}
        browsing={browsing}
        marked={marked}
      />
      {/*
        Left out on the domain's own home screen only: that screen carries
        the same launcher beside its heading, prefilled with the folder
        being browsed, so the sidebar would otherwise offer a second one
        right next to the first. `permalink` is empty there and there
        alone - both the engram page and the editor resolve one (see
        `Layout.tsx`'s `DomainSidebar`) - so this is the only launcher on
        either of those screens.
      */}
      {canWrite && permalink !== "" && (
        <button
          type="button"
          onClick={(event) => {
            sidebar?.create({
              kind: "engram",
              domain,
              launcher: event.currentTarget,
            });
          }}
          className={`${SIDE.row} ${SIDE.add} mt-1.5 w-full`}
        >
          <Plus
            aria-hidden="true"
            size={16}
            strokeWidth={1.75}
            className={SIDE.icon}
          />
          New engram
        </button>
      )}
    </div>
  );
}

/**
 * One folder: its subfolders, then its engrams.
 *
 * Folders first because they are the shape of the domain and the engrams are
 * what is in it, and a reader scanning for either finds the two in the same
 * place at every level.
 */
function TreeBranch({
  domain,
  path,
  permalink,
  browsing,
  marked,
}: {
  domain: string;
  path: string;
  permalink: string;
  /** The folder the screen beside the tree is pointed at, for what opens. */
  browsing: string;
  /** The folder that may read as the current page, for what is marked. */
  marked: string;
}) {
  const tree = useQuery(treeQuery(domain, path));

  if (tree.isPending) {
    return (
      <Loading compact label="Loading engrams" className="px-2.5 py-1.5" />
    );
  }
  if (tree.error) {
    return (
      <p
        role="alert"
        className="rounded bg-red-50 px-2.5 py-1.5 text-sm text-red-800 dark:bg-red-950 dark:text-red-200"
      >
        {problemDetail(tree.error)}
      </p>
    );
  }

  const folders = tree.data?.folders ?? [];
  const engrams = (tree.data?.engrams ?? []).filter(
    (row) => !isPinnedManifest(row),
  );
  if (folders.length === 0 && engrams.length === 0) {
    return (
      <p className="px-2.5 py-1.5 text-sm text-muted">
        {/*
          One sentence, and no instruction attached to it: the launcher the
          second half used to name is drawn only while an engram is open (see
          below), so on the domain's own home screen - which is exactly where
          an empty tree is read - it pointed at a control that was not there.
        */}
        {path === "" ? "This domain has no engrams yet." : "Nothing in here."}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-0.5">
      {folders.map((name) => (
        <li key={`folder:${name}`}>
          <Folder
            domain={domain}
            path={childPath(path, name)}
            name={name}
            count={tree.data?.folderCounts[name] ?? null}
            permalink={permalink}
            browsing={browsing}
            marked={marked}
          />
        </li>
      ))}
      {engrams.map((row) => (
        <li key={row.permalink}>
          <EngramLink row={row} current={row.permalink === permalink} />
        </li>
      ))}
      {tree.data?.truncated === true && (
        <li>
          <BrowseAll domain={domain} path={path} />
        </li>
      )}
    </ul>
  );
}

/**
 * The last row of a level the server had to cut: the whole folder, on the
 * screen that pages it.
 *
 * It carries no number, deliberately. This is a link, so its words are a
 * promise about where it goes, and the only count in hand is the wrong one for
 * that promise: the level knows how many engrams sit DIRECTLY in this folder,
 * while the screen it opens lists the folder and everything under it and
 * reports that larger total. Two numbers for one click is worse than none, and
 * at the root - where the row names the domain - a direct count reads as the
 * size of the whole domain, which it is not. The payload's `total` stays a
 * true fact about the level for anything that wants it; if a number is ever
 * wanted here it has to be the recursive one. The server sends that number
 * per child folder (`folderCounts`, drawn on the folder rows), but not for
 * the level itself.
 *
 * Muted and one step down in size, because it is the only row here that is not
 * a thing in the domain. Muted at slate-600 rather than the slate-500 the
 * app's captions usually wear, because this caption has a hover state under
 * it: slate-500 on the slate-100 wash is 4.35:1, under the 4.5:1 floor for
 * text this size, while slate-600 is 7.58:1 on white and 6.92:1 on the wash.
 * Dark needs no such step: slate-400 is 7.66:1 on slate-950 and 5.56:1 on the
 * slate-800 wash.
 */
function BrowseAll({ domain, path }: { domain: string; path: string }) {
  const here = path.split("/").pop() ?? path;
  return (
    <Link
      to={folderRoute(domain, path)}
      className={`${SIDE.row} text-caption text-slate-600 dark:text-slate-400`}
    >
      {path === ""
        ? "Browse all engrams in this domain"
        : `Browse all of ${here}`}
    </Link>
  );
}

/**
 * Whether a browse row is the domain's MANIFEST, which is read on the domain
 * page and so must not be drawn inside the tree.
 *
 * The engine lists the manifest among a domain's engrams like any other file,
 * and its permalink is either the reserved name itself or whatever the file's
 * own frontmatter declares - `MANIFEST` on one domain, `manifest` on the next.
 * Case-insensitive covers both, and only a row at the domain's root can match:
 * a `notes/manifest` is somebody's own engram and stays in the tree.
 */
function isPinnedManifest(row: EngramRow): boolean {
  return row.permalink.toUpperCase() === "MANIFEST";
}

/**
 * A folder: a name that goes there, and a folder icon that looks inside.
 *
 * The two are separate controls because they do two different things. The name
 * is a link to this folder on the domain screen, which is the surface that can
 * page a folder of any size; the icon is a disclosure that opens the branch
 * here and leaves the screen beside it where the reader left it. What is
 * inside is mounted only while it is open, which is what makes the fetch lazy.
 *
 * One glyph does both jobs - it says this row is a folder, and its open or
 * shut face says whether the branch is - because the two pictures this row
 * used to carry read as one smudge at sixteen pixels. An engram row carries
 * a document glyph in the same column (spec 4.4), so folders and files line
 * up and the two shapes tell them apart.
 *
 * The button is named after what it will do - "Expand notes", "Collapse
 * notes" - rather than after the folder, for two reasons: two controls in one
 * row both called `notes` would be indistinguishable to anybody listening
 * rather than looking, and the name then says the thing `aria-expanded` only
 * implies. `aria-controls` is left off: the region it would name does not
 * exist while the branch is shut, and an id pointing at nothing is worse than
 * a state the button already carries.
 *
 * A folder opens itself when the engram being read moves into it, or when the
 * screen beside it starts browsing it, whether that happened on arrival or by
 * a link somewhere else. It never closes itself: a reader who folded this
 * branch away meant it, and the state they set is theirs until they leave the
 * folder again.
 */
function Folder({
  domain,
  path,
  name,
  count,
  permalink,
  browsing,
  marked,
}: {
  domain: string;
  path: string;
  name: string;
  /**
   * The engrams under this folder at any depth, the number its listing
   * totals; null from a server that sends no count.
   */
  count: number | null;
  permalink: string;
  browsing: string;
  marked: string;
}) {
  // What opens and what is marked are two questions with two answers. The
  // branch opens when the reader is anywhere inside it - reading an engram
  // under it, or pointed at it by the screen beside the tree, filter or no
  // filter. It says "you are here" only when this folder really is the page
  // on screen, which is what `marked` already decided.
  const here = marked === path;
  const holdsCurrent =
    permalink.startsWith(`${path}/`) ||
    browsing === path ||
    browsing.startsWith(`${path}/`);
  // Kept by the frame rather than by this row, so a folder opened by hand
  // stays open when the drawer shuts or the window crosses the breakpoint.
  // It opens in the same pass that noticed the reader moved into it.
  const [open, setOpen] = useFolderOpen(
    `engrams\u0000${domain}\u0000${path}`,
    holdsCurrent,
  );

  return (
    <>
      {/*
        The row's own metrics, split across its two controls rather than
        dropped: `py-1` on both and the `px-2` shared between them, so a folder
        row is exactly as tall and as wide as the engram rows under it. The
        hover wash sits on the row rather than on either control, because what
        lights up under the pointer is the row.
      */}
      <div
        className={`flex min-h-8 items-center rounded-[7px] text-sm text-ink-3 hover:bg-sunken ${
          here ? SIDE.current : ""
        }`}
      >
        {/*
          One glyph, doing both jobs. The row used to carry two - a chevron on
          the button and a folder icon on the link beside it - and at this size
          the chevron read as a dot stuck to the folder rather than as a
          control. A folder that is open looks different from a folder that is
          shut, so the icon can carry the state the chevron was carrying and
          the row gets its width back.

          What did NOT change is which control is which: this is still the
          button, it still says what it will do next and still carries
          `aria-expanded`, and the name beside it is still the link that
          browses the folder on the screen. Only the picture inside the button
          is different.
        */}
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${open ? "Collapse" : "Expand"} ${name}`}
          onClick={() => {
            setOpen(!open);
          }}
          className={`self-stretch rounded-[7px] pr-1 pl-2.5 text-muted ${FOCUS_RING}`}
        >
          {open ? (
            <FolderOpen
              aria-hidden="true"
              size={16}
              strokeWidth={1.75}
              className="block shrink-0"
            />
          ) : (
            <FolderShut
              aria-hidden="true"
              size={16}
              strokeWidth={1.75}
              className="block shrink-0"
            />
          )}
        </button>
        <Link
          to={folderRoute(domain, path)}
          aria-current={here ? "page" : undefined}
          // The gap the icon used to sit in, kept as padding: the name still
          // stands off the glyph rather than against it, and the engram rows
          // under it still start where they always did.
          className={`flex min-w-0 grow items-center self-stretch rounded-[7px] pr-2.5 pl-1 ${FOCUS_RING}`}
        >
          <span className="truncate">{name}</span>
          {/* Drawn in the row and not spoken there, so the link's name stays
              the folder's; the words follow beside it. */}
          {count !== null && (
            <span
              aria-hidden="true"
              title={plural(count, "engram", "engrams")}
              className={SIDE.count}
            >
              {count}
            </span>
          )}
        </Link>
        {count !== null && (
          <span className="sr-only">{plural(count, "engram", "engrams")}</span>
        )}
      </div>
      {open && (
        <div className="ml-[17px] border-l border-hair pl-1">
          <TreeBranch
            domain={domain}
            path={path}
            permalink={permalink}
            browsing={browsing}
            marked={marked}
          />
        </div>
      )}
    </>
  );
}

/**
 * One engram in the tree.
 *
 * Named by its title alone, behind a document glyph that is drawn and not
 * spoken: this is navigation, and the row that says what an engram is made
 * of is the list on the screen beside it. A retired one is still there,
 * set apart in a slanted, lighter ink that keeps its contrast.
 */
function EngramLink({ row, current }: { row: EngramRow; current: boolean }) {
  const retired = isRetired(row.status);
  return (
    <Link
      to={engramRoute(row.domain, row.permalink)}
      {...ENGRAM_PREFETCH}
      aria-current={current ? "page" : undefined}
      className={`${SIDE.row} ${current ? SIDE.current : ""} ${
        retired ? SIDE.retired : ""
      }`}
    >
      <FileText
        aria-hidden="true"
        size={16}
        strokeWidth={1.75}
        className={SIDE.icon}
      />
      <span className="truncate">{row.title}</span>
    </Link>
  );
}

/** The path of a subfolder, from the folder it sits in. */
function childPath(path: string, name: string): string {
  return path === "" ? name : `${path}/${name}`;
}
