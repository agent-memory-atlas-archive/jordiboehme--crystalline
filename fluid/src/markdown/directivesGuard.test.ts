import { describe, expect, it, vi } from "vitest";

// A remark-directive that adds its syntax in another shape: the guard must
// fail loudly instead of treating some other extension as the directive one.
vi.mock("remark-directive", () => ({
  default: function changed(this: {
    data(): { micromarkExtensions?: unknown[] };
  }) {
    const data = this.data();
    data.micromarkExtensions = [
      ...(data.micromarkExtensions ?? []),
      { flow: {} },
      { text: {} },
    ];
  },
}));

const { remarkStatusSyntax } = await import("./directives");

describe("remarkStatusSyntax with a changed dependency", () => {
  it("throws rather than guess which extension is the directive one", () => {
    const store = {};
    expect(() => remarkStatusSyntax.call({ data: () => store })).toThrow(
      /remark-directive no longer adds one text construct/,
    );
  });
});
