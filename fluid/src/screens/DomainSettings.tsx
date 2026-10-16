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
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";

import {
  archiveDownloadUrl,
  fetchSyncStatus,
  syncStatusKey,
} from "../api/admin";
import { fetchManifest, manifestKey } from "../api/domain";
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
import { CHROME_LINK } from "../components/primitives";
import { useDomainWritable } from "../domainWritable";
import { isMissing, useDomainRights } from "../domainRights";
import { domainRoute, manifestEditRoute } from "../paths";

export default function DomainSettings() {
  const { domain = "" } = useParams();
  const { capabilities } = useAuth();
  const { canWrite } = useDomainWritable(domain);
  const navigate = useNavigate();
  const location = useLocation();
  const { summary, members, own, isRenaming } = useDomainRights(domain);
  // The front page's palette row "Unregister domain" lands here armed: the
  // question is asked by the card that owns it, never skipped.
  const [confirmingUnregister, setConfirmingUnregister] = useState(
    (location.state as { unregister?: boolean } | null)?.unregister === true,
  );
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

  // A link from the front page's rail opens at its block.
  const hash = location.hash;
  const loaded = members.data !== undefined && summary !== undefined;
  useEffect(() => {
    if (hash === "" || !loaded) {
      return;
    }
    document.getElementById(hash.slice(1))?.scrollIntoView?.();
  }, [hash, loaded]);

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

  return (
    <div className="flex max-w-[720px] flex-col gap-8">
      <header>
        <Link to={domainRoute(domain)} className={`text-sm ${CHROME_LINK}`}>
          {domain}
        </Link>
        <h1 className="text-display">Domain settings</h1>
      </header>

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

      <DangerZoneCard
        domain={domain}
        kind={summary?.kind ?? null}
        confirming={confirmingUnregister}
        onConfirmingChange={setConfirmingUnregister}
        renaming={isRenaming}
      />

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
