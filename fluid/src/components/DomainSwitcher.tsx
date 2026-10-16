/**
 * The domain switcher in the top bar (spec 4.1): a button with the current
 * domain's name, "All domains" outside a domain, that opens every domain by
 * name with what each holds.
 *
 * Only the trigger and the menu's frame are in the entry; what the menu holds
 * is a lazy part (`DomainSwitcherMenu.tsx`), fetched when a pointer or the
 * keyboard reaches the trigger, and in any case a moment after the page has
 * settled. It is kept here once it has arrived, so every
 * open after that draws the list at once instead of a loading line first. A
 * part that failed to arrive says so as a menu item a keyboard can reach,
 * and that item's reload is the way back: browsers keep a failed dynamic
 * import failed, so asking again on the next open does not help.
 */

import { ChevronsUpDown } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useEffect, useState } from "react";
import type { ReactElement } from "react";

import type DomainSwitcherMenuType from "./DomainSwitcherMenu";
import { ITEM_CLASSES } from "./menu";
import { Loading } from "./Loading";
import { FOCUS_RING } from "./primitives";

let Menu: typeof DomainSwitcherMenuType | undefined;
let pending: Promise<void> | undefined;

/** Fetch the menu's body once; a failure is not kept, though a browser may. */
function load(): Promise<void> {
  pending ??= import("./DomainSwitcherMenu").then(
    (module) => {
      Menu = module.default;
    },
    (cause: unknown) => {
      pending = undefined;
      throw cause;
    },
  );
  return pending;
}

/** Fetch ahead of a click, quietly: the open says so if it failed. */
function preload(): void {
  load().catch(() => undefined);
}

export function DomainSwitcher({
  domain,
  onCreateDomain,
}: {
  /** The domain the route is inside, or "" outside every domain. */
  domain: string;
  /** Register a domain, or null for a session that may not. */
  onCreateDomain: (() => void) | null;
}): ReactElement {
  // Fetched once the page has settled as well, so even the first open draws
  // the list at once rather than a loading line that then grows.
  useEffect(() => {
    const timer = setTimeout(preload, 1500);
    return () => {
      clearTimeout(timer);
    };
  }, []);
  const name = domain === "" ? "All domains" : domain;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={`${name}, switch domain`}
        onPointerEnter={preload}
        onFocus={preload}
        className={`switcher-trigger ${FOCUS_RING}`}
      >
        <span className="truncate">{name}</span>
        <ChevronsUpDown
          aria-hidden="true"
          size={14}
          strokeWidth={1.75}
          className="shrink-0 text-faint"
        />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className="switcher-menu"
        >
          <Body domain={domain} onCreateDomain={onCreateDomain} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/**
 * What the open menu holds. Mounted on every open, so it reads the module
 * as it is then: the list at once when it has arrived, else a loading line
 * until it does, or the reload item when it failed.
 */
function Body({
  domain,
  onCreateDomain,
}: {
  domain: string;
  onCreateDomain: (() => void) | null;
}): ReactElement {
  const [failed, setFailed] = useState(false);
  const [, setReady] = useState(false);
  useEffect(() => {
    if (Menu === undefined) {
      load().then(
        () => {
          setReady(true);
        },
        () => {
          setFailed(true);
        },
      );
    }
  }, []);
  if (Menu !== undefined) {
    return <Menu domain={domain} onCreateDomain={onCreateDomain} />;
  }
  return failed ? (
    <DropdownMenu.Item
      className={ITEM_CLASSES}
      onSelect={() => {
        location.reload();
      }}
    >
      Could not load the domains. Reload
    </DropdownMenu.Item>
  ) : (
    <Loading compact label="Loading domains" className="px-2.5 py-2" />
  );
}
