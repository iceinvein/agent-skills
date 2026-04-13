// tests/commands/update.test.ts
import { test, expect, beforeEach, afterEach, mock } from "bun:test";
import { updateSkill, updateAllSkills } from "../../src/cli/commands/update";
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

test("updateAllSkills updates all installed skills", async () => {
  const manifest1: SkillManifest = {
    name: "skill-a",
    version: "1.0.0",
    description: "Skill A",
    author: "iceinvein",
    type: "prompt",
    tools: ["claude"],
    files: { prompt: "SKILL.md" },
    install: { claude: { prompt: ".claude/skills/skill-a/SKILL.md" } },
  };
  const manifest2: SkillManifest = {
    name: "skill-b",
    version: "1.0.0",
    description: "Skill B",
    author: "iceinvein",
    type: "prompt",
    tools: ["claude"],
    files: { prompt: "SKILL.md" },
    install: { claude: { prompt: ".claude/skills/skill-b/SKILL.md" } },
  };
  await installSkill(TMP, manifest1, new Map([["SKILL.md", "# A v1"]]), ["claude"]);
  await installSkill(TMP, manifest2, new Map([["SKILL.md", "# B v1"]]), ["claude"]);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock(async (url: string) => {
    if ((url as string).includes("skill-a/skill.json")) {
      return new Response(JSON.stringify({ ...manifest1, version: "2.0.0" }), { status: 200 });
    }
    if ((url as string).includes("skill-b/skill.json")) {
      return new Response(JSON.stringify({ ...manifest2, version: "1.0.0" }), { status: 200 });
    }
    return new Response("# Updated", { status: 200 });
  }) as any;

  const results = await updateAllSkills(TMP);
  expect(results).toHaveLength(2);

  const a = results.find((r) => r.name === "skill-a")!;
  expect(a.ok).toBe(true);
  if (a.ok) {
    expect(a.from).toBe("1.0.0");
    expect(a.to).toBe("2.0.0");
  }

  const b = results.find((r) => r.name === "skill-b")!;
  expect(b.ok).toBe(true);
  if (b.ok) {
    expect(b.from).toBe("1.0.0");
    expect(b.to).toBe("1.0.0");
  }

  globalThis.fetch = originalFetch;
});

test("updateAllSkills returns empty array when no skills installed", async () => {
  const results = await updateAllSkills(TMP);
  expect(results).toEqual([]);
});

test("lockfile persists activation through install (baseline for update flow)", async () => {
  const manifest: SkillManifest = {
    name: "terse",
    version: "1.0.0",
    description: "Terse",
    author: "iceinvein",
    type: "prompt",
    tools: ["claude"],
    files: { prompt: "SKILL.md" },
    install: { claude: { prompt: ".claude/skills/terse/SKILL.md" } },
    activation: {
      modes: ["session", "global"],
      default: "session",
      claudeHookDirective: "Activate terse skill at tight level for this session.",
    },
  };
  const files = new Map([["SKILL.md", "# Terse"]]);

  await installSkill(TMP, manifest, files, ["claude"], "global");
  const lock = await readLockfile(TMP);
  expect(lock.skills["terse"].activation).toBe("global");
});
