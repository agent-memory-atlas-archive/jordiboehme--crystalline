/**
 * A domain's Reflection: where its pages are for people.
 *
 * The page itself is short on purpose. The tree lives in the sidebar, the
 * way the engram tree does, so this screen holds what the tree cannot: the
 * pact the pages are written to, the way to the review screen with the open
 * thread count, search, and - for a contributor, who has no domain page -
 * the way out of the domain.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { useId, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";

import { ApiProblem, problemDetail } from "../api/client";
import { DOMAINS_QUERY_KEY } from "../api/domains";
import { removeMember } from "../api/members";
import type {
  ReflectionSearchMode,
  ReflectionTree,
  TreeNode,
} from "../api/reflection";
import {
  REFLECTION_SEARCH_MODES,
  fetchReflectionTree,
  readReflectionSearchMode,
  reflectionKey,
  reflectionSearchKey,
  reflectionTreeKey,
  saveReflection,
  searchReflections,
} from "../api/reflection";
import {
  PACT_PATH,
  REFLECTION_DOMAINS_KEY,
  atLeast,
} from "../api/reflectionDomains";
import { useAuth } from "../auth/AuthContext";
import {
  DestructiveAction,
  READ_ONLY_REASON,
} from "../components/DestructiveAction";
import {
  ReflectionModeSwitch,
  useReflectionStatus,
} from "../components/ReflectionModeSwitch";
import { ReflectionStateNotice } from "../components/ReflectionStateNotice";
import { BUTTON, FIELD } from "../components/primitives";
import { Skeleton } from "../components/Skeleton";
import { plural } from "../format";
import {
  reflectionEditRoute,
  reflectionPageRoute,
  reflectionReviewRoute,
  reflectionSearchRoute,
} from "../paths";
import { stripIdLines } from "../reflectionText";

/** The refusal face, the one `DomainPoliciesCard` announces a problem in. */
const ALERT =
  "rounded bg-red-50 px-2 py-1 text-sm text-red-800 dark:bg-red-950 dark:text-red-200";

const LINK =
  "text-sky-700 underline underline-offset-2 hover:no-underline dark:text-sky-400";

/** Every open thread in the tree, pact included. */
function openThreads(tree: ReflectionTree): number {
  const walk = (nodes: TreeNode[]): number =>
    nodes.reduce(
      (sum, node) =>
        sum + (node.kind === "folder" ? walk(node.children) : node.openThreads),
      0,
    );
  return tree.pact.openThreads + walk(tree.nodes);
}

export default function ReflectionHome(): ReactElement {
  const { domain = "" } = useParams();
  const status = useReflectionStatus(domain);
  if (status.isPending) {
    return <Skeleton label="Loading the Reflection" rows={4} />;
  }
  if (status.error) {
    // Only a 404 is a wrong address; any other failure is the server's own
    // words, never dressed up as a missing domain.
    return (
      <div className="flex flex-col items-start gap-3">
        <h1 className="text-display">
          {isMissing(status.error) ? "Domain not found" : domain}
        </h1>
        {isMissing(status.error) ? (
          <p className="text-sm">{problemDetail(status.error)}</p>
        ) : (
          <p role="alert" className={ALERT}>
            {problemDetail(status.error)}
          </p>
        )}
      </div>
    );
  }
  const s = status.data;
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-display">{domain}</h1>
            <p className="text-caption text-slate-500 dark:text-slate-400">
              Reflection
            </p>
          </div>
          <ReflectionModeSwitch domain={domain} current="reflection" />
        </div>
        <ReflectionStateNotice status={s} />
      </header>
      {s.state === "on" && (
        <OnHome domain={domain} mayWritePact={atLeast(s.right, "curate")} />
      )}
      {/* In every state, not only while it is on: a member must be able to
          leave a domain whose Reflection is pending or paused too. */}
      {s.member && !s.engramsVisible && <LeaveDomain domain={domain} />}
    </div>
  );
}

function OnHome({
  domain,
  mayWritePact,
}: {
  domain: string;
  mayWritePact: boolean;
}): ReactElement {
  const tree = useQuery({
    queryKey: reflectionTreeKey(domain),
    queryFn: () => fetchReflectionTree(domain),
  });
  return (
    <>
      {tree.error && (
        <p role="alert" className={ALERT}>
          {problemDetail(tree.error)}
        </p>
      )}
      {tree.data && (
        <section
          aria-labelledby="reflection-pact"
          className="flex flex-col gap-2"
        >
          <h2 id="reflection-pact" className="text-section">
            How this domain is written
          </h2>
          <p className="text-sm">
            {tree.data.pact.exists ? (
              <Link
                to={reflectionPageRoute(domain, tree.data.pact.path)}
                className={LINK}
              >
                {tree.data.pact.title}
              </Link>
            ) : mayWritePact ? (
              <WritePact domain={domain} />
            ) : (
              "No pact is written yet."
            )}
          </p>
          <p className="text-sm">
            <Link to={reflectionReviewRoute(domain)} className={LINK}>
              {plural(openThreads(tree.data), "open thread", "open threads")}
            </Link>
          </p>
        </section>
      )}
      <SearchSection domain={domain} />
    </>
  );
}

/**
 * PACT.md does not exist yet: create it with a heading and open it in the
 * editor. A create never overwrites, so a pact written meanwhile by somebody
 * else is refused in the server's words.
 */
function WritePact({ domain }: { domain: string }): ReactElement {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const write = useMutation({
    mutationFn: () =>
      saveReflection(domain, PACT_PATH, `# How we write about ${domain}\n`, {
        create: true,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: reflectionKey(domain) });
      void navigate(reflectionEditRoute(domain, PACT_PATH));
    },
  });
  return (
    <>
      <button
        type="button"
        disabled={write.isPending}
        onClick={() => {
          write.mutate();
        }}
        className={BUTTON.secondary}
      >
        Write the pact
      </button>
      {write.error && (
        <span role="alert" className="ml-2 text-red-800 dark:text-red-200">
          {problemDetail(write.error)}
        </span>
      )}
    </>
  );
}

/**
 * What ran, in the engram search's manner (`Search.tsx`'s status line): the
 * mode that ran is what explains an answer, and a fallback says why.
 */
function searchStatus(
  ran: ReflectionSearchMode | null,
  asked: ReflectionSearchMode,
  total: number,
): string | null {
  if (ran === null) {
    return null;
  }
  if (ran !== asked) {
    return `Asked for ${asked}, ran as ${ran}: the pages are not embedded yet.`;
  }
  return `${plural(total, "hit", "hits")}, ranked by ${ran}.`;
}

function SearchSection({ domain }: { domain: string }): ReactElement {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  // The query, the mode and the page live in the address, so a result page
  // is a link somebody can send (as on the engram search screen).
  const asked = params.get("q") ?? "";
  const mode = readReflectionSearchMode(params.get("search_type"));
  const page = Math.max(1, Number(params.get("page") ?? "1") || 1);
  const [draft, setDraft] = useState(asked);
  const [picked, setPicked] = useState<ReflectionSearchMode>(mode);
  // The field and the select follow the address when it changes under them
  // (back, forward, a link to this screen), adjusted while rendering rather
  // than in an effect so no frame shows the old words.
  const [shown, setShown] = useState({ asked, mode });
  if (shown.asked !== asked || shown.mode !== mode) {
    setShown({ asked, mode });
    setDraft(asked);
    setPicked(mode);
  }
  const fieldId = useId();
  const modeId = useId();
  const search = useQuery({
    queryKey: reflectionSearchKey(domain, asked, mode, page),
    queryFn: () => searchReflections(domain, { query: asked, mode, page }),
    enabled: asked.trim() !== "",
  });
  const go = (
    query: string,
    nextMode: ReflectionSearchMode,
    nextPage: number,
  ) => {
    void navigate(reflectionSearchRoute(domain, query, nextMode, nextPage));
  };
  const answer = search.data;
  const hits = answer?.hits;
  const lastPage = answer
    ? Math.max(1, Math.ceil(answer.total / Math.max(answer.limit, 1)))
    : 1;
  // An empty page says one thing: a count beside "No page matches." would
  // contradict it on a page past the last one.
  const status =
    hits !== undefined && hits.length > 0 && answer
      ? searchStatus(answer.mode, mode, answer.total)
      : null;
  return (
    <section
      aria-labelledby="reflection-search"
      className="flex flex-col gap-3"
    >
      <h2 id="reflection-search" className="text-section">
        Search
      </h2>
      <form
        role="search"
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.trim() !== "") {
            go(draft.trim(), picked, 1);
          }
        }}
      >
        <label htmlFor={fieldId} className="sr-only">
          Search the Reflection
        </label>
        <input
          id={fieldId}
          type="search"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          className={`w-64 ${FIELD}`}
        />
        <label
          htmlFor={modeId}
          className="flex flex-col gap-1 text-xs text-slate-500 dark:text-slate-400"
        >
          Mode
          <select
            id={modeId}
            value={picked}
            onChange={(event) => {
              const next = readReflectionSearchMode(event.target.value);
              setPicked(next);
              if (asked.trim() !== "") {
                go(asked, next, 1);
              }
            }}
            className={FIELD}
          >
            {REFLECTION_SEARCH_MODES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={BUTTON.secondary}>
          Search
        </button>
      </form>
      {search.error && (
        <p className="text-sm text-red-800 dark:text-red-200">
          {problemDetail(search.error)}
        </p>
      )}
      {status !== null && (
        <p className="text-caption text-slate-600 dark:text-slate-300">
          {status}
        </p>
      )}
      {hits?.length === 0 && (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          No page matches.
        </p>
      )}
      {hits && hits.length > 0 && (
        <ul className="flex flex-col gap-3">
          {hits.map((hit, index) => (
            // The rank keeps two hits apart that share a path and have no
            // section id yet; the list is redrawn whole on every answer.
            <li key={`${String(index)}:${hit.path}#${hit.section ?? ""}`}>
              <Link
                to={`${reflectionPageRoute(domain, hit.path)}${hit.section !== null ? `#s-${hit.section}` : ""}`}
                className={LINK}
              >
                {hit.heading !== ""
                  ? `${hit.title}: ${hit.heading}`
                  : hit.title}
              </Link>
              <p className="text-caption text-slate-600 dark:text-slate-300">
                {stripIdLines(hit.snippet)}
              </p>
            </li>
          ))}
        </ul>
      )}
      {answer && (lastPage > 1 || page > 1) && (
        <div className="flex gap-2">
          {page > 1 && (
            <button
              type="button"
              onClick={() => {
                // From past the end, back to the last page there is.
                go(asked, mode, Math.min(page - 1, lastPage));
              }}
              className={BUTTON.secondary}
            >
              Previous page
            </button>
          )}
          {page < lastPage && (
            <button
              type="button"
              onClick={() => {
                go(asked, mode, page + 1);
              }}
              className={BUTTON.secondary}
            >
              Next page
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * The way out for a member with knowledge `none`. It has no domain page (it
 * reads no engram), so the members card is out of reach. Drawn only when the
 * status says `member` (G5): knowledge `none` set on the instance for every
 * shared domain holds no membership to leave. The leave call is the members
 * route's own, gated on membership by core Task 17.
 */
function LeaveDomain({ domain }: { domain: string }): ReactElement {
  const { user, capabilities } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const leave = useMutation({
    mutationFn: () => removeMember(domain, user?.name ?? ""),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: REFLECTION_DOMAINS_KEY });
      void queryClient.invalidateQueries({ queryKey: DOMAINS_QUERY_KEY });
      void navigate("/");
    },
  });
  return (
    <section
      aria-labelledby="reflection-leave"
      className="flex flex-col items-start gap-2"
    >
      <h2 id="reflection-leave" className="text-section">
        Membership
      </h2>
      <DestructiveAction
        label="Leave this domain"
        confirmLabel="Confirm leave"
        pending={leave.isPending}
        disabledReason={capabilities.readOnly ? READ_ONLY_REASON : undefined}
        onConfirm={() => {
          leave.mutate();
        }}
      />
      {leave.error && (
        <p role="alert" className="text-sm text-red-800 dark:text-red-200">
          {problemDetail(leave.error)}
        </p>
      )}
    </section>
  );
}

/** Whether this failure is the server saying there is nothing at that address. */
function isMissing(error: unknown): boolean {
  return error instanceof ApiProblem && error.status === 404;
}
