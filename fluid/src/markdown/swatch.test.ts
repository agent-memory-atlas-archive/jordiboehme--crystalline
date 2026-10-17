import { describe, expect, it } from "vitest";
import { colourOf } from "./swatch";

describe("colourOf", () => {
  it("answers a colour code alone in the span", () => {
    for (const code of [
      "#0969DA",
      "#09f",
      "#09f8",
      "#0969DA80",
      "rgb(9, 105, 218)",
      "rgba(9,105,218,0.5)",
      "hsl(212, 92%, 45%)",
      " #09f ",
    ]) {
      expect(colourOf(code)).toBe(code.trim());
    }
  });
  it("refuses everything else", () => {
    for (const code of [
      "#define",
      "#12",
      "#12345",
      "color: #09f",
      "rgb(9, 105)",
      "rgb(300, 0, 0)",
      "hsl(212, 120%, 45%)",
      "red",
      "",
    ]) {
      expect(colourOf(code)).toBeNull();
    }
  });
});
