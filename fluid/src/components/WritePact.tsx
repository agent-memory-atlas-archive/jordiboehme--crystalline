/**
 * PACT.md does not exist yet: create it with a heading and open it in the
 * editor. A create never overwrites, so a pact written meanwhile by somebody
 * else is refused in the server's words.
 *
 * Two looks for one act: a secondary button on the Reflection home, and a
 * sidebar row ("Write the pact" in place of "How we write") everywhere else.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BookOpen } from "lucide-react";
import type { ReactElement } from "react";
import { useNavigate } from "react-router";

import { problemDetail } from "../api/client";
import { saveReflection } from "../api/reflection";
import { PACT_PATH, invalidateReflection } from "../api/reflectionDomains";
import { reflectionEditRoute } from "../paths";
import { BUTTON, SIDE } from "./primitives";

export function WritePact({
  domain,
  look = "button",
}: {
  domain: string;
  look?: "button" | "row";
}): ReactElement {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const write = useMutation({
    mutationFn: () =>
      saveReflection(domain, PACT_PATH, `# How we write about ${domain}\n`, {
        create: true,
      }),
    onSuccess: () => {
      invalidateReflection(queryClient, domain);
      void navigate(reflectionEditRoute(domain, PACT_PATH));
    },
  });
  const press = () => {
    write.mutate();
  };
  if (look === "row") {
    return (
      <>
        <button
          type="button"
          disabled={write.isPending}
          onClick={press}
          className={`${SIDE.row} w-full disabled:opacity-60`}
        >
          <BookOpen
            aria-hidden="true"
            size={16}
            strokeWidth={1.75}
            className={SIDE.icon}
          />
          Write the pact
        </button>
        {write.error && (
          <p
            role="alert"
            className="rounded bg-red-50 px-2.5 py-1.5 text-sm text-red-800 dark:bg-red-950 dark:text-red-200"
          >
            {problemDetail(write.error)}
          </p>
        )}
      </>
    );
  }
  return (
    <>
      <button
        type="button"
        disabled={write.isPending}
        onClick={press}
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
