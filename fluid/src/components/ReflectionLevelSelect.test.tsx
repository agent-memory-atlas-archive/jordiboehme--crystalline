import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  ReflectionLevelSelect,
  curates,
  levelsFor,
  raiseForNone,
} from "./ReflectionLevelSelect";

describe("the Reflection level beside a knowledge level", () => {
  it("is implied for every knowledge editor and above", () => {
    expect(["editor", "manager", "admin"].map(curates)).toEqual([
      true,
      true,
      true,
    ]);
    expect(["none", "viewer"].map(curates)).toEqual([false, false]);
    render(
      <ReflectionLevelSelect
        label="Reflection for ed"
        knowledge="editor"
        value="default"
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText("curator")).toBeVisible();
    expect(
      screen.queryByRole("combobox", { name: "Reflection for ed" }),
    ).toBeNull();
  });

  it("never offers nothing at all to knowledge none", () => {
    expect(levelsFor("viewer")).toEqual(["default", "reader", "contributor"]);
    expect(levelsFor("none")).toEqual(["reader", "contributor"]);
    expect(raiseForNone("none", "default")).toBe("reader");
    expect(raiseForNone("none", "contributor")).toBe("contributor");
    expect(raiseForNone("viewer", "default")).toBe("default");
  });

  it("names its options in plain words and reports a choice", async () => {
    const onChange = vi.fn();
    render(
      <ReflectionLevelSelect
        label="Reflection for mem"
        knowledge="viewer"
        value="default"
        onChange={onChange}
      />,
    );
    const select = screen.getByRole("combobox", { name: "Reflection for mem" });
    expect(
      [...select.querySelectorAll("option")].map((o) => o.textContent),
    ).toEqual(["as knowledge", "reader", "contributor"]);
    await userEvent.selectOptions(select, "contributor");
    expect(onChange).toHaveBeenCalledWith("contributor");
  });
});
