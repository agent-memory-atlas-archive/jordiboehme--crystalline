/**
 * The notices about uploads whose screen has gone: what they say, that only
 * their own Dismiss takes them down, and where the focus goes after.
 */

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Dialog } from "radix-ui";
import { afterEach, describe, expect, it } from "vitest";

import {
  dismissUploadNotice,
  reportOrphanUpload,
  uploadNotices,
} from "../uploadNotices";
import { UploadNotices } from "./UploadNotices";

afterEach(() => {
  for (const notice of uploadNotices()) {
    act(() => {
      dismissUploadNotice(notice.id);
    });
  }
});

describe("the upload notices", () => {
  it("says a stored file without its link apart from an upload that did not finish", () => {
    render(<UploadNotices />);
    act(() => {
      reportOrphanUpload(["a.png"], "Page", "the disk is full");
      reportOrphanUpload(
        ["flow.png"],
        "Night deploys",
        "Uploaded to assets/flow.png, but the screen was closed before the link was added.",
        "unlinked",
      );
    });
    expect(
      screen.getByText("The upload of a.png to Page did not finish."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "flow.png was uploaded to Night deploys, but the link was not added.",
      ),
    ).toBeInTheDocument();
    // Each Dismiss names its own file.
    expect(
      screen.getByRole("button", { name: "Dismiss: a.png" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Dismiss: flow.png" }),
    ).toBeInTheDocument();
  });

  it("stays when Escape closes a dialog that was open before it came", async () => {
    render(
      <>
        <Dialog.Root defaultOpen>
          <Dialog.Portal>
            <Dialog.Content aria-describedby={undefined}>
              <Dialog.Title>Open dialog</Dialog.Title>
              <input aria-label="inside" />
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
        <UploadNotices />
      </>,
    );
    act(() => {
      reportOrphanUpload(["a.png"], "Page", "the disk is full");
    });
    // The dialog hides the rest of the page, so the notice waits for it.
    expect(
      screen.queryByText("The upload of a.png to Page did not finish."),
    ).toBeNull();
    await userEvent.click(screen.getByLabelText("inside"));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Open dialog" })).toBeNull();
    // Once it has closed, the notice appears as an alert, which is announced.
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "The upload of a.png to Page did not finish.",
    );
  });

  it("shows a notice that came before a dialog opened, and names each Dismiss apart", () => {
    render(<UploadNotices />);
    act(() => {
      reportOrphanUpload(["flow.png"], "Page", "one");
      reportOrphanUpload(["flow.png"], "Other page", "two");
    });
    expect(
      screen.getByRole("button", { name: "Dismiss: flow.png (1 of 2)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Dismiss: flow.png (2 of 2)" }),
    ).toBeInTheDocument();
    // A long stack scrolls inside its corner.
    expect(screen.getByRole("region", { name: "Upload notices" })).toHaveClass(
      "overflow-y-auto",
    );
  });

  it("stays on an Escape pressed elsewhere", async () => {
    render(
      <>
        <input aria-label="elsewhere" />
        <UploadNotices />
      </>,
    );
    act(() => {
      reportOrphanUpload(["a.png"], "Page", "the disk is full");
    });
    await userEvent.click(screen.getByLabelText("elsewhere"));
    await userEvent.keyboard("{Escape}");
    expect(
      screen.getByText("The upload of a.png to Page did not finish."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("elsewhere")).toHaveFocus();
  });

  it("gives the focus back to where it was when the last one goes", async () => {
    render(
      <>
        <input aria-label="before" />
        <UploadNotices />
      </>,
    );
    act(() => {
      reportOrphanUpload(["a.png"], "Page", "one");
      reportOrphanUpload(["b.png"], "Page", "two");
    });
    await userEvent.click(screen.getByLabelText("before"));
    await userEvent.tab();
    expect(
      screen.getByRole("button", { name: "Dismiss: a.png" }),
    ).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    // Another one is left: its own Dismiss takes the focus.
    expect(
      await screen.findByRole("button", { name: "Dismiss: b.png" }),
    ).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByLabelText("before")).toHaveFocus();
  });

  it("leaves the focus where it is when it never came to the notices", () => {
    render(
      <>
        <input aria-label="typing" />
        <UploadNotices />
      </>,
    );
    act(() => {
      reportOrphanUpload(["a.png"], "Page", "one");
    });
    screen.getByLabelText("typing").focus();
    act(() => {
      // Taken down some other way than its button, with the focus elsewhere.
      dismissUploadNotice(uploadNotices()[0]?.id ?? 0);
    });
    expect(screen.getByLabelText("typing")).toHaveFocus();
  });
});
