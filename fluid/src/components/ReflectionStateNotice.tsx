/**
 * What a Reflection screen shows in place of itself while the Reflection
 * cannot be shown.
 *
 * Its own module rather than beside the mode switch, which is eager: only the
 * lazy Reflection screens draw this, and its copy would otherwise be paid for
 * in the entry by everybody (the ledger's budget rule, lazy first).
 */

import type { ReactElement } from "react";

import type { ReflectionStatus } from "../api/reflectionDomains";
import { HomeElsewhere } from "./ReflectionModeSwitch";

/**
 * What stands where the Reflection would, while it cannot be shown: off,
 * waiting for engrams to leave `reflections/`, without a home, served by
 * another instance, or living elsewhere. Null while it is on.
 */
export function ReflectionStateNotice({
  status,
}: {
  status: ReflectionStatus;
}): ReactElement | null {
  switch (status.state) {
    case "on":
      return null;
    case "elsewhere":
      return <HomeElsewhere url={status.homeUrl} />;
    case "pending":
      return (
        <div className="flex flex-col gap-1 text-sm">
          <p>The Reflection waits until these engrams leave reflections/:</p>
          <ul className="list-disc pl-5 font-mono">
            {status.pendingEngrams.map((path) => (
              <li key={path}>{path}</li>
            ))}
          </ul>
        </div>
      );
    case "homeless":
      // A GitHub-connected domain whose home is missing: never "off", which
      // would send its owner to a switch that is already on.
      return (
        <p className="text-sm">
          This domain's Reflection has no home yet. Its owner switches it on
          again in the domain policies at the team server.
        </p>
      );
    case "hosted_elsewhere":
      // Another instance on the same Postgres database holds the host lock
      // (backend Task 47). The status never refuses, so this is our own
      // sentence around the server's label. The label is null only while a
      // rename pauses a domain whose lock nobody holds.
      return (
        <p className="text-sm">
          {status.hostLabel !== null
            ? `This domain's Reflection is served by another instance: ${status.hostLabel}.`
            : "This domain is being renamed. Its Reflection opens again when the rename is done."}
        </p>
      );
    case "off":
      return (
        <p className="text-sm">
          The Reflection is off for this domain. Its owner switches it on in the
          domain policies.
        </p>
      );
  }
}
