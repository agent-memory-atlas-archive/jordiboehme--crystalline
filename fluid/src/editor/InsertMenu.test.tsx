/**
 * The Insert menu: one toolbar button with the word on it, a menu of words,
 * and every entry reaching the registry action it names.
 */

import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test } from "vitest";

import { Tooltips } from "../components/primitives";
import { InsertMenu } from "./InsertMenu";

let view: EditorView | null = null;
afterEach(() => {
  view?.destroy();
  view = null;
});

function mount(doc: string, pos: number): EditorView {
  view = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(pos),
      extensions: [EditorState.lineSeparator.of("\n")],
    }),
    parent: document.body,
  });
  // Inside a toolbar row that keeps the buffer's selection, as the format
  // bar does: its mousedown guard covers the menu's portal too.
  render(
    <div
      role="toolbar"
      onMouseDown={(event) => {
        event.preventDefault();
      }}
    >
      <InsertMenu view={view} />
    </div>,
    { wrapper: Tooltips },
  );
  return view;
}

function selected(v: EditorView): string {
  const { from, to } = v.state.selection.main;
  return v.state.sliceDoc(from, to);
}

describe("the Insert menu", () => {
  test("is a button with the word on it", () => {
    mount("", 0);
    const trigger = screen.getByRole("button", { name: "Insert" });
    expect(trigger.textContent).toBe("Insert");
  });

  test("offers its groups and items as words", async () => {
    mount("", 0);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Insert" }));
    const menu = await screen.findByRole("menu");
    const items = within(menu)
      .getAllByRole("menuitem")
      .map((item) => item.textContent);
    expect(items).toEqual([
      "Callout",
      "Diagram",
      "Expand block",
      "Code block",
      "Math block",
      "Status label",
      "Inline math",
      "Footnote",
    ]);
    expect(within(menu).getByRole("group", { name: "Blocks" })).not.toBeNull();
    expect(within(menu).getByRole("group", { name: "Inline" })).not.toBeNull();
  });

  test("Callout > Warning inserts a warning with its text selected", async () => {
    const v = mount("", 0);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Insert" }));
    await user.click(await screen.findByRole("menuitem", { name: "Callout" }));
    const kinds = await screen.findByRole("menu", { name: "Callout" });
    expect(
      within(kinds)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Note", "Tip", "Important", "Warning", "Caution"]);
    // A fresh pointer for the pick: jsdom lays nothing out, so a pointer
    // that leaves the submenu's trigger finds no safe path into the submenu
    // and Radix would close it on the way. A person's pointer has the path.
    await userEvent
      .setup()
      .click(within(kinds).getByRole("menuitem", { name: "Warning" }));
    expect(v.state.doc.toString()).toBe("> [!WARNING]\n> Text\n");
    expect(selected(v)).toBe("Text");
    await waitFor(() => {
      expect(screen.queryByRole("menu")).toBeNull();
    });
    expect(v.hasFocus).toBe(true);
  });

  test("Diagram offers sixteen starters under their three group labels", async () => {
    mount("", 0);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Insert" }));
    await user.click(await screen.findByRole("menuitem", { name: "Diagram" }));
    const diagrams = await screen.findByRole("menu", { name: "Diagram" });
    expect(within(diagrams).getAllByRole("menuitem")).toHaveLength(16);
    for (const label of ["Everyday", "Planning and product", "Technical"]) {
      expect(
        within(diagrams).getByRole("group", { name: label }),
      ).not.toBeNull();
    }
  });

  test("Status label goes in at the caret", async () => {
    const v = mount("Done ", 5);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Insert" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Status label" }),
    );
    expect(v.state.doc.toString()).toBe("Done :status[Status]{grey}");
    expect(selected(v)).toBe("Status");
  });

  test("Escape closes the menu and gives the buffer back", async () => {
    const v = mount("prose\n", 5);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Insert" }));
    await screen.findByRole("menu");
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("menu")).toBeNull();
    });
    expect(v.hasFocus).toBe(true);
    expect(v.state.doc.toString()).toBe("prose\n");
  });

  test("is off without a buffer", () => {
    render(<InsertMenu view={null} />, { wrapper: Tooltips });
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Insert" })
        .disabled,
    ).toBe(true);
  });
});
