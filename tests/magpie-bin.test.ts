import { test, expect } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const repoRoot = join(import.meta.dir, "..");

// Only tracked files, so the copy looks like a fresh plugin install with no
// node_modules, whatever is lying around in the working tree.
function copyMagpieTrackedFiles(): string {
  const listing = Bun.spawnSync(["git", "ls-files", "skills/magpie"], { cwd: repoRoot });
  if (listing.exitCode !== 0) throw new Error(listing.stderr.toString());
  const root = mkdtempSync(join(tmpdir(), "magpie-bin-"));
  for (const path of listing.stdout.toString().split("\n").filter(Boolean)) {
    const dest = join(root, path.slice("skills/magpie/".length));
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(join(repoRoot, path), dest);
  }
  return root;
}

function runHelp(root: string) {
  return Bun.spawnSync(["bash", join(root, "bin", "magpie"), "--help"], { cwd: root });
}

test(
  "magpie installs its runtime dependencies on first run when node_modules is missing",
  () => {
    const root = copyMagpieTrackedFiles();
    expect(existsSync(join(root, "node_modules"))).toBe(false);

    const result = runHelp(root);

    expect(result.exitCode).toBe(0);
    expect(existsSync(join(root, "node_modules", "shiki"))).toBe(true);
  },
  120_000,
);

test(
  "magpie leaves an existing node_modules untouched",
  () => {
    const root = copyMagpieTrackedFiles();
    mkdirSync(join(root, "node_modules"));
    const before = statSync(join(root, "node_modules")).mtimeMs;

    const result = runHelp(root);

    expect(result.exitCode).toBe(0);
    expect(statSync(join(root, "node_modules")).mtimeMs).toBe(before);
  },
  120_000,
);
