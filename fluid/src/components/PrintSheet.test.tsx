import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PrintPageStyle, PrintTitleBlock } from "./PrintSheet";

afterEach(() => {
  vi.useRealTimers();
});

function page() {
  return render(
    <main>
      <PrintPageStyle
        source="eng"
        title="Alpha"
        address="crystalline://eng/alpha"
      />
      <PrintTitleBlock
        trail={["eng"]}
        title="Alpha"
        address="crystalline://eng/alpha"
      />
      <img alt="far down" loading="lazy" src="data:," />
    </main>,
  );
}

describe("the printed page's sheet", () => {
  it("reads the print date again as printing starts", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 16, 12));
    const { container } = page();
    const block = container.querySelector("header.print-title");
    const style = container.querySelector("style[data-print-page]");
    const opened = new Date(2026, 9, 16, 12).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    expect(block).toHaveTextContent(`Printed ${opened}`);

    // The tab stays open overnight and is printed the next day.
    vi.setSystemTime(new Date(2026, 9, 17, 9));
    const printed = new Date(2026, 9, 17, 9).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    act(() => {
      window.dispatchEvent(new Event("beforeprint"));
    });
    expect(block).toHaveTextContent(`Printed ${printed}`);
    expect(style?.textContent).toContain(`Printed ${printed}`);
  });

  it("loads the page's lazy pictures for the printer, and lets them be lazy again after", () => {
    const { container } = page();
    const image = container.querySelector("img");
    expect(image?.getAttribute("loading")).toBe("lazy");
    act(() => {
      window.dispatchEvent(new Event("beforeprint"));
    });
    expect(image?.getAttribute("loading")).toBe("eager");
    act(() => {
      window.dispatchEvent(new Event("afterprint"));
    });
    expect(image?.getAttribute("loading")).toBe("lazy");
  });
});
