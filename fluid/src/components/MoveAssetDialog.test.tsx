/**
 * The file move dialog: what it refuses before any request, and how it reads
 * the server's receipt.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../api/client";
import { MoveAssetDialog } from "./MoveAssetDialog";

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, api: vi.fn() };
});

const apiMock = vi.mocked(api);

function open(path = "assets/flow.png") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MoveAssetDialog domain="eng" path={path} onClose={() => undefined} />
    </QueryClientProvider>,
  );
  return {
    field: screen.getByLabelText("New path"),
    submit: screen.getByRole("button", { name: "Move file" }),
  };
}

beforeEach(() => {
  apiMock.mockReset();
});

describe("moving a Reflection file", () => {
  it("offers Move file only for a path that is not empty and not unchanged", async () => {
    const { field, submit } = open();
    expect(field).toHaveValue("flow.png");
    expect(submit).toBeDisabled();
    const user = userEvent.setup();
    await user.clear(field);
    expect(submit).toBeDisabled();
    await user.type(field, "   ");
    expect(submit).toBeDisabled();
    await user.clear(field);
    await user.type(field, "diagrams/flow.png");
    expect(submit).toBeEnabled();
  });

  it("keeps the file's extension and says so before any request", async () => {
    const { field, submit } = open();
    const user = userEvent.setup();
    await user.clear(field);
    await user.type(field, "flow.jpg");
    expect(screen.getByText("Keep the .png extension.")).toBeVisible();
    expect(submit).toBeDisabled();
    await user.keyboard("{Enter}");
    // Another case of the same extension is the same kind of file.
    await user.clear(field);
    await user.type(field, "flow-2.PNG");
    expect(screen.queryByText("Keep the .png extension.")).toBeNull();
    expect(submit).toBeEnabled();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it.each(["/flow.png", "../flow.png", "a/../flow.png", "a//flow.png", "a/"])(
    "refuses %s before any request",
    async (value) => {
      const { field, submit } = open();
      const user = userEvent.setup();
      await user.clear(field);
      await user.type(field, value);
      expect(
        screen.getByText("Write a path like diagrams/flow.png."),
      ).toBeVisible();
      expect(submit).toBeDisabled();
      await user.keyboard("{Enter}");
      expect(apiMock).not.toHaveBeenCalled();
    },
  );

  it("says one link as one", async () => {
    apiMock.mockResolvedValue({
      from: "assets/flow.png",
      to: "assets/flow-2.png",
      links_rewritten: 1,
    });
    const { field, submit } = open();
    const user = userEvent.setup();
    await user.clear(field);
    await user.type(field, "flow-2.png");
    await user.click(submit);
    expect(await screen.findByText("Moved. 1 link updated.")).toBeVisible();
  });

  it("drops the last refusal once the path is edited", async () => {
    apiMock.mockRejectedValue(new Error("the room is open"));
    const { field, submit } = open();
    const user = userEvent.setup();
    await user.clear(field);
    await user.type(field, "flow-2.png");
    await user.click(submit);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "the room is open",
    );
    await user.type(field, "x");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
