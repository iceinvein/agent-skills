import { test, expect } from "bun:test";
import { parseArgs } from "../src/cli/index";

test("parseArgs parses install command", () => {
  const result = parseArgs(["install", "design-review"]);
  expect(result).toEqual({ command: "install", args: ["design-review"], flags: {} });
});

test("parseArgs parses install with --tool flag", () => {
  const result = parseArgs(["install", "design-review", "--tool", "claude"]);
  expect(result).toEqual({ command: "install", args: ["design-review"], flags: { tool: "claude" } });
});

test("parseArgs parses list command", () => {
  const result = parseArgs(["list"]);
  expect(result).toEqual({ command: "list", args: [], flags: {} });
});

test("parseArgs parses remove command", () => {
  const result = parseArgs(["remove", "design-review"]);
  expect(result).toEqual({ command: "remove", args: ["design-review"], flags: {} });
});

test("parseArgs parses info command", () => {
  const result = parseArgs(["info", "design-review"]);
  expect(result).toEqual({ command: "info", args: ["design-review"], flags: {} });
});

test("parseArgs parses update command", () => {
  const result = parseArgs(["update", "design-review"]);
  expect(result).toEqual({ command: "update", args: ["design-review"], flags: {} });
});

test("parseArgs returns help for no args", () => {
  const result = parseArgs([]);
  expect(result).toEqual({ command: "help", args: [], flags: {} });
});
