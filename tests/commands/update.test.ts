// tests/commands/update.test.ts
import { test, expect, beforeEach, afterEach, mock } from "bun:test";
import { updateSkill } from "../../src/cli/commands/update";
import { installSkill } from "../../src/cli/commands/install";
import { readLockfile } from "../../src/cli/lockfile";
import { mkdirSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SkillManifest } from "../../src/cli/types";

const TMP = join(import.meta.dir, ".tmp-update");

beforeEach(() => {
  mkdirSync(join(TMP, ".claude"), { recursive: true });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

test("updateSkill re-installs with latest content", async () => {
  // Install v1
  const manifest: SkillManifest = {
    name: "design-review",
    version: "1.0.0",
    description: "Design review",
    author: "iceinvein",
    type: "prompt",
    tools: ["claude"],
    files: { prompt: "SKILL.md" },
    install: { claude: { prompt: ".claude/skills/design-review/SKILL.md" } },
  };
  await installSkill(TMP, manifest, new Map([["SKILL.md", "# V1"]]), ["claude"]);

  // Mock fetch to return v2
  const v2Manifest = { ...manifest, version: "2.0.0" };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock(async (url: string) => {
    if ((url as string).includes("skill.json")) {
      return new Response(JSON.stringify(v2Manifest), { status: 200 });
    }
    return new Response("# V2 Content", { status: 200 });
  }) as any;

  const result = await updateSkill(TMP, "design-review");
  expect(result.ok).toBe(true);

  const content = readFileSync(join(TMP, ".claude/skills/design-review/SKILL.md"), "utf-8");
  expect(content).toBe("# V2 Content");

  const lock = await readLockfile(TMP);
  expect(lock.skills["design-review"].version).toBe("2.0.0");

  globalThis.fetch = originalFetch;
});

test("updateSkill returns error for skill not in lockfile", async () => {
  const result = await updateSkill(TMP, "nonexistent");
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toContain("not installed");
});
