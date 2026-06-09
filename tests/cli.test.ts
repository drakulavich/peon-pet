import { describe, test, expect } from "bun:test";
import { argValue, safeCharacter, safeCorner } from "../src/app/cli.ts";

describe("argValue", () => {
  test("returns the value after the flag", () => {
    expect(argValue(["bun", "main.ts", "--character", "dragon"], "--character")).toBe("dragon");
  });

  test("missing flag → undefined", () => {
    expect(argValue(["bun", "main.ts"], "--character")).toBeUndefined();
  });

  test("flag as the last arg (no value) → undefined", () => {
    expect(argValue(["bun", "main.ts", "--character"], "--character")).toBeUndefined();
  });

  test("a following flag is not consumed as the value", () => {
    expect(argValue(["bun", "main.ts", "--character", "--dev"], "--character")).toBeUndefined();
  });
});

describe("safeCharacter", () => {
  test.each(["orc", "dragon", "my-skin", "Orc2"])("accepts safe slug %s", (name) => {
    expect(safeCharacter(name)).toBe(name);
  });

  test.each(["../../etc", "a/b", "..", "/abs", "a\\b", "-leading", "", " spaced "])(
    "rejects unsafe name %p → undefined",
    (name) => {
      expect(safeCharacter(name)).toBeUndefined();
    },
  );

  test("undefined → undefined", () => {
    expect(safeCharacter(undefined)).toBeUndefined();
  });
});

describe("safeCorner", () => {
  test.each(["top-left", "top-right", "bottom-left", "bottom-right"] as const)("accepts %s", (c) => {
    expect(safeCorner(c)).toBe(c);
  });

  test.each(["center", "sideways", "TOP-LEFT", "", undefined])("rejects %p → undefined", (c) => {
    expect(safeCorner(c as string | undefined)).toBeUndefined();
  });
});
