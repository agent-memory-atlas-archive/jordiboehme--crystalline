/**
 * Review: what a domain's Reflection is waiting on.
 *
 * Open threads first, because those are people waiting: split into the ones
 * waiting for people (an agent spoke last) and the ones waiting for the
 * agent (a person spoke last), each grouped by page and oldest first with
 * its age, in the server's own order. Below them, the reflect queue an agent
 * works through (`reflect`), read-only in the way Maintenance shows the
 * evolve queue: a person reads here what is owed, and follows a row to the
 * page or the engram to do it. The queue's review rows are the threads
 * above, so they are not drawn twice.
 *
 * Nothing here writes, so the thread cards carry no Answer or Resolve. The
 * screen draws the server's `anchor.state` as it is: it has no section text
 * to judge an anchor against.
 */

import { useQuery } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { Link, useParams } from "react-router";

import { problemDetail } from "../api/client";
import type { QueueItem, ReviewGroup } from "../api/reflection";
import {
  fetchReview,
  reflectionAssetUrl,
  reflectionReviewKey,
} from "../api/reflection";
import {
  ReflectionModeSwitch,
  useReflectionStatus,
} from "../components/ReflectionModeSwitch";
import { ReflectionStateNotice } from "../components/ReflectionStateNotice";
import { ThreadCard, sourceChip } from "../components/ReflectionThreads";
import { Skeleton } from "../components/Skeleton";
import { Chip } from "../components/primitives";
import { plural } from "../format";
import { engramRoute, reflectionPageRoute } from "../paths";
import { ageText, stripIdLines } from "../reflectionText";

const LINK =
  "text-link underline decoration-(--link-line) decoration-1 underline-offset-[3px] hover:no-underline";
const MUTED = "text-sm text-slate-500 dark:text-slate-400";

export default function ReflectionReview(): ReactElement {
  const { domain = "" } = useParams();
  const status = useReflectionStatus(domain);
  const review = useQuery({
    queryKey: reflectionReviewKey(domain),
    queryFn: () => fetchReview(domain),
    enabled: status.data?.state === "on",
  });
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-display">Review</h1>
          <p className="text-caption text-slate-500 dark:text-slate-400">
            {`${domain}, Reflection`}
          </p>
        </div>
        <ReflectionModeSwitch domain={domain} current="reflection" />
      </header>
      {status.data && <ReflectionStateNotice status={status.data} />}
      {(status.isPending ||
        (status.data?.state === "on" && review.isPending)) && (
        <Skeleton label="Loading the review" rows={5} />
      )}
      {review.error && (
        <p
          role="alert"
          className="rounded bg-red-50 px-2 py-1 text-sm text-red-800 dark:bg-red-950 dark:text-red-200"
        >
          {problemDetail(review.error)}
        </p>
      )}
      {review.data && (
        <>
          <section
            aria-labelledby="review-threads"
            className="flex flex-col gap-4"
          >
            <h2 id="review-threads" className="text-section">
              Open threads
            </h2>
            <Waiting
              domain={domain}
              id="review-people"
              title="Waiting for people"
              groups={review.data.waitingForPeople}
            />
            <Waiting
              domain={domain}
              id="review-agent"
              title="Waiting for the agent"
              groups={review.data.waitingForTheAgent}
            />
          </section>
          <section
            aria-labelledby="review-queue"
            className="flex flex-col gap-3"
          >
            <h2 id="review-queue" className="text-section">
              Reflect queue
            </h2>
            <Queue
              domain={domain}
              items={review.data.queue.items}
              engramsVisible={status.data?.engramsVisible === true}
              total={review.data.queue.total}
            />
          </section>
        </>
      )}
    </div>
  );
}

function Waiting({
  domain,
  id,
  title,
  groups,
}: {
  domain: string;
  id: string;
  title: string;
  groups: ReviewGroup[];
}): ReactElement {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h3 id={id} className="font-semibold">
        {title}
      </h3>
      {groups.length === 0 && <p className={MUTED}>Nobody is waiting.</p>}
      {groups.map((group) => (
        <div key={group.path} className="flex flex-col gap-2">
          <Link
            to={reflectionPageRoute(domain, group.path)}
            className={`text-sm ${LINK}`}
          >
            {group.title}
          </Link>
          {group.threads.map((thread) => (
            <ThreadCard
              key={thread.id}
              thread={thread}
              heading={null}
              state={thread.anchor.state}
              actions={
                <p className="text-caption text-slate-500 dark:text-slate-400">
                  <Link
                    to={`${reflectionPageRoute(domain, group.path)}#${thread.id}`}
                    className={LINK}
                  >
                    {`waiting ${ageText(thread.ageSecs)}`}
                  </Link>
                </p>
              }
            />
          ))}
        </div>
      ))}
    </section>
  );
}

/**
 * The reflect queue, feedback and update rows only. An item with no path
 * (`asset_unreferenced`, `host_moved`) has no page, so it draws no page link.
 * `QueueDetail` draws the file fields of those items.
 */
function Queue({
  domain,
  items,
  total,
  engramsVisible,
}: {
  domain: string;
  items: QueueItem[];
  /** Source engrams are named only to a reader who may see engrams. */
  engramsVisible: boolean;
  total: number;
}): ReactElement {
  const shown = items.filter((item) => item.kind !== "review");
  // What the page left out, whatever its kind: the review rows it carried
  // count as carried.
  const more = total - items.length;
  return (
    <>
      {shown.length === 0 && <p className={MUTED}>The queue is empty.</p>}
      <ul aria-label="Queue items" className="flex flex-col gap-2">
        {shown.map((item) => (
          <li
            key={item.n}
            className="rounded border border-slate-200 px-3 py-2 text-sm dark:border-slate-800"
          >
            <div className="flex flex-wrap items-baseline gap-2">
              <Chip variant={item.kind === "feedback" ? "accent" : "neutral"}>
                {item.kind}
              </Chip>
              <Chip mono>{item.what}</Chip>
              {item.path !== "" && (
                <Link
                  to={`${reflectionPageRoute(domain, item.path)}${item.section !== null ? `#s-${item.section}` : ""}`}
                  className={LINK}
                >
                  {item.heading !== null && item.heading !== ""
                    ? `${item.path}: ${item.heading}`
                    : item.path}
                </Link>
              )}
              <span className="text-caption text-slate-500 dark:text-slate-400">
                {ageText(item.ageSecs)}
              </span>
            </div>
            {item.changedBy.length > 0 && (
              <p className="text-caption mt-1 text-slate-500 dark:text-slate-400">
                {`changed by ${item.changedBy.join(", ")}`}
              </p>
            )}
            {item.structure.length > 0 && (
              <p className="text-caption mt-1 text-slate-500 dark:text-slate-400">
                {`outside ${item.structure.join(", ")}`}
              </p>
            )}
            {item.count !== null && item.what === "unreflected" && (
              <p className="mt-1">{`${String(item.count)} engrams${item.folder !== null ? ` under ${item.folder}` : ""} have no page yet.`}</p>
            )}
            <QueueDetail
              domain={domain}
              item={item}
              engramsVisible={engramsVisible}
            />
            {item.diff !== null && (
              <pre className="mt-1 overflow-x-auto font-mono text-xs whitespace-pre-wrap text-slate-600 dark:text-slate-300">
                {stripIdLines(item.diff, true)}
              </pre>
            )}
            {engramsVisible &&
              item.sources !== null &&
              item.sources.length > 0 && (
                <ul className="mt-1 flex flex-col gap-1">
                  {item.sources.map((source) => (
                    <li
                      key={source.permalink}
                      className="flex items-center gap-2"
                    >
                      <Link
                        to={engramRoute(domain, source.permalink)}
                        className={LINK}
                      >
                        {source.title}
                      </Link>
                      {sourceChip(source.state)}
                    </li>
                  ))}
                </ul>
              )}
          </li>
        ))}
      </ul>
      {more > 0 && (
        <p className={MUTED}>{`${String(more)} more in the queue`}</p>
      )}
    </>
  );
}

/** `a, b and c` for a list of two or more, the single word for one. */
function joinWords(parts: string[]): string {
  return parts.length < 2
    ? (parts[0] ?? "")
    : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1] ?? ""}`;
}

/**
 * The file fields of an item. Missing files are gone, so plain text; engram
 * attachment targets name engram files, so they are plain text too and only
 * for a reader who may see engrams; an unreferenced file opens in a new tab.
 */
function QueueDetail({
  domain,
  item,
  engramsVisible,
}: {
  domain: string;
  item: QueueItem;
  engramsVisible: boolean;
}): ReactElement | null {
  const names = (list: string[], label: string) =>
    list.length > 0 && (
      <ul aria-label={label} className="mt-1 flex flex-col gap-0.5">
        {list.map((name) => (
          <li key={name} className="font-mono text-xs break-all">
            {name}
          </li>
        ))}
      </ul>
    );
  const moved = item.onlyElsewhere;
  const counts =
    moved === null
      ? []
      : [
          moved.engrams > 0 && plural(moved.engrams, "engram", "engrams"),
          moved.attachments > 0 &&
            plural(moved.attachments, "attachment", "attachments"),
          moved.pages > 0 && plural(moved.pages, "page", "pages"),
          moved.files > 0 && plural(moved.files, "file", "files"),
        ].filter((part): part is string => part !== false);
  return (
    <>
      {names(item.assets ?? [], "Missing files")}
      {engramsVisible && names(item.targets ?? [], "Engram attachments")}
      {item.asset !== null && (
        <p className="mt-1">
          <a
            href={reflectionAssetUrl(domain, item.asset)}
            target="_blank"
            rel="noreferrer"
            className={LINK}
          >
            {item.asset}
          </a>
        </p>
      )}
      {moved !== null && (
        <>
          <p className="mt-1">
            {counts.length === 0
              ? "This instance took over the domain."
              : `This instance took over the domain. Only on ${moved.previousHost ?? "the previous instance"}: ${joinWords(counts)}.`}
          </p>
          <p className="mt-1">
            {`Copy the domain folder over and sync. If the files are gone for good, run crystalline sync --domain ${domain} --accept-disk.`}
          </p>
        </>
      )}
    </>
  );
}
