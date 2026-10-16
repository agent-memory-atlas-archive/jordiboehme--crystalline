/**
 * The upload flow behind paste, drop and the attach button: what is refused
 * before a byte leaves the browser, what the buffer gets afterwards, and what
 * happens to the document when an upload fails (nothing, which is the point -
 * a reference to a file that was never stored is a dangling reference the
 * maintenance sweep would then have to flag).
 */

import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiProblem } from "../api/client";
import type { AssetHome } from "../api/files";
import { listAttachments, uploadAttachment } from "../api/files";
import {
  attachmentMarkdown,
  attachmentUploads,
  refuseAttachment,
  transferFiles,
  uploadAttachments,
} from "./attachments";
import { frontmatterFold } from "./frontmatterFold";

vi.mock("../api/files", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/files")>();
  return { ...actual, listAttachments: vi.fn(), uploadAttachment: vi.fn() };
});

const listMock = vi.mocked(listAttachments);
const uploadMock = vi.mocked(uploadAttachment);

/** A file of a given name and size, with no bytes actually allocated. */
function fileOf(name: string, size = 8): File {
  const file = new File(["x"], name);
  Object.defineProperty(file, "size", { value: size });
  return file;
}

let view: EditorView | null = null;

afterEach(() => {
  view?.destroy();
  view = null;
  vi.clearAllMocks();
});

/** A live buffer with the caret on its one line. */
function mount(doc = "Body line\n"): EditorView {
  // In the document, as a buffer on a screen is: a view that left it (the
  // screen went) takes no reference.
  view = new EditorView({
    state: EditorState.create({ doc }),
    parent: document.body,
  });
  view.dispatch({ selection: { anchor: doc.indexOf("\n") } });
  return view;
}

describe("refuseAttachment", () => {
  it("passes an allowed file under the ceiling", () => {
    expect(refuseAttachment(fileOf("shot.png"))).toBeNull();
  });

  it("judges the name the sanitizer would store, padding and all", () => {
    // The pre-check and the path builder have to agree about what the file is
    // called, or a name a trailing space is refused for is a name that would
    // have been stored perfectly legally.
    expect(refuseAttachment(fileOf("shot.png "))).toBeNull();
  });

  it("refuses an extension that is not on the allowlist, naming the file", () => {
    const refusal = refuseAttachment(fileOf("tool.exe"));
    expect(refusal).toContain("tool.exe");
    expect(refusal).toMatch(/png/);
  });

  it("refuses a file past 10 MiB before it is uploaded", () => {
    const refusal = refuseAttachment(fileOf("huge.png", 10 * 1024 * 1024 + 1));
    expect(refusal).toContain("huge.png");
    expect(refusal).toContain("10 MiB");
  });
});

describe("attachmentMarkdown", () => {
  it("embeds an image and links everything else", () => {
    expect(attachmentMarkdown("Shot.PNG", "assets/2026/08/shot.png")).toBe(
      "![Shot.PNG](assets/2026/08/shot.png)",
    );
    expect(attachmentMarkdown("diagram.svg", "assets/a/diagram.svg")).toBe(
      "![diagram.svg](assets/a/diagram.svg)",
    );
    expect(attachmentMarkdown("Q3.pdf", "assets/2026/08/q3.pdf")).toBe(
      "[Q3.pdf](assets/2026/08/q3.pdf)",
    );
  });

  it("keeps a bracket in the name out of the link text", () => {
    expect(attachmentMarkdown("a[b].pdf", "assets/a-b.pdf")).toBe(
      "[a b .pdf](assets/a-b.pdf)",
    );
  });
});

describe("transferFiles", () => {
  it("reads the files off a clipboard or drag payload, and nothing off text", () => {
    const file = fileOf("shot.png");
    expect(transferFiles({ files: [file] } as unknown as DataTransfer)).toEqual(
      [file],
    );
    expect(transferFiles({ files: [] } as unknown as DataTransfer)).toEqual([]);
    expect(transferFiles(null)).toEqual([]);
  });
});

describe("attachmentUploads", () => {
  /**
   * A clipboard or drag event carrying these files. `getData` is there for
   * the editor's own handler, which reads the text payload of anything this
   * module hands back to it.
   */
  function transferEvent(
    type: "paste" | "drop" | "dragover",
    files: File[],
  ): Event {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(
      event,
      type === "paste" ? "clipboardData" : "dataTransfer",
      { value: { files, types: [], getData: () => "" } },
    );
    return event;
  }

  it("takes the files off a paste and stops the browser pasting them too", () => {
    const seen: File[][] = [];
    view = new EditorView({
      state: EditorState.create({
        doc: "x\n",
        extensions: [
          attachmentUploads((files) => {
            seen.push(files);
          }),
        ],
      }),
    });
    const file = fileOf("shot.png");

    const event = transferEvent("paste", [file]);
    view.contentDOM.dispatchEvent(event);

    expect(seen).toEqual([[file]]);
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves a paste with no files to the editor", () => {
    const seen: File[][] = [];
    view = new EditorView({
      state: EditorState.create({
        doc: "x\n",
        extensions: [
          attachmentUploads((files) => {
            seen.push(files);
          }),
        ],
      }),
    });

    const event = transferEvent("paste", []);
    view.contentDOM.dispatchEvent(event);

    // What the editor then does with a text paste is the editor's business -
    // it cancels the event itself - so the assertion is that this module did
    // not take it, not that nobody did.
    expect(seen).toEqual([]);
  });

  it("takes the files off a drop", () => {
    const seen: File[][] = [];
    view = new EditorView({
      state: EditorState.create({
        doc: "x\n",
        extensions: [
          attachmentUploads((files) => {
            seen.push(files);
          }),
        ],
      }),
    });
    const file = fileOf("shot.png");

    const event = transferEvent("drop", [file]);
    view.contentDOM.dispatchEvent(event);

    expect(seen).toEqual([[file]]);
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves a drop with no files to the editor", () => {
    const seen: File[][] = [];
    view = new EditorView({
      state: EditorState.create({
        doc: "x\n",
        extensions: [
          attachmentUploads((files) => {
            seen.push(files);
          }),
        ],
      }),
    });

    view.contentDOM.dispatchEvent(transferEvent("drop", []));

    expect(seen).toEqual([]);
  });

  it("cancels a file dragover and only a file dragover", () => {
    // The one that is invisible until it breaks: a browser fires no drop at
    // all unless the dragover before it was cancelled, so a regression here
    // kills drag and drop with every other test still green.
    view = new EditorView({
      state: EditorState.create({
        doc: "x\n",
        extensions: [attachmentUploads(() => undefined)],
      }),
    });

    const withFiles = transferEvent("dragover", [fileOf("shot.png")]);
    const withoutFiles = transferEvent("dragover", []);
    view.contentDOM.dispatchEvent(withFiles);
    view.contentDOM.dispatchEvent(withoutFiles);

    expect(withFiles.defaultPrevented).toBe(true);
    expect(withoutFiles.defaultPrevented).toBe(false);
  });
});

describe("uploadAttachments", () => {
  it("uploads under the dated folder and inserts one line per file", async () => {
    const target = mount();
    listMock.mockResolvedValueOnce([]);
    uploadMock.mockImplementation((_domain, path) =>
      Promise.resolve({ path, mime: "image/png", size: 8, sha256: "a" }),
    );
    const errors: (string | null)[] = [];

    const inserted = await uploadAttachments({
      domain: "eng",
      files: [fileOf("Q3 Deck (final).PDF"), fileOf("Shot.PNG")],
      view: target,
      onError: (message) => errors.push(message),
      now: new Date(2026, 7, 3),
    });

    expect(inserted).toBe(2);
    expect(uploadMock.mock.calls.map((call) => call[1])).toEqual([
      "assets/2026/08/q3-deck-final.pdf",
      "assets/2026/08/shot.png",
    ]);
    expect(target.state.doc.toString()).toContain(
      "[Q3 Deck (final).PDF](assets/2026/08/q3-deck-final.pdf)\n" +
        "![Shot.PNG](assets/2026/08/shot.png)",
    );
    // The one entry is the clear the batch opens with.
    expect(errors).toEqual([null]);
  });

  it("suffixes against the domain's existing files and against this batch", async () => {
    const target = mount();
    listMock.mockResolvedValueOnce([
      {
        path: "assets/2026/08/shot.png",
        mime: "image/png",
        size: 1,
        modified: "2026-08-01T00:00:00+00:00",
        sha256: "a",
      },
    ]);
    uploadMock.mockImplementation((_domain, path) =>
      Promise.resolve({ path, mime: "image/png", size: 8, sha256: "a" }),
    );

    await uploadAttachments({
      domain: "eng",
      files: [fileOf("shot.png"), fileOf("shot.png")],
      view: target,
      onError: () => undefined,
      now: new Date(2026, 7, 3),
    });

    expect(uploadMock.mock.calls.map((call) => call[1])).toEqual([
      "assets/2026/08/shot-2.png",
      "assets/2026/08/shot-3.png",
    ]);
  });

  it("reports a refused file and never uploads it", async () => {
    const target = mount();
    const errors: (string | null)[] = [];

    const inserted = await uploadAttachments({
      domain: "eng",
      files: [fileOf("tool.exe")],
      view: target,
      onError: (message) => errors.push(message),
      now: new Date(2026, 7, 3),
    });

    expect(inserted).toBe(0);
    // Nothing left to upload, so not even the listing is read.
    expect(listMock).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
    expect(errors.at(-1)).toContain("tool.exe");
    expect(target.state.doc.toString()).toBe("Body line\n");
  });

  it("reports every refusal in the batch, not only the last one", async () => {
    // The screen holds one line, so an author who dropped five files and had
    // two refused has to be able to read which two.
    const target = mount();
    listMock.mockResolvedValueOnce([]);
    uploadMock.mockImplementation((_domain, path) =>
      Promise.resolve({ path, mime: "image/png", size: 8, sha256: "a" }),
    );
    const errors: (string | null)[] = [];

    const inserted = await uploadAttachments({
      domain: "eng",
      files: [
        fileOf("tool.exe"),
        fileOf("shot.png"),
        fileOf("huge.png", 10 * 1024 * 1024 + 1),
      ],
      view: target,
      onError: (message) => errors.push(message),
      now: new Date(2026, 7, 3),
    });

    expect(inserted).toBe(1);
    const reported = errors.at(-1) ?? "";
    expect(reported).toContain("tool.exe");
    expect(reported).toContain("huge.png");
    // One report per batch rather than one per failure: the clear, then this.
    expect(errors).toHaveLength(2);
  });

  it("inserts nothing for a failed upload and surfaces the server's words", async () => {
    const target = mount();
    listMock.mockResolvedValueOnce([]);
    uploadMock.mockRejectedValueOnce(
      new ApiProblem(413, "too large", "the attachment is larger than 10 MiB"),
    );
    const errors: (string | null)[] = [];

    const inserted = await uploadAttachments({
      domain: "eng",
      files: [fileOf("shot.png")],
      view: target,
      onError: (message) => errors.push(message),
      now: new Date(2026, 7, 3),
    });

    expect(inserted).toBe(0);
    expect(errors.at(-1)).toBe("the attachment is larger than 10 MiB");
    expect(target.state.doc.toString()).toBe("Body line\n");
  });

  it("says so when the bytes landed but the reference could not be inserted", async () => {
    // The buffer's whole text is selected and its frontmatter is folded, which
    // is the case `insertBlock` refuses: an edit made through a block nobody
    // can see. The PUT has already happened by then, so silence here would
    // leave a stored file no engram references - the orphan the maintenance
    // sweep would raise days later.
    const doc = "---\ntitle: T\n---\n\nBody line\n";
    view = new EditorView({
      state: EditorState.create({
        doc,
        selection: EditorSelection.single(0, doc.length),
        extensions: [frontmatterFold()],
      }),
      parent: document.body,
    });
    const target = view;
    listMock.mockResolvedValueOnce([]);
    uploadMock.mockImplementation((_domain, path) =>
      Promise.resolve({ path, mime: "image/png", size: 8, sha256: "a" }),
    );
    const errors: (string | null)[] = [];

    const inserted = await uploadAttachments({
      domain: "eng",
      files: [fileOf("shot.png")],
      view: target,
      onError: (message) => errors.push(message),
      now: new Date(2026, 7, 3),
    });

    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(inserted).toBe(0);
    // Named, so the file can be linked by hand or deleted.
    expect(errors.at(-1)).toContain("assets/2026/08/shot.png");
    expect(target.state.doc.toString()).toBe(doc);
  });

  it("uploads nothing when the domain's attachments cannot be listed", async () => {
    const target = mount();
    listMock.mockRejectedValueOnce(
      new ApiProblem(403, "forbidden", "this domain is not readable"),
    );
    const errors: (string | null)[] = [];

    const inserted = await uploadAttachments({
      domain: "eng",
      files: [fileOf("shot.png")],
      view: target,
      onError: (message) => errors.push(message),
      now: new Date(2026, 7, 3),
    });

    expect(inserted).toBe(0);
    expect(uploadMock).not.toHaveBeenCalled();
    expect(errors.at(-1)).toBe("this domain is not readable");
  });

  it("clears a standing error when a new batch starts", async () => {
    const target = mount();
    listMock.mockResolvedValueOnce([]);
    uploadMock.mockImplementation((_domain, path) =>
      Promise.resolve({ path, mime: "image/png", size: 8, sha256: "a" }),
    );
    const errors: (string | null)[] = [];

    await uploadAttachments({
      domain: "eng",
      files: [fileOf("shot.png")],
      view: target,
      onError: (message) => errors.push(message),
      now: new Date(2026, 7, 3),
    });

    expect(errors[0]).toBeNull();
  });
});

describe("uploadAttachments through a home", () => {
  it("an upload through a home writes the home's link and runs place first", async () => {
    const target = mount();
    const order: string[] = [];
    const home: AssetHome = {
      key: ["fake"],
      list: () => Promise.resolve([]),
      upload: (path) => {
        order.push("upload");
        return Promise.resolve({
          path,
          mime: "image/png",
          size: 8,
          sha256: "a",
        });
      },
      remove: () => Promise.resolve(),
      url: (path) => `/fake/${path}`,
      resolve: () => null,
      refused: () => null,
      linkTo: (path) => `../${path}`,
    };
    const carets: number[] = [];

    const inserted = await uploadAttachments({
      home,
      files: [fileOf("shot.png")],
      view: target,
      onError: () => undefined,
      now: new Date(2026, 9, 15),
      place: (placed) => {
        order.push("place");
        carets.push(placed.state.selection.main.head);
        // The insert has not happened yet: the buffer is still the bare body.
        expect(placed.state.doc.toString()).toBe("Body line\n");
      },
    });

    expect(inserted).toBe(1);
    expect(order).toEqual(["upload", "place"]);
    expect(carets).toEqual(["Body line".length]);
    // The link text is the file's own name, as for an engram; only the
    // target is the home's spelling.
    expect(target.state.doc.toString().trimEnd()).toMatch(
      /!\[shot\.png\]\(\.\.\/assets\/2026\/10\/shot\.png\)$/,
    );
    expect(listMock).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
  });
});

/**
 * Where a file goes when nobody chose a place: the picker on a buffer that
 * was only opened has its caret at the very start, above the title, so the
 * reference goes to the end instead. A caret the person placed, a paste and
 * a drop keep the place they name.
 */
describe("uploadAttachments and the caret nobody placed", () => {
  const DOC = "# Title\n\nBody line.\n";
  const LINK = "![shot.png](../assets/2026/10/shot.png)";
  const home: AssetHome = {
    key: ["fake"],
    list: () => Promise.resolve([]),
    upload: (path) =>
      Promise.resolve({ path, mime: "image/png", size: 8, sha256: "a" }),
    remove: () => Promise.resolve(),
    url: (path) => `/fake/${path}`,
    resolve: () => null,
    refused: () => null,
    linkTo: (path) => `../${path}`,
  };

  /** A buffer as a screen mounts it: the upload handlers in, caret at 0. */
  function opened(
    doc = DOC,
    onFiles: (files: File[]) => void = () => undefined,
  ) {
    view = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [attachmentUploads(onFiles)],
      }),
      parent: document.body,
    });
    return view;
  }

  function upload(target: EditorView) {
    return uploadAttachments({
      home,
      files: [fileOf("shot.png")],
      view: target,
      onError: () => undefined,
      now: new Date(2026, 9, 15),
    });
  }

  function carrying(type: "paste" | "drop", files: File[]): Event {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(
      event,
      type === "paste" ? "clipboardData" : "dataTransfer",
      { value: { files, types: ["Files"], getData: () => "" } },
    );
    return event;
  }

  it("puts the file at the end, after a blank line, when no caret was placed", async () => {
    const target = opened();
    expect(await upload(target)).toBe(1);
    expect(target.state.doc.toString()).toBe(`${DOC}\n${LINK}\n`);
    expect(target.state.selection.main.head).toBe(DOC.length + 1 + LINK.length);
  });

  it("adds the blank line itself when the text ends without a line break", async () => {
    const target = opened("Body line.");
    await upload(target);
    expect(target.state.doc.toString()).toBe(`Body line.\n\n${LINK}\n`);
  });

  it("takes an empty buffer as it is", async () => {
    const target = opened("");
    await upload(target);
    expect(target.state.doc.toString()).toBe(`${LINK}\n`);
  });

  // The two blank lines below the reference in the next cases are
  // `insertBlock`'s own spacing, unchanged by this rule.
  it("puts the file below the caret's line once the person placed it", async () => {
    const target = opened();
    target.dispatch({
      selection: { anchor: "# Title".length },
      userEvent: "select.pointer",
    });
    await upload(target);
    expect(target.state.doc.toString()).toBe(
      `# Title\n\n${LINK}\n\n\nBody line.\n`,
    );
  });

  it("counts typing as a placed caret", async () => {
    const target = opened();
    target.dispatch({
      changes: { from: 0, insert: "x" },
      selection: { anchor: 1 },
      userEvent: "input.type",
    });
    await upload(target);
    expect(target.state.doc.toString()).toBe(
      `x# Title\n\n${LINK}\n\n\nBody line.\n`,
    );
  });

  it("leaves a caret moved by code alone, as a room or a draft moves it", async () => {
    const target = opened();
    target.dispatch({ selection: { anchor: "# Title".length } });
    await upload(target);
    expect(target.state.doc.toString()).toBe(`${DOC}\n${LINK}\n`);
  });

  it("puts a pasted file at the caret, even one nobody moved", async () => {
    const batches: File[][] = [];
    const target = opened(DOC, (files) => {
      batches.push(files);
    });
    target.contentDOM.dispatchEvent(carrying("paste", [fileOf("shot.png")]));
    expect(batches).toHaveLength(1);
    await upload(target);
    expect(target.state.doc.toString()).toBe(
      `# Title\n\n${LINK}\n\n\nBody line.\n`,
    );
  });

  it("puts a dropped file where it was dropped", async () => {
    const target = opened();
    // A synthetic drop has no coordinates, so the caret stays where code put
    // it; the drop itself is what names the place.
    target.dispatch({ selection: { anchor: "# Title".length } });
    target.contentDOM.dispatchEvent(carrying("drop", [fileOf("shot.png")]));
    await upload(target);
    expect(target.state.doc.toString()).toBe(
      `# Title\n\n${LINK}\n\n\nBody line.\n`,
    );
  });
});

/**
 * The name race: the listing said a path was free, and by the time the PUT
 * arrived somebody had stored a file there. Only a refusal (403, 409) whose
 * path a fresh listing now holds is tried again, once, under the next free
 * name; anything else is reported as the server said it. For an engram the
 * PUT replaces, so the retry can only fire on a refusal, and nothing else
 * changes.
 */
describe("uploadAttachments when a name is taken meanwhile", () => {
  // Queued answers must not leak between tests: clearing call history keeps them.
  beforeEach(() => {
    listMock.mockReset();
    uploadMock.mockReset();
  });

  const SHOT = {
    path: "assets/2026/08/shot.png",
    mime: "image/png",
    size: 1,
    modified: "2026-08-01T00:00:00+00:00",
    sha256: "a",
  };

  function stored(path: string) {
    return Promise.resolve({ path, mime: "image/png", size: 8, sha256: "a" });
  }

  async function upload(errors: (string | null)[] = []) {
    const target = mount();
    const inserted = await uploadAttachments({
      domain: "eng",
      files: [fileOf("shot.png")],
      view: target,
      onError: (message) => errors.push(message),
      now: new Date(2026, 7, 3),
    });
    return { target, inserted, errors };
  }

  it("tries once more under the next free name when a fresh listing holds the path", async () => {
    listMock.mockResolvedValueOnce([]).mockResolvedValueOnce([SHOT]);
    uploadMock
      .mockRejectedValueOnce(
        new ApiProblem(409, "conflict", "assets/2026/08/shot.png exists"),
      )
      .mockImplementationOnce((_domain, path) => stored(path));

    const { target, inserted, errors } = await upload();

    expect(inserted).toBe(1);
    expect(uploadMock.mock.calls.map((call) => call[1])).toEqual([
      "assets/2026/08/shot.png",
      "assets/2026/08/shot-2.png",
    ]);
    expect(target.state.doc.toString()).toContain(
      "![shot.png](assets/2026/08/shot-2.png)",
    );
    expect(errors).toEqual([null]);
  });

  it("names the rest of the batch against the fresh listing too", async () => {
    listMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        SHOT,
        { ...SHOT, path: "assets/2026/08/shot-2.png" },
      ]);
    uploadMock
      .mockRejectedValueOnce(new ApiProblem(409, "conflict", "taken"))
      .mockImplementation((_domain, path) => stored(path));
    const target = mount();

    const inserted = await uploadAttachments({
      domain: "eng",
      files: [fileOf("shot.png"), fileOf("shot.png")],
      view: target,
      onError: () => undefined,
      now: new Date(2026, 7, 3),
    });

    expect(inserted).toBe(2);
    expect(uploadMock.mock.calls.map((call) => call[1])).toEqual([
      "assets/2026/08/shot.png",
      "assets/2026/08/shot-3.png",
      "assets/2026/08/shot-4.png",
    ]);
  });

  it("matches the fresh listing without regard to case", async () => {
    listMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...SHOT, path: "assets/2026/08/SHOT.png" }]);
    uploadMock
      .mockRejectedValueOnce(new ApiProblem(403, "forbidden", "taken"))
      .mockImplementationOnce((_domain, path) => stored(path));

    const { inserted } = await upload();

    expect(inserted).toBe(1);
    expect(uploadMock.mock.calls[1]?.[1]).toBe("assets/2026/08/shot-2.png");
  });

  it("takes a 412 as a taken name without reading the listing again", async () => {
    listMock.mockResolvedValueOnce([]);
    uploadMock
      .mockRejectedValueOnce(
        new ApiProblem(412, "precondition failed", "already holds a file"),
      )
      .mockImplementationOnce((_domain, path) => stored(path));

    const { target, inserted, errors } = await upload();

    expect(inserted).toBe(1);
    expect(listMock).toHaveBeenCalledTimes(1);
    expect(uploadMock.mock.calls.map((call) => call[1])).toEqual([
      "assets/2026/08/shot.png",
      "assets/2026/08/shot-2.png",
    ]);
    expect(target.state.doc.toString()).toContain(
      "![shot.png](assets/2026/08/shot-2.png)",
    );
    expect(errors).toEqual([null]);
  });

  it("names the rest of the batch past a path a 412 refused", async () => {
    listMock.mockResolvedValueOnce([]);
    uploadMock
      .mockRejectedValueOnce(new ApiProblem(412, "precondition failed", "x"))
      .mockImplementation((_domain, path) => stored(path));
    const target = mount();

    const inserted = await uploadAttachments({
      domain: "eng",
      files: [fileOf("shot.png"), fileOf("shot.png")],
      view: target,
      onError: () => undefined,
      now: new Date(2026, 7, 3),
    });

    expect(inserted).toBe(2);
    expect(listMock).toHaveBeenCalledTimes(1);
    expect(uploadMock.mock.calls.map((call) => call[1])).toEqual([
      "assets/2026/08/shot.png",
      "assets/2026/08/shot-2.png",
      "assets/2026/08/shot-3.png",
    ]);
  });

  it("does not try a third time", async () => {
    listMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([SHOT])
      .mockResolvedValue([
        SHOT,
        { ...SHOT, path: "assets/2026/08/shot-2.png" },
      ]);
    uploadMock
      .mockRejectedValueOnce(new ApiProblem(409, "conflict", "first"))
      .mockRejectedValueOnce(new ApiProblem(409, "conflict", "second"));

    const { target, inserted, errors } = await upload();

    expect(inserted).toBe(0);
    expect(uploadMock).toHaveBeenCalledTimes(2);
    expect(errors.at(-1)).toBe("second");
    expect(target.state.doc.toString()).toBe("Body line\n");
  });

  it("reports a refusal for a path nobody holds as the server sent it", async () => {
    listMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    uploadMock.mockRejectedValueOnce(
      new ApiProblem(403, "forbidden", "you may not add files here"),
    );

    const { inserted, errors } = await upload();

    expect(inserted).toBe(0);
    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(listMock).toHaveBeenCalledTimes(2);
    expect(errors.at(-1)).toBe("you may not add files here");
  });

  it("reports the refusal when the fresh listing cannot be read", async () => {
    listMock
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new ApiProblem(500, "error", "listing broke"));
    uploadMock.mockRejectedValueOnce(
      new ApiProblem(409, "conflict", "the path is taken"),
    );

    const { inserted, errors } = await upload();

    expect(inserted).toBe(0);
    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(errors.at(-1)).toBe("the path is taken");
  });

  it("lists once and never retries any other failure", async () => {
    listMock.mockResolvedValueOnce([SHOT]);
    uploadMock.mockRejectedValueOnce(
      new ApiProblem(413, "too large", "the attachment is larger than 10 MiB"),
    );

    const { errors } = await upload();

    expect(listMock).toHaveBeenCalledTimes(1);
    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(errors.at(-1)).toBe("the attachment is larger than 10 MiB");
  });

  it("lists once when every upload lands", async () => {
    listMock.mockResolvedValueOnce([]);
    uploadMock.mockImplementation((_domain, path) => stored(path));

    const { inserted } = await upload();

    expect(inserted).toBe(1);
    expect(listMock).toHaveBeenCalledTimes(1);
  });
});

/**
 * A buffer that cannot be edited (a room that has ended) takes no files: a
 * paste or a drop starts no upload, and a batch that was in flight when the
 * buffer turned read-only inserts nothing into it.
 */
describe("a read-only buffer", () => {
  // Queued answers must not leak between tests: clearing call history keeps them.
  beforeEach(() => {
    listMock.mockReset();
    uploadMock.mockReset();
  });

  function readOnlyView(seen: File[][]): EditorView {
    view = new EditorView({
      state: EditorState.create({
        doc: "x\n",
        extensions: [
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          attachmentUploads((files) => {
            seen.push(files);
          }),
        ],
      }),
    });
    return view;
  }

  function carrying(type: "paste" | "drop", files: File[]): Event {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(
      event,
      type === "paste" ? "clipboardData" : "dataTransfer",
      { value: { files, types: ["Files"], getData: () => "" } },
    );
    return event;
  }

  it("takes no file from a paste", () => {
    const seen: File[][] = [];
    const target = readOnlyView(seen);
    target.contentDOM.dispatchEvent(carrying("paste", [fileOf("shot.png")]));
    expect(seen).toEqual([]);
    expect(target.state.doc.toString()).toBe("x\n");
  });

  it("takes no file from a drop, and the browser does not open it either", () => {
    const seen: File[][] = [];
    const target = readOnlyView(seen);
    const event = carrying("drop", [fileOf("shot.png")]);
    target.contentDOM.dispatchEvent(event);
    expect(seen).toEqual([]);
    expect(event.defaultPrevented).toBe(true);
  });

  it("inserts nothing when the buffer turned read-only during the upload", async () => {
    const lock = new Compartment();
    view = new EditorView({
      state: EditorState.create({
        doc: "Body line\n",
        extensions: [lock.of([])],
      }),
      parent: document.body,
    });
    const target = view;
    listMock.mockResolvedValueOnce([]);
    uploadMock.mockImplementation((_domain, path) => {
      target.dispatch({
        effects: lock.reconfigure(EditorState.readOnly.of(true)),
      });
      return Promise.resolve({ path, mime: "image/png", size: 8, sha256: "a" });
    });
    const errors: (string | null)[] = [];

    const inserted = await uploadAttachments({
      domain: "eng",
      files: [fileOf("shot.png")],
      view: target,
      onError: (message) => errors.push(message),
      now: new Date(2026, 7, 3),
    });

    expect(inserted).toBe(0);
    expect(target.state.doc.toString()).toBe("Body line\n");
    // Named, so the stored file can be linked when the page is edited again.
    expect(errors.at(-1)).toBe(
      "Uploaded to assets/2026/08/shot.png. The session ended, so no link was added. Add it when you edit the page again.",
    );
  });

  it("starts nothing when the buffer is read-only already", async () => {
    const seen: File[][] = [];
    const target = readOnlyView(seen);
    const errors: (string | null)[] = [];

    const inserted = await uploadAttachments({
      domain: "eng",
      files: [fileOf("shot.png")],
      view: target,
      onError: (message) => errors.push(message),
    });

    expect(inserted).toBe(0);
    expect(listMock).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
    expect(errors.at(-1)).toBe("The session ended, so the file was not added.");
  });
});

describe("a buffer that is gone when the upload ends", () => {
  beforeEach(() => {
    listMock.mockReset();
    uploadMock.mockReset();
  });

  it("names the stored file instead of claiming a link", async () => {
    const target = mount();
    listMock.mockResolvedValueOnce([]);
    uploadMock.mockImplementation((_domain, path) => {
      // The screen went (a remount, Done, a navigation) while the bytes flew.
      target.destroy();
      return Promise.resolve({ path, mime: "image/png", size: 8, sha256: "a" });
    });
    const errors: (string | null)[] = [];
    const kinds: (string | undefined)[] = [];

    const inserted = await uploadAttachments({
      domain: "eng",
      files: [fileOf("shot.png")],
      view: target,
      onError: (message, kind) => {
        errors.push(message);
        kinds.push(kind);
      },
      now: new Date(2026, 7, 3),
    });

    expect(inserted).toBe(0);
    expect(errors.at(-1)).toBe(
      "Uploaded to assets/2026/08/shot.png, but the screen was closed before the link was added. Add the link when you edit again.",
    );
    // The file arrived; only its link is missing.
    expect(kinds.at(-1)).toBe("unlinked");
  });
});
