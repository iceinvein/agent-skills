import { readLockfile, writeLockfile } from "./lockfile";
import { fetchSkillManifest } from "./github";

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

type OutdatedSkill = {
  name: string;
  installed: string;
  latest: string;
};

export async function checkForUpdates(cwd: string): Promise<OutdatedSkill[]> {
  try {
    const lockfile = await readLockfile(cwd);
    const skillNames = Object.keys(lockfile.skills);

    if (skillNames.length === 0) return [];

    if (lockfile.lastUpdateCheck) {
      const lastCheck = new Date(lockfile.lastUpdateCheck).getTime();
      if (Date.now() - lastCheck < CHECK_INTERVAL_MS) return [];
    }

    const results = await Promise.all(
      skillNames.map(async (name) => {
        try {
          const result = await fetchSkillManifest(name);
          if (!result.ok) return null;
          const installed = lockfile.skills[name].version;
          if (result.manifest.version !== installed) {
            return { name, installed, latest: result.manifest.version };
          }
          return null;
        } catch {
          return null;
        }
      })
    );

    lockfile.lastUpdateCheck = new Date().toISOString();
    await writeLockfile(cwd, lockfile);

    return results.filter((r): r is OutdatedSkill => r !== null);
  } catch {
    return [];
  }
}
