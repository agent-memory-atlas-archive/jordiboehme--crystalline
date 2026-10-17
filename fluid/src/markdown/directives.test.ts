import { describe, expect, it } from "vitest";
import { STATUS_COLOURS, statusColour } from "./directives";

describe("statusColour", () => {
  it("takes the first attribute key in the palette, without regard to case", () => {
    expect(statusColour({ blue: "" })).toBe("blue");
    expect(statusColour({ PURPLE: "" })).toBe("purple");
    expect(statusColour({ red: "", green: "" })).toBe("red");
  });
  it("falls back to grey for no braces or an unknown colour", () => {
    expect(statusColour(undefined)).toBe("grey");
    expect(statusColour({})).toBe("grey");
    expect(statusColour({ orange: "" })).toBe("grey");
    expect(statusColour({ class: "red" })).toBe("grey");
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
  });
});
