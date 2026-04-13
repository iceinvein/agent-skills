// tests/commands/bump.test.ts
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { bumpSkill } from "../../src/cli/commands/bump";

let repoRoot: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), "bump-test-"));
  mkdirSync(join(repoRoot, "skills", "terse"), { recursive: true });
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

function writeSkillJson(skillName: string, version: string) {
  const manifest = {
    name: skillName,
    version,
    description: "Test skill",
    author: "test",
    type: "prompt",
    tools: ["claude"],
    files: { prompt: "SKILL.md" },
    install: { claude: { prompt: `.claude/skills/${skillName}/SKILL.md` } },
  };
  writeFileSync(
    join(repoRoot, "skills", skillName, "skill.json"),
    JSON.stringify(manifest, null, 2)
  );
}

async function readSkillVersion(skillName: string): Promise<string> {
  const file = Bun.file(join(repoRoot, "skills", skillName, "skill.json"));
  const data = await file.json();
  return data.version;
}

test("bumpSkill bumps patch by default", async () => {
  writeSkillJson("terse", "1.0.0");
  const result = await bumpSkill(repoRoot, "terse", "patch");
  expect(result).toEqual({ ok: true, from: "1.0.0", to: "1.0.1" });
  expect(await readSkillVersion("terse")).toBe("1.0.1");
});

test("bumpSkill bumps minor", async () => {
  writeSkillJson("terse", "1.0.0");
  const result = await bumpSkill(repoRoot, "terse", "minor");
  expect(result).toEqual({ ok: true, from: "1.0.0", to: "1.1.0" });
  expect(await readSkillVersion("terse")).toBe("1.1.0");
});

test("bumpSkill bumps major", async () => {
  writeSkillJson("terse", "1.2.3");
  const result = await bumpSkill(repoRoot, "terse", "major");
  expect(result).toEqual({ ok: true, from: "1.2.3", to: "2.0.0" });
});

test("bumpSkill errors for nonexistent skill", async () => {
  const result = await bumpSkill(repoRoot, "nonexistent", "patch");
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toContain("nonexistent");
});

test("bumpSkill preserves other manifest fields", async () => {
  writeSkillJson("terse", "1.0.0");
  await bumpSkill(repoRoot, "terse", "patch");
  const file = Bun.file(join(repoRoot, "skills", "terse", "skill.json"));
  const data = await file.json();
  expect(data.name).toBe("terse");
  expect(data.description).toBe("Test skill");
  expect(data.version).toBe("1.0.1");
});
