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

test("parseArgs parses install with multiple skill names", () => {
  const result = parseArgs(["install", "design-review", "terse", "code-intelligence"]);
  expect(result.command).toBe("install");
  expect(result.args).toEqual(["design-review", "terse", "code-intelligence"]);
  expect(result.flags).toEqual({});
});

test("parseArgs parses install with multiple skills and trailing flag", () => {
  const result = parseArgs(["install", "a", "b", "--tool", "claude", "-g"]);
  expect(result.args).toEqual(["a", "b"]);
  expect(result.flags).toEqual({ tool: "claude", global: "true" });
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

test("parseArgs parses --global flag", () => {
  const result = parseArgs(["install", "design-review", "--global"]);
  expect(result).toEqual({ command: "install", args: ["design-review"], flags: { global: "true" } });
});

test("parseArgs parses -g shorthand", () => {
  const result = parseArgs(["install", "design-review", "-g"]);
  expect(result).toEqual({ command: "install", args: ["design-review"], flags: { global: "true" } });
});

test("parseArgs parses --global with --tool", () => {
  const result = parseArgs(["install", "design-review", "--global", "--tool", "claude"]);
  expect(result).toEqual({ command: "install", args: ["design-review"], flags: { global: "true", tool: "claude" } });
});

test("parseArgs parses update --all", () => {
  const result = parseArgs(["update", "--all"]);
  expect(result).toEqual({ command: "update", args: [], flags: { all: "true" } });
});

test("parseArgs parses update --all -g", () => {
  const result = parseArgs(["update", "--all", "-g"]);
  expect(result).toEqual({ command: "update", args: [], flags: { all: "true", global: "true" } });
});

test("parseArgs parses bump command with skill name", () => {
  const result = parseArgs(["bump", "terse"]);
  expect(result).toEqual({ command: "bump", args: ["terse"], flags: {} });
});

test("parseArgs parses bump with level arg", () => {
  const result = parseArgs(["bump", "terse", "minor"]);
  expect(result).toEqual({ command: "bump", args: ["terse", "minor"], flags: {} });
});

test("parseArgs parses bump --all", () => {
  const result = parseArgs(["bump", "--all"]);
  expect(result).toEqual({ command: "bump", args: [], flags: { all: "true" } });
});

test("parseArgs parses bump --all with level", () => {
  const result = parseArgs(["bump", "--all", "minor"]);
  expect(result).toEqual({ command: "bump", args: ["minor"], flags: { all: "true" } });
});

test("parseArgs parses bump --all --dry-run", () => {
  const result = parseArgs(["bump", "--all", "--dry-run"]);
  expect(result).toEqual({ command: "bump", args: [], flags: { all: "true", "dry-run": "true" } });
});

test("parseArgs captures --activation value", () => {
  const result = parseArgs(["install", "terse", "--activation", "global"]);
  expect(result.command).toBe("install");
  expect(result.args).toEqual(["terse"]);
  expect(result.flags.activation).toBe("global");
});

test("parseArgs captures --activation session", () => {
  const result = parseArgs(["install", "terse", "--activation", "session"]);
  expect(result.flags.activation).toBe("session");
});

test("parseArgs handles install without --activation", () => {
  const result = parseArgs(["install", "terse"]);
  expect(result.flags.activation).toBeUndefined();
});
