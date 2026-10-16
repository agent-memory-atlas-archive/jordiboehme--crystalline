/**
 * The right rail of a domain's front page (spec 5.3): what the domain holds
 * and how it is kept, the MANIFEST's configuration sections shown once, the
 * ways into its settings, and what was recorded here lately. Blocks are
 * separated by hairlines, not boxes, the way the engram details rail is.
 *
 * Nothing here asks the server for a value only the rail would show: the
 * settings rows carry a value where the page already read one, and the
 * recent rows come from the activity feed Home reads, under the same key.
 */

import { useQuery } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import {
  DatabaseBackup,
  GitBranch,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { Link } from "react-router";

import { ACTIVITY_QUERY_KEY, fetchActivity } from "../api/activity";
import type { ManifestSections } from "../api/domain";
import type { DomainSummary } from "../api/domains";
import type { MembersResponse } from "../api/model";
import { formatDayLong, formatInstant, plural } from "../format";
import { RETIRED_CLASS, isRetired } from "../lifecycle";
import type { ManifestSection } from "../manifestProse";
import { domainSettingsRoute, engramRoute } from "../paths";
import { ENGRAM_PREFETCH } from "../prefetch";
import { Problems } from "./ManifestStarter";
import { Markdown } from "./Markdown";
import { FOCUS_RING, RAIL_LABEL } from "./primitives";

/** How many recent engrams the rail lists. */
const RECENT_ROWS = 5;

export function DomainRail({
  domain,
  summary,
  pages,
  sections,
  config,
  members,
  showReviewMode,
  showBackup,
}: {
  domain: string;
  summary: DomainSummary | undefined;
  /** The Reflection's page count, or null when it is not known here. */
  pages: number | null;
  sections: ManifestSections | null;
  /** The configuration sections cut out of the prose, as written. */
  config: ManifestSection[];
  members: MembersResponse | undefined;
  /** Whether the review mode card is offered to this caller. */
  showReviewMode: boolean;
  /** Whether the backup card is offered to this caller (admins). */
  showBackup: boolean;
}): ReactElement {
  const declared =
    sections?.policies.filter((row) => row.declared !== null).length ?? null;
  return (
    <aside
      aria-label="About this domain"
      className="flex flex-col divide-y divide-hair text-sm [&>*]:py-[18px] [&>*:first-child]:pt-0"
    >
      <About summary={summary} pages={pages} members={members} />
      {config.map((section) => (
        <ConfigBlock
          key={section.key}
          section={section}
          sections={sections}
          domain={domain}
        />
      ))}
      <section aria-labelledby="rail-settings">
        <h2 id="rail-settings" className={`mb-2 ${RAIL_LABEL}`}>
          Settings
        </h2>
        <ul className="flex flex-col">
          <SettingRow
            to={domainSettingsRoute(domain, "members")}
            icon={Users}
            label="Members"
            value={
              members === undefined
                ? null
                : members.visibility === "private"
                  ? plural(members.members.length, "member", "members")
                  : "everyone"
            }
          />
          {sections !== null && sections.policies.length > 0 && (
            <SettingRow
              to={domainSettingsRoute(domain, "policies")}
              icon={SlidersHorizontal}
              label="Policies"
              value={declared === null ? null : `${String(declared)} set`}
            />
          )}
          {showReviewMode && summary !== undefined && (
            <SettingRow
              to={domainSettingsRoute(domain, "review-mode")}
              icon={GitBranch}
              label="Review mode"
              value={summary.review === null ? "off" : "on"}
            />
          )}
          {showBackup && (
            <SettingRow
              to={domainSettingsRoute(domain, "backup")}
              icon={DatabaseBackup}
              label="Backup and import"
              value={null}
            />
          )}
        </ul>
      </section>
      <Recent domain={domain} />
    </aside>
  );
}

function About({
  summary,
  pages,
  members,
}: {
  summary: DomainSummary | undefined;
  pages: number | null;
  members: MembersResponse | undefined;
}) {
  if (summary === undefined) {
    return null;
  }
  const holds = [
    summary.engrams === null
      ? null
      : plural(summary.engrams, "engram", "engrams"),
    pages === null ? null : plural(pages, "page", "pages"),
  ].filter((part) => part !== null);
  const isPrivate = summary.private || members?.visibility === "private";
  return (
    <section aria-labelledby="rail-about">
      <h2 id="rail-about" className={`mb-2 ${RAIL_LABEL}`}>
        About
      </h2>
      <dl className="flex flex-col">
        {holds.length > 0 && <Row label="Holds">{holds.join(", ")}</Row>}
        <Row label="Access">
          {isPrivate ? "Private to its members" : "Shared with everyone"}
        </Row>
        {summary.kind !== null && (
          <Row label="Stored">
            {summary.kind === "file"
              ? "Files on disk"
              : summary.kind === "virtual"
                ? "In the database"
                : summary.kind}
          </Row>
        )}
        {summary.lastSync !== null && (
          <Row label="Synced">
            <span className="tabular-nums" title={summary.lastSync}>
              {formatInstant(summary.lastSync)}
            </span>
          </Row>
        )}
      </dl>
    </section>
  );
}

/**
 * One configuration section. Provisioning and Tag Aliases are drawn from what
 * the core crate parsed out of them, with any flagged bullet; a section the
 * registry knows and this page has no parsed view of is drawn as written.
 */
function ConfigBlock({
  section,
  sections,
  domain,
}: {
  section: ManifestSection;
  sections: ManifestSections | null;
  domain: string;
}) {
  const id = `rail-${section.key.replace(/\s+/g, "-")}`;
  let body: ReactNode;
  if (section.key === "provisioning" && sections?.provisioning != null) {
    body = (
      <>
        <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 font-mono text-[13px]">
          {sections.provisioning.decls.map((decl) => (
            <div key={decl.kind} className="contents">
              <dt>{decl.kind}</dt>
              <dd className="truncate" title={decl.path}>
                {decl.path}
              </dd>
            </div>
          ))}
        </dl>
        <Problems items={sections.provisioning.problems} />
      </>
    );
  } else if (section.key === "tag aliases" && sections?.tagAliases != null) {
    body = (
      <>
        <ul className="flex flex-col gap-1 font-mono text-[13px]">
          {sections.tagAliases.decls.map((decl) => (
            <li key={decl.alias}>
              {decl.alias}
              <span aria-hidden="true" className="text-muted">
                {" → "}
              </span>
              <span className="sr-only"> folds into </span>
              {decl.canonical}
            </li>
          ))}
        </ul>
        <Problems items={sections.tagAliases.problems} />
      </>
    );
  } else {
    body = (
      <div className="text-[13px]">
        <Markdown source={section.body} domain={domain} />
      </div>
    );
  }
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className={`mb-2 ${RAIL_LABEL}`}>
        {section.heading}
      </h2>
      {body}
    </section>
  );
}

function SettingRow({
  to,
  icon: Icon,
  label,
  value,
}: {
  to: string;
  icon: LucideIcon;
  label: string;
  value: string | null;
}) {
  return (
    <li>
      <Link
        to={to}
        className={`-mx-1.5 flex items-center gap-2 rounded px-1.5 py-1.5 text-ink-2 hover:bg-sunken ${FOCUS_RING}`}
      >
        <Icon
          aria-hidden="true"
          size={15}
          strokeWidth={1.75}
          className="text-muted"
        />
        <span>{label}</span>
        {/* A space, so the link reads "Members everyone", not one word. */}
        {value !== null && " "}
        {value !== null && (
          <span className="ml-auto text-xs text-muted tabular-nums">
            {value}
          </span>
        )}
      </Link>
    </li>
  );
}

/**
 * What was recorded here lately: the activity feed, under the key Home reads
 * it by, kept to this domain. The window is the engine's and is quoted.
 */
function Recent({ domain }: { domain: string }) {
  const activity = useQuery({
    queryKey: ACTIVITY_QUERY_KEY,
    queryFn: fetchActivity,
  });
  if (activity.data === undefined) {
    // Loading or refused: the rail says nothing rather than a second error
    // under a page that has its own.
    return null;
  }
  const rows = activity.data.items
    .filter((item) => item.domain === domain)
    .slice(0, RECENT_ROWS);
  const covered = activity.data.timeframe;
  return (
    <section aria-labelledby="rail-recent">
      <h2 id="rail-recent" className={`mb-2 ${RAIL_LABEL}`}>
        Recently recorded
      </h2>
      {rows.length === 0 ? (
        <p className="text-muted">
          {covered === null
            ? "Nothing recorded here lately."
            : `Nothing recorded here in the last ${covered}.`}
        </p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((item) => (
            <li
              key={item.permalink}
              className={`flex items-baseline gap-3 py-1 ${isRetired(item.status) ? RETIRED_CLASS : ""}`}
            >
              <Link
                to={engramRoute(item.domain, item.permalink)}
                {...ENGRAM_PREFETCH}
                className={`min-w-0 truncate rounded text-link underline decoration-accent-300 underline-offset-[3px] hover:decoration-current dark:decoration-accent-800 ${FOCUS_RING}`}
              >
                {item.title}
              </Link>
              {item.recordedAt !== null && (
                <span
                  className="ml-auto shrink-0 text-xs text-muted tabular-nums"
                  title={item.recordedAt}
                >
                  {formatDayLong(item.recordedAt)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-baseline gap-x-3 py-1">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 text-ink-2">{children}</dd>
    </div>
  );
}
