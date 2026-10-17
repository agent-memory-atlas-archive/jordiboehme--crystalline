import { describe, expect, it } from "vitest";
import { STATUS_COLOURS, isStatusColour, statusColour } from "./directives";

describe("statusColour", () => {
  it("names the colour when the braces hold exactly one palette word", () => {
    expect(statusColour("blue")).toBe("blue");
    expect(statusColour("PURPLE")).toBe("purple");
    expect(statusColour(" green ")).toBe("green");
  });
  it("falls back to grey for no braces or anything else in them", () => {
    expect(statusColour(null)).toBe("grey");
    expect(statusColour("")).toBe("grey");
    expect(statusColour("orange")).toBe("grey");
    expect(statusColour("orange blue")).toBe("grey");
    expect(statusColour("blue green")).toBe("grey");
    expect(statusColour("red=1")).toBe("grey");
    expect(statusColour(".red")).toBe("grey");
  });
  it("names the palette the core lint names", () => {
    expect(STATUS_COLOURS).toEqual([
      "grey",
      "blue",
      "green",
      "yellow",
      "red",
      "purple",
    ]);
    expect(isStatusColour("red")).toBe(true);
    expect(isStatusColour("Red")).toBe(false);
    expect(isStatusColour(3)).toBe(false);
  });
});
