import { test, expect } from "bun:test";
import { bumpVersion } from "../src/cli/semver";

test("bumpVersion bumps patch", () => {
  expect(bumpVersion("1.0.0", "patch")).toBe("1.0.1");
});

test("bumpVersion bumps minor and resets patch", () => {
  expect(bumpVersion("1.2.3", "minor")).toBe("1.3.0");
});

test("bumpVersion bumps major and resets minor and patch", () => {
  expect(bumpVersion("1.2.3", "major")).toBe("2.0.0");
});

test("bumpVersion handles zero version", () => {
  expect(bumpVersion("0.0.0", "patch")).toBe("0.0.1");
});

test("bumpVersion throws on malformed version", () => {
  expect(() => bumpVersion("not-a-version", "patch")).toThrow();
});

test("bumpVersion throws on incomplete version", () => {
  expect(() => bumpVersion("1.0", "patch")).toThrow();
});
