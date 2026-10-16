/**
 * Warming a lazy screen: started once, retried only after a failure, and
 * never a problem for the caller.
 */

import { describe, expect, it, vi } from "vitest";

import { PREFETCH, warm } from "./prefetch";

const loaded = vi.hoisted(() => ({ search: 0 }));

vi.mock("./screens/Search", () => {
  loaded.search += 1;
  return { default: () => null };
});

describe("warm", () => {
  it("calls the loader once however often it is asked", () => {
    const load = vi.fn(() => Promise.resolve({}));
    warm("once", load);
    warm("once", load);
    warm("once", load);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("tries again after a failed load, and swallows the failure", async () => {
    const load = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValue({});
    warm("retry", load);
    await Promise.resolve();
    await Promise.resolve();
    warm("retry", load);
    expect(load).toHaveBeenCalledTimes(2);
    warm("retry", load);
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe("PREFETCH", () => {
  it("starts the chunk on pointer enter and on focus, once", async () => {
    expect(loaded.search).toBe(0);
    PREFETCH.search.onPointerEnter();
    PREFETCH.search.onFocus();
    PREFETCH.search.onPointerEnter();
    await vi.waitFor(() => {
      expect(loaded.search).toBe(1);
    });
  });
});
