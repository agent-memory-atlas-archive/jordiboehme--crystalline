/**
 * The outline of a long page: nothing below three `##` sections, a link per
 * heading otherwise, and the section being read marked while scrolling.
 */

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { headingSlug } from "../anchors";
import { PageOutline } from "./PageOutline";
import type { OutlineHeading } from "./PageOutline";

type Callback = (entries: Partial<IntersectionObserverEntry>[]) => void;
let callback: Callback = () => undefined;

beforeEach(() => {
  class FakeObserver {
    constructor(cb: Callback) {
      callback = cb;
    }
    observe() {}
    disconnect() {}
    unobserve() {}
  }
  vi.stubGlobal("IntersectionObserver", FakeObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

function headings(texts: [string, 2 | 3][]): OutlineHeading[] {
  return texts.map(([text, level]) => ({ id: headingSlug(text), text, level }));
}

describe("PageOutline", () => {
  it("links three sections and their subsections by the anchor slugs", () => {
    render(
      <PageOutline
        headings={headings([
          ["Setup", 2],
          ["Install steps", 3],
          ["Usage", 2],
          ["Limits", 2],
        ])}
      />,
    );
    const nav = screen.getByRole("navigation", { name: "On this page" });
    const links = nav.querySelectorAll("a");
    expect(Array.from(links).map((a) => a.getAttribute("href"))).toEqual([
      "#setup",
      "#install-steps",
      "#usage",
      "#limits",
    ]);
  });

  it("draws nothing below three sections", () => {
    const { container } = render(
      <PageOutline
        headings={headings([
          ["Setup", 2],
          ["Usage", 2],
          ["Detail", 3],
        ])}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("marks the section that scrolled into view", () => {
    const list = headings([
      ["Setup", 2],
      ["Usage", 2],
      ["Limits", 2],
    ]);
    for (const h of list) {
      const el = document.createElement("h2");
      el.id = h.id;
      document.body.append(el);
    }
    render(<PageOutline headings={list} />);
    expect(document.querySelector("[aria-current]")).toBeNull();
    act(() => {
      callback([
        {
          isIntersecting: true,
          target: document.getElementById("usage") as Element,
        },
      ]);
    });
    const current = document.querySelectorAll("a[aria-current=location]");
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent).toBe("Usage");
  });
});
