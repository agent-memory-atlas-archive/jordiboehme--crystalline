import { describe, expect, it } from "vitest";

import { tickAt } from "./taskTick";

describe("tickAt", () => {
  it("flips one box and nothing else", () => {
    const text = "- [ ] a\n- [x] b\n- [~] c\n";
    expect(tickAt(text, 2, "[x]")).toBe("- [x] a\n- [x] b\n- [~] c\n");
    expect(tickAt(text, 10, "[ ]")).toBe("- [ ] a\n- [ ] b\n- [~] c\n");
    expect(tickAt(text, 18, "[x]")).toBeNull(); // not applicable never toggles
    expect(tickAt(text, 0, "[x]")).toBeNull();
  });

  it("reads a capital X as done and keeps CRLF line endings", () => {
    const text = "- [X] a\r\n- [ ] b\r\n";
    expect(tickAt(text, 2, "[ ]")).toBe("- [ ] a\r\n- [ ] b\r\n");
    expect(tickAt(text, 11, "[x]")).toBe("- [X] a\r\n- [x] b\r\n");
  });

  it("refuses an offset outside the text", () => {
    expect(tickAt("- [ ] a", -1, "[x]")).toBeNull();
    expect(tickAt("- [ ] a", 6, "[x]")).toBeNull();
  });
});
