/**
 * The avatar in the top bar (spec 4.3): a 32px circle with the initial that
 * opens the one menu holding who you are, what only an administrator reaches,
 * Maintenance, the display choices, the shortcut map, the Handbook and Log out.
 *
 * Only the trigger and the menu's frame are in the entry; the body is a lazy
 * part (`AvatarMenuBody.tsx`), fetched when a pointer or the keyboard reaches
 * the trigger and in any case a moment after the page has settled. A part that
 * failed to arrive says so as a menu item a keyboard can reach, and that
 * item's reload is the way back. The same load-once pattern as the domain
 * switcher, which is why the two read alike.
 *
 * The anonymous viewer is a neutral circle with a crossed-out person. Its name
 * is "Viewing anonymously", shown as the tooltip, because browsing without an
 * account changes what the app will let you do.
 *
 * Below the medium breakpoint the open menu is a bottom sheet: the stylesheet
 * (`.avatar-menu` in index.css) moves the same popper to the foot of the window
 * with a scrim, so there is one menu and one set of keys on every width.
 */

import { UserRoundX } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useEffect, useRef, useState } from "react";
import type { ReactElement, RefObject } from "react";

import { useAuth } from "../auth/AuthContext";
import type AvatarMenuBodyType from "./AvatarMenuBody";
import { ITEM_CLASSES } from "./menu";
import { FOCUS_RING, Tooltip } from "./primitives";

let Menu: typeof AvatarMenuBodyType | undefined;
let pending: Promise<void> | undefined;

/** Fetch the menu's body once; a failure is not kept, though a browser may. */
function load(): Promise<void> {
  pending ??= import("./AvatarMenuBody").then(
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

export function AvatarMenu({
  onShortcuts,
}: {
  /** Open the keyboard shortcut map, handing over the place focus returns to. */
  onShortcuts: (opener: HTMLElement | null) => void;
}): ReactElement {
  const { user } = useAuth();
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const timer = setTimeout(preload, 1500);
    return () => {
      clearTimeout(timer);
    };
  }, []);
  const label = user ? user.display : "Viewing anonymously";
  const initial = user ? (Array.from(user.display.trim())[0] ?? "?") : "";

  return (
    <DropdownMenu.Root>
      <Tooltip label={label}>
        <DropdownMenu.Trigger
          ref={triggerRef}
          aria-label={label}
          onPointerEnter={preload}
          onFocus={preload}
          className={`avatar ${user ? "" : "avatar-anon"} ${FOCUS_RING}`}
        >
          {user ? (
            <span aria-hidden="true">{initial.toUpperCase()}</span>
          ) : (
            <UserRoundX aria-hidden="true" size={16} strokeWidth={1.75} />
          )}
        </DropdownMenu.Trigger>
      </Tooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          collisionPadding={8}
          className="avatar-menu"
        >
          <Body triggerRef={triggerRef} onShortcuts={onShortcuts} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/**
 * What the open menu holds. Mounted on every open, so it reads the module as
 * it is then: the body at once when it has arrived, else a loading line until
 * it does, or the reload item when it failed.
 */
function Body({
  triggerRef,
  onShortcuts,
}: {
  triggerRef: RefObject<HTMLButtonElement | null>;
  onShortcuts: (opener: HTMLElement | null) => void;
}): ReactElement {
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(Menu !== undefined);
  // A body that arrives after the menu has opened lands while the focus is on
  // the menu's own container (Radix looked for a first item and found none),
  // so a keyboard that opened the menu would start on nothing. Once it has
  // arrived, the first row takes the focus, unless it has already moved.
  const late = useRef(Menu === undefined);
  useEffect(() => {
    if (!ready || !late.current) {
      return;
    }
    late.current = false;
    const timer = setTimeout(() => {
      const active = document.activeElement;
      if (active?.getAttribute("role") === "menu") {
        active.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
      }
    });
    return () => {
      clearTimeout(timer);
    };
  }, [ready]);
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
    return (
      <Menu
        onShortcuts={() => {
          onShortcuts(triggerRef.current);
        }}
      />
    );
  }
  return failed ? (
    <DropdownMenu.Item
      className={ITEM_CLASSES}
      onSelect={() => {
        location.reload();
      }}
    >
      Could not load the menu. Reload
    </DropdownMenu.Item>
  ) : (
    <p className="px-2.5 py-2 text-muted">Loading menu</p>
  );
}
