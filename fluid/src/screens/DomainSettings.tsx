/**
 * A domain's settings, off its front page (spec Q1 A): who may reach it,
 * which way a write goes, the MANIFEST's switches, the configuration
 * sections with the way to start one, the archive round trip and the danger
 * zone. The front page keeps the MANIFEST as the page; these are settled once
 * and read rarely.
 *
 * This is the stub task 9 adds so nothing is lost when the cards leave the
 * front page: every card is the one the front page drew, under the same
 * gates. Task 10 designs the screen.
 */

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";

import {
  archiveDownloadUrl,
  fetchSyncStatus,
  syncStatusKey,
} from "../api/admin";
import { problemDetail } from "../api/client";
import { fetchManifest, manifestKey, treeQuery } from "../api/domain";
import type { ManifestSections } from "../api/domain";
import { useAuth } from "../auth/AuthContext";
import { navigateTo } from "../base";
import { NO_COMMANDS, useRegisterCommands } from "../commands";
import type { PaletteCommand } from "../commands";
import { BackupCard } from "../components/BackupCard";
import { DangerZoneCard } from "../components/DangerZoneCard";
import { DomainPoliciesCard } from "../components/DomainPoliciesCard";
import { ImportArchiveDialog } from "../components/ImportArchiveDialog";
import {
  EmptySection,
  Problems,
  starterFor,
} from "../components/ManifestStarter";
import { MembersCard } from "../components/MembersCard";
import { RenameDomainDialog } from "../components/RenameDomainDialog";
import { ReviewModeCard } from "../components/ReviewModeCard";
import { Skeleton } from "../components/Skeleton";
import { CHROME_LINK } from "../components/primitives";
import { useDomainWritable } from "../domainWritable";
import { isMissing, useDomainRights } from "../domainRights";
import { domainRoute, manifestEditRoute } from "../paths";
import { MissingOrReflection } from "./DomainMissing";

export default function DomainSettings() {
  const { domain = "" } = useParams();
  // The tree says whether the domain exists for this caller at all, the way
  // the front page asks: a 404 is a wrong address or a Reflection-only
  // reader, and both are answered as the front page answers them.
  const tree = useQuery(treeQuery(domain, ""));
  if (isMissing(tree.error)) {
    return <MissingOrReflection domain={domain} />;
  }
  // The tree read is one of the answers the screen waits for, so an
  // unknown domain never flashes its cards before the 404 lands.
  return (
    <Settings key={domain} domain={domain} treeAnswered={!tree.isPending} />
  );
}

function Settings({
  domain,
  treeAnswered,
}: {
  domain: string;
  treeAnswered: boolean;
}) {
  const { capabilities } = useAuth();
  const { canWrite } = useDomainWritable(domain);
  const navigate = useNavigate();
  const location = useLocation();
  const { summary, listing, members, own, isRenaming } =
    useDomainRights(domain);
  // The front page's palette row "Unregister domain" lands here armed: the
  // question is asked by the card that owns it, never skipped. The arming is
  // taken once and cleared from the history entry, so a reload or a step
  // back and forth does not ask again.
  const [confirmingUnregister, setConfirmingUnregister] = useState(
    (location.state as { unregister?: boolean } | null)?.unregister === true,
  );
  const armedOnArrival = useRef(confirmingUnregister);
  useEffect(() => {
    if (armedOnArrival.current) {
      armedOnArrival.current = false;
      void navigate(
        { pathname: location.pathname, hash: location.hash },
        { replace: true, state: null },
      );
    }
  }, [location.hash, location.pathname, navigate]);
  const [importing, setImporting] = useState(false);
  const [renamingOpen, setRenamingOpen] = useState(false);
  const manifest = useQuery({
    queryKey: manifestKey(domain),
    queryFn: () => fetchManifest(domain),
  });
  // The branch a direct share would commit onto, for the policies card; the
  // same read the sync banner makes, under the same gate.
  const syncStatus = useQuery({
    queryKey: syncStatusKey(domain),
    queryFn: () => fetchSyncStatus(domain),
    retry: false,
    enabled: capabilities.canShare,
  });
  const sections = manifest.data?.sections ?? null;
  const manifestEditable =
    manifest.data !== undefined || isMissing(manifest.error);
  const onStart =
    capabilities.canAdminister && canWrite && manifestEditable && !isRenaming
      ? (section: string) => {
          void navigate(manifestEditRoute(domain), {
            state: { seedSection: section },
          });
        }
      : null;

  // Everything a block on this screen waits for has answered, one way or
  // the other: a refused members read is an answer too. Latched, because a
  // card mounting below asks a refused read again, and the screen must not
  // fold back into its loading state (and unmount that card) while it does.
  const answered =
    treeAnswered &&
    !listing.isPending &&
    !members.isPending &&
    !manifest.isPending &&
    !(capabilities.canShare && syncStatus.isPending);
  const [settled, setSettled] = useState(answered);
  if (answered && !settled) {
    setSettled(true);
  }
  // A link from the front page's rail opens at its block, once the screen
  // has settled: every block is drawn in the same commit, so the target is
  // there then, or the reader may not see it at all.
  const hash = location.hash;
  useEffect(() => {
    if (hash === "" || !settled) {
      return;
    }
    document.getElementById(hash.slice(1))?.scrollIntoView?.({
      block: "start",
    });
  }, [hash, settled]);

  const commands = useMemo<readonly PaletteCommand[]>(() => {
    const rows: PaletteCommand[] = [];
    if (capabilities.canAdminister) {
      rows.push({
        id: "download-archive",
        title: "Download archive",
        run: () => {
          navigateTo(archiveDownloadUrl(domain));
        },
      });
      if (canWrite && !isRenaming) {
        rows.push({
          id: "import-archive",
          title: "Import archive",
          run: () => {
            setImporting(true);
          },
        });
      }
    }
    if (own && !isRenaming) {
      rows.push({
        id: "unregister-domain",
        title: "Unregister domain",
        run: () => {
          setConfirmingUnregister(true);
        },
      });
    }
    return rows.length === 0 ? NO_COMMANDS : rows;
  }, [capabilities.canAdminister, canWrite, domain, isRenaming, own]);
  useRegisterCommands(commands);

  const header = (
    <header>
      <Link to={domainRoute(domain)} className={`text-sm ${CHROME_LINK}`}>
        {domain}
      </Link>
      <h1 className="text-display">Domain settings</h1>
    </header>
  );
  if (!settled) {
    return (
      <div className="flex max-w-[720px] flex-col gap-8">
        {header}
        <Skeleton label="Loading the settings" rows={6} />
      </div>
    );
  }

  return (
    <div className="flex max-w-[720px] flex-col gap-8">
      {header}

      {members.data !== undefined && (
        <div id="members" className="scroll-mt-20">
          <MembersCard domain={domain} />
        </div>
      )}

      {capabilities.canShare && summary !== undefined && (
        <div id="review-mode" className="scroll-mt-20">
          <ReviewModeCard domain={domain} reviewing={summary.review !== null} />
        </div>
      )}

      {sections !== null && sections.policies.length > 0 && (
        <div id="policies" className="scroll-mt-20">
          <DomainPoliciesCard
            domain={domain}
            policies={sections.policies}
            branch={syncStatus.data?.branch ?? null}
            onRename={() => {
              setRenamingOpen(true);
            }}
            renaming={isRenaming}
          />
        </div>
      )}

      {/*
        A refused MANIFEST read, said the way the front page says it, so the
        missing policies and sections below are not read as "none declared".
      */}
      {manifest.error !== null && !isMissing(manifest.error) && (
        <p
          role="alert"
          className="rounded bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200"
        >
          {problemDetail(manifest.error)}
        </p>
      )}
      {sections !== null && (
        <ConfigSections sections={sections} onStart={onStart} />
      )}

      {capabilities.canAdminister && (
        <div id="backup" className="scroll-mt-20">
          <BackupCard
            domain={domain}
            onImport={() => {
              setImporting(true);
            }}
            canImport={canWrite}
            renaming={isRenaming}
          />
        </div>
      )}

      <div id="danger-zone" className="scroll-mt-20">
        <DangerZoneCard
          domain={domain}
          kind={summary?.kind ?? null}
          confirming={confirmingUnregister}
          onConfirmingChange={setConfirmingUnregister}
          renaming={isRenaming}
        />
      </div>

      {importing && (
        <ImportArchiveDialog
          domain={domain}
          onClose={() => {
            setImporting(false);
          }}
        />
      )}
      {renamingOpen && (
        <RenameDomainDialog
          domain={domain}
          onClose={() => {
            setRenamingOpen(false);
          }}
        />
      )}
    </div>
  );
}

/**
 * The MANIFEST's configuration sections, as the core crate reads them, with
 * the way to start one that is not declared. Read-only on purpose: the
 * document is the source and the editor is where a change goes.
 */
function ConfigSections({
  sections,
  onStart,
}: {
  sections: ManifestSections;
  onStart: ((section: string) => void) | null;
}) {
  return (
    <div
      id="manifest-sections"
      className="grid scroll-mt-20 gap-4 sm:grid-cols-2"
    >
      <Facet title="Provisioning">
        {sections.provisioning === null ||
        sections.provisioning.decls.length === 0 ? (
          <EmptySection
            starter={starterFor(sections, "Provisioning")}
            fallback="Nothing declared"
            onStart={onStart}
          />
        ) : (
          <ul className="flex flex-col gap-1">
            {sections.provisioning.decls.map((decl) => (
              <li key={decl.kind} className="font-mono">
                {`${decl.kind}: ${decl.path}`}
              </li>
            ))}
          </ul>
        )}
        {sections.provisioning !== null && (
          <Problems items={sections.provisioning.problems} />
        )}
      </Facet>
      <Facet title="Tag aliases">
        {sections.tagAliases === null ||
        sections.tagAliases.decls.length === 0 ? (
          <EmptySection
            starter={starterFor(sections, "Tag Aliases")}
            fallback="No aliases"
            onStart={onStart}
          />
        ) : (
          <ul className="flex flex-col gap-1">
            {sections.tagAliases.decls.map((decl) => (
              <li key={decl.alias} className="font-mono">
                {`${decl.alias} -> ${decl.canonical}`}
              </li>
            ))}
          </ul>
        )}
        {sections.tagAliases !== null && (
          <Problems items={sections.tagAliases.problems} />
        )}
      </Facet>
    </div>
  );
}

/** One panel: a labelled region, so each is reachable by its name. */
function Facet({ title, children }: { title: string; children: ReactNode }) {
  const id = `manifest-facet-${title.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <section
      aria-labelledby={id}
      className="rounded border border-slate-200 p-3 text-sm dark:border-slate-800"
    >
      <h2 id={id} className="mb-2 font-medium">
        {title}
      </h2>
      {children}
    </section>
  );
}
