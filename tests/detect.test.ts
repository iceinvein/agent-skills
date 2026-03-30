import { test, expect, beforeEach, afterEach } from "bun:test";
import { detectTools } from "../src/cli/detect";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TMP = join(import.meta.dir, ".tmp-detect");

beforeEach(() => {
  mkdirSync(TMP, { recursive: true });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

test("detects Claude Code when .claude/ exists", async () => {
  mkdirSync(join(TMP, ".claude"), { recursive: true });
  const tools = await detectTools(TMP);
  expect(tools).toContain("claude");
});

test("detects Cursor when .cursor/ exists", async () => {
  mkdirSync(join(TMP, ".cursor"), { recursive: true });
  const tools = await detectTools(TMP);
  expect(tools).toContain("cursor");
});

test("detects Codex when AGENTS.md exists", async () => {
  writeFileSync(join(TMP, "AGENTS.md"), "# Agents");
  const tools = await detectTools(TMP);
  expect(tools).toContain("codex");
});

test("detects Gemini CLI when .gemini/ exists", async () => {
  mkdirSync(join(TMP, ".gemini"), { recursive: true });
  const tools = await detectTools(TMP);
  expect(tools).toContain("gemini");
});

test("detects multiple tools", async () => {
  mkdirSync(join(TMP, ".claude"), { recursive: true });
  mkdirSync(join(TMP, ".cursor"), { recursive: true });
  const tools = await detectTools(TMP);
  expect(tools).toContain("claude");
  expect(tools).toContain("cursor");
  expect(tools.length).toBe(2);
});

test("returns empty array when no tools detected", async () => {
  const tools = await detectTools(TMP);
  expect(tools).toEqual([]);
});
