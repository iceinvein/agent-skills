import { join } from "node:path";
import type { Lockfile, LockfileEntry } from "./types";

const LOCKFILE_NAME = ".agent-skills.lock";

export async function readLockfile(cwd: string): Promise<Lockfile> {
  const path = join(cwd, LOCKFILE_NAME);
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return { skills: {} };
  }
  return file.json();
}

export async function writeLockfile(cwd: string, lockfile: Lockfile): Promise<void> {
  const path = join(cwd, LOCKFILE_NAME);
  await Bun.write(path, JSON.stringify(lockfile, null, 2) + "\n");
}

export async function addSkillToLockfile(
  cwd: string,
  skillName: string,
  entry: LockfileEntry
): Promise<void> {
  const lockfile = await readLockfile(cwd);
  lockfile.skills[skillName] = entry;
  await writeLockfile(cwd, lockfile);
}

export async function removeSkillFromLockfile(
  cwd: string,
  skillName: string
): Promise<void> {
  const lockfile = await readLockfile(cwd);
  delete lockfile.skills[skillName];
  await writeLockfile(cwd, lockfile);
}
