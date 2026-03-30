import { test, expect, beforeEach, afterEach } from "bun:test";
import { geminiAdapter } from "../../src/cli/adapters/gemini";
import { mkdirSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SkillManifest } from "../../src/cli/types";

const TMP = join(import.meta.dir, ".tmp-gemini");

beforeEach(() => {
  mkdirSync(join(TMP, ".gemini"), { recursive: true });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

const promptManifest: SkillManifest = {
  name: "design-review",
  version: "1.0.0",
  description: "Design review",
  author: "iceinvein",
  type: "prompt",
  tools: ["gemini"],
  files: { prompt: "SKILL.md" },
  install: {
    gemini: { prompt: ".gemini/skills/design-review.md" },
  },
};

test("install copies prompt file to .gemini/skills/", async () => {
  const files = new Map([["SKILL.md", "# Design Review"]]);
  const installed = await geminiAdapter.install(TMP, promptManifest, files);

  const content = readFileSync(join(TMP, ".gemini/skills/design-review.md"), "utf-8");
  expect(content).toBe("# Design Review");
  expect(installed).toContain(".gemini/skills/design-review.md");
});

test("remove deletes prompt file", async () => {
  const files = new Map([["SKILL.md", "# Content"]]);
  await geminiAdapter.install(TMP, promptManifest, files);
  await geminiAdapter.remove(TMP, promptManifest, [".gemini/skills/design-review.md"]);

  const exists = await Bun.file(join(TMP, ".gemini/skills/design-review.md")).exists();
  expect(exists).toBe(false);
});
