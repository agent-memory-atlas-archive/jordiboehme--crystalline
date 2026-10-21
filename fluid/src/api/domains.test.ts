import { describe, expect, it } from "vitest";

import { readListing } from "./domains";

describe("readListing", () => {
  it("reads a row's read_only as this caller's write block, absent as writable", () => {
    const listing = readListing({
      domains: [
        { name: "archive", read_only: true },
        { name: "eng" },
        { name: "old", read_only: false },
      ],
    });
    expect(listing.domains.map((d) => d.writeBlocked)).toEqual([
      true,
      false,
      false,
    ]);
  });

  it("reads a row's rename_pending, null when absent or malformed", () => {
    const listing = readListing({
      domains: [
        {
          name: "eng",
          rename_pending: {
            from: "eng",
            to: "platform",
            seen_at: "2026-10-21T08:00:00Z",
          },
        },
        { name: "ops", rename_pending: null },
        { name: "old" },
        { name: "odd", rename_pending: { from: "x" } },
      ],
    });
    expect(listing.domains.map((d) => d.renamePending)).toEqual([
      { from: "eng", to: "platform", seenAt: "2026-10-21T08:00:00Z" },
      null,
      null,
      null,
    ]);
  });

  it("reads the mounted domains beside the local ones", () => {
    const listing = readListing({
      behavior: [],
      domains: [{ name: "notes" }],
      mounted: [
        {
          name: "jordi-acme",
          source: "acme",
          source_url: "https://kb.acme.com",
          remote_name: "jordi",
          web_url: "https://kb.acme.com/d/jordi",
        },
        { source: "acme" },
      ],
    });
    expect(listing.domains.map((d) => d.name)).toEqual(["notes"]);
    expect(listing.mounted).toEqual([
      {
        name: "jordi-acme",
        source: "acme",
        sourceUrl: "https://kb.acme.com",
        remoteName: "jordi",
        webUrl: "https://kb.acme.com/d/jordi",
      },
    ]);
  });

  it("reads a listing without mounted domains as an empty list", () => {
    expect(readListing({ domains: [] }).mounted).toEqual([]);
  });

  it("never keeps a link that is not http or https", () => {
    const listing = readListing({
      domains: [],
      mounted: [
        { name: "a", source: "s", web_url: "javascript:alert(1)" },
        { name: "b", source: "s", web_url: "data:text/html,x" },
        { name: "c", source: "s", web_url: "http://kb.local/d/c" },
        { name: "d", source: "s", web_url: "https://user:pw@kb.local/d/d" },
        { name: "e", source: "s", web_url: "https://tok@kb.local/d/e" },
      ],
    });
    expect(listing.mounted.map((m) => m.webUrl)).toEqual([
      null,
      null,
      "http://kb.local/d/c",
      null,
      null,
    ]);
  });
});
