// tests/commands/bump.test.ts
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { bumpSkill, bumpAllChanged } from "../../src/cli/commands/bump";

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

function git(args: string, cwd: string): string {
  const result = Bun.spawnSync(["git", "-c", "commit.gpgsign=false", ...args.split(" ")], { cwd });
  return result.stdout.toString().trim();
}

function setupGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "bump-git-test-"));

  git("init", dir);
  git("config user.email test@test.com", dir);
  git("config user.name Test", dir);

  // Create a skill and tag a release
  mkdirSync(join(dir, "skills", "terse"), { recursive: true });
  writeFileSync(
    join(dir, "skills", "terse", "skill.json"),
    JSON.stringify({ name: "terse", version: "1.0.0", description: "x", author: "x", type: "prompt", tools: ["claude"], install: {} }, null, 2)
  );
  writeFileSync(join(dir, "skills", "terse", "SKILL.md"), "# Terse v1");

  mkdirSync(join(dir, "skills", "other"), { recursive: true });
  writeFileSync(
    join(dir, "skills", "other", "skill.json"),
    JSON.stringify({ name: "other", version: "2.0.0", description: "x", author: "x", type: "prompt", tools: ["claude"], install: {} }, null, 2)
  );
  writeFileSync(join(dir, "skills", "other", "SKILL.md"), "# Other v1");

  git("add -A", dir);
  git("commit -m initial", dir);
  git("tag v0.1.0", dir);

  return dir;
}

test("bumpAllChanged bumps only skills with file changes", async () => {
  const dir = setupGitRepo();
  try {
    writeFileSync(join(dir, "skills", "terse", "SKILL.md"), "# Terse v2 — updated");
    git("add -A", dir);
    git("commit -m update-terse", dir);

    const results = await bumpAllChanged(dir, "patch", false);
    expect(results).toEqual([
      { name: "terse", ok: true, from: "1.0.0", to: "1.0.1" },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("bumpAllChanged skips skills already version-bumped", async () => {
  const dir = setupGitRepo();
  try {
    writeFileSync(join(dir, "skills", "terse", "SKILL.md"), "# Terse v2");
    const manifestPath = join(dir, "skills", "terse", "skill.json");
    const manifest = JSON.parse(await Bun.file(manifestPath).text());
    manifest.version = "1.0.1";
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    git("add -A", dir);
    git("commit -m bump-terse", dir);

    const results = await bumpAllChanged(dir, "patch", false);
    expect(results).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("bumpAllChanged dry-run does not write files", async () => {
  const dir = setupGitRepo();
  try {
    writeFileSync(join(dir, "skills", "terse", "SKILL.md"), "# Terse v2");
    git("add -A", dir);
    git("commit -m update-terse", dir);

    const results = await bumpAllChanged(dir, "patch", true);
    expect(results).toEqual([
      { name: "terse", ok: true, from: "1.0.0", to: "1.0.1" },
    ]);

    // Version should NOT have changed on disk
    const file = Bun.file(join(dir, "skills", "terse", "skill.json"));
    const data = await file.json();
    expect(data.version).toBe("1.0.0");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("bumpAllChanged with no tags treats all skills as changed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bump-notag-test-"));
  try {
    git("init", dir);
    git("config user.email test@test.com", dir);
    git("config user.name Test", dir);

    mkdirSync(join(dir, "skills", "terse"), { recursive: true });
    writeFileSync(
      join(dir, "skills", "terse", "skill.json"),
      JSON.stringify({ name: "terse", version: "1.0.0", description: "x", author: "x", type: "prompt", tools: ["claude"], install: {} }, null, 2)
    );
    writeFileSync(join(dir, "skills", "terse", "SKILL.md"), "# Terse");
    git("add -A", dir);
    git("commit -m initial", dir);

    const results = await bumpAllChanged(dir, "patch", false);
    expect(results).toEqual([
      { name: "terse", ok: true, from: "1.0.0", to: "1.0.1" },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
