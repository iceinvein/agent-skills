import { test, expect, afterAll } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const repoRoot = join(import.meta.dir, "..");
const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function makeTempDir(prefix: string): string {
  // The wrapper reports physical paths, and macOS tmpdir sits behind a symlink.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

// Only tracked files, so the copy looks like a fresh plugin install with no
// node_modules, whatever is lying around in the working tree.
function copyMagpieTrackedFiles(): string {
  const listing = Bun.spawnSync(["git", "ls-files", "skills/magpie"], { cwd: repoRoot });
  if (listing.exitCode !== 0) throw new Error(listing.stderr.toString());
  const root = makeTempDir("magpie-bin-");
  for (const path of listing.stdout.toString().split("\n").filter(Boolean)) {
    const dest = join(root, path.slice("skills/magpie/".length));
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(join(repoRoot, path), dest);
  }
  return root;
}

function runHelp(root: string, env: Record<string, string> = {}) {
  return Bun.spawnSync(["bash", join(root, "bin", "magpie"), "--help"], {
    cwd: root,
    env: { ...process.env, ...env },
  });
}

test(
  "magpie installs its runtime dependencies on first run when node_modules is missing",
  () => {
    const root = copyMagpieTrackedFiles();
    expect(existsSync(join(root, "node_modules"))).toBe(false);

    const result = runHelp(root);

    expect(result.exitCode).toBe(0);
    expect(existsSync(join(root, "node_modules", "shiki"))).toBe(true);
    expect(existsSync(join(root, "node_modules", ".magpie-deps-installed"))).toBe(true);
  },
  120_000,
);

test(
  "magpie skips the install when a previous install completed",
  () => {
    const root = copyMagpieTrackedFiles();
    mkdirSync(join(root, "node_modules"));
    const marker = join(root, "node_modules", ".magpie-deps-installed");
    writeFileSync(marker, "");
    const nodeModulesBefore = statSync(join(root, "node_modules")).mtimeMs;
    const markerBefore = statSync(marker).mtimeMs;

    const result = runHelp(root);

    expect(result.exitCode).toBe(0);
    expect(statSync(join(root, "node_modules")).mtimeMs).toBe(nodeModulesBefore);
    expect(statSync(marker).mtimeMs).toBe(markerBefore);
  },
  120_000,
);

test(
  "magpie retries the install on the next run after a failed install",
  () => {
    const root = copyMagpieTrackedFiles();
    // Port 9 is discard; an empty cache means nothing can be served locally.
    const offline = {
      NPM_CONFIG_REGISTRY: "http://127.0.0.1:9/",
      BUN_INSTALL_CACHE_DIR: makeTempDir("magpie-bun-cache-"),
    };

    const first = runHelp(root, offline);
    expect(first.exitCode).not.toBe(0);
    expect(first.stderr.toString()).toContain(`bun install failed in ${root}`);
    expect(first.stdout.toString()).toBe("");

    const second = runHelp(root, offline);
    expect(second.exitCode).not.toBe(0);
    expect(second.stderr.toString()).toContain(`bun install failed in ${root}`);
    expect(second.stdout.toString()).toBe("");
  },
  120_000,
);

// MAGPIE_BIN_DIR keeps install.sh away from the real /usr/local/bin and
// ~/.local/bin, which it would otherwise relink into this throwaway copy. HOME
// is a tmpdir too, so a break in that branch still cannot reach ~/.local/bin.
function runInstall(root: string, binDir: string, cwd: string = root) {
  return Bun.spawnSync(["bash", join(root, "install.sh")], {
    cwd,
    env: { ...process.env, HOME: makeTempDir("magpie-home-"), MAGPIE_BIN_DIR: binDir },
  });
}

test(
  "magpie skips the first-run install after install.sh has installed its dependencies",
  () => {
    const root = copyMagpieTrackedFiles();
    const install = runInstall(root, makeTempDir("magpie-bindir-"));
    expect(install.exitCode).toBe(0);

    const result = runHelp(root);

    expect(result.exitCode).toBe(0);
    expect(result.stderr.toString()).not.toContain("Installing magpie runtime dependencies");
    expect(existsSync(join(root, "node_modules", ".magpie-deps-installed"))).toBe(true);
  },
  120_000,
);

test(
  "install.sh links the CLI into MAGPIE_BIN_DIR and records that path",
  () => {
    const root = copyMagpieTrackedFiles();
    const binDir = join(makeTempDir("magpie-bindir-"), "not-yet-created");

    const install = runInstall(root, binDir);

    expect(install.exitCode).toBe(0);
    expect(readlinkSync(join(binDir, "magpie"))).toBe(join(root, "bin", "magpie"));
    expect(readFileSync(join(root, ".installed-cli-path"), "utf8")).toBe(`${join(binDir, "magpie")}\n`);
  },
  120_000,
);

test(
  "install.sh records a relative MAGPIE_BIN_DIR as an absolute path",
  () => {
    const root = copyMagpieTrackedFiles();
    const parent = makeTempDir("magpie-cwd-");

    const install = runInstall(root, "relative-bin", parent);

    expect(install.exitCode).toBe(0);
    expect(readFileSync(join(root, ".installed-cli-path"), "utf8")).toBe(`${join(parent, "relative-bin", "magpie")}\n`);
  },
  120_000,
);
