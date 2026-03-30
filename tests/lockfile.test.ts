import { test, expect, beforeEach, afterEach } from "bun:test";
import { readLockfile, writeLockfile, addSkillToLockfile, removeSkillFromLockfile } from "../src/cli/lockfile";
import { rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const TMP = join(import.meta.dir, ".tmp-lockfile");

beforeEach(() => {
  mkdirSync(TMP, { recursive: true });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

test("readLockfile returns empty lockfile when file does not exist", async () => {
  const lock = await readLockfile(TMP);
  expect(lock).toEqual({ skills: {} });
});

test("writeLockfile creates lockfile and readLockfile reads it back", async () => {
  const lock = {
    skills: {
      "design-review": {
        version: "1.0.0",
        tools: ["claude" as const],
        installedAt: "2026-03-30T10:00:00Z",
        files: [".claude/skills/design-review/SKILL.md"],
      },
    },
  };
  await writeLockfile(TMP, lock);
  const result = await readLockfile(TMP);
  expect(result).toEqual(lock);
});

test("addSkillToLockfile adds entry to existing lockfile", async () => {
  await addSkillToLockfile(TMP, "design-review", {
    version: "1.0.0",
    tools: ["claude"],
    installedAt: "2026-03-30T10:00:00Z",
    files: [".claude/skills/design-review/SKILL.md"],
  });

  const lock = await readLockfile(TMP);
  expect(lock.skills["design-review"]).toBeDefined();
  expect(lock.skills["design-review"].version).toBe("1.0.0");
});

test("removeSkillFromLockfile removes entry", async () => {
  await addSkillToLockfile(TMP, "design-review", {
    version: "1.0.0",
    tools: ["claude"],
    installedAt: "2026-03-30T10:00:00Z",
    files: [".claude/skills/design-review/SKILL.md"],
  });

  await removeSkillFromLockfile(TMP, "design-review");
  const lock = await readLockfile(TMP);
  expect(lock.skills["design-review"]).toBeUndefined();
});
