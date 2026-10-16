/**
 * The domain switcher in the top bar (spec 4.1): a button with the current
 * domain's name, "All domains" outside a domain, that opens every domain by
 * name with what each holds.
 *
 * Only the trigger and the menu's frame are in the entry; what the menu holds
 * is a lazy part (`DomainSwitcherMenu.tsx`), fetched when a pointer or the
 * keyboard reaches the trigger, so it is usually there before the click.
 */

import { ChevronsUpDown } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import type { ReactElement } from "react";

import { lazyChunk } from "../lazyChunk";
import { LazyBoundary } from "./LazyBoundary";
import { FOCUS_RING } from "./primitives";

const load = () => import("./DomainSwitcherMenu");
const DomainSwitcherMenu = lazyChunk(load);

export function DomainSwitcher({
  domain,
  onCreateDomain,
}: {
  /** The domain the route is inside, or "" outside every domain. */
  domain: string;
  /** Register a domain, or null for a session that may not. */
  onCreateDomain: (() => void) | null;
}): ReactElement {
  const name = domain === "" ? "All domains" : domain;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={`${name}, switch domain`}
        onPointerEnter={() => void load()}
        onFocus={() => void load()}
        className={`inline-flex h-8 min-w-0 shrink items-center gap-1.5 rounded-lg pr-2 pl-2.5 text-sm font-medium text-ink hover:bg-sunken data-[state=open]:bg-sunken ${FOCUS_RING}`}
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
          className="z-50 w-80 max-w-[calc(100vw-1rem)] rounded-xl border border-hair bg-raised p-1.5 text-[13.5px] shadow-pop"
        >
          <LazyBoundary
            fallback={<p className="px-2.5 py-2 text-muted">Loading domains</p>}
          >
            <DomainSwitcherMenu
              domain={domain}
              onCreateDomain={onCreateDomain}
            />
          </LazyBoundary>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
