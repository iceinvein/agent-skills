import { afterAll, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..");
const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const PRIOR_INDEX = '[{"name":"stale","description":"old","type":"prompt","version":"0.0.1"}]\n';
const PRIOR_MARKETPLACE = '{"name":"iceinvein-skills","plugins":[]}\n';

const alpha = {
  name: "alpha",
  description: "Alpha skill.",
  type: "prompt",
  version: "1.0.0",
  author: "iceinvein",
  tools: ["claude"],
};

// build-index resolves the repo root from its own location, so a copy of the
// script writes into the tmp repo rather than the real one.
function repoWith(beta: Record<string, unknown>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "build-index-")));
  tempDirs.push(root);
  mkdirSync(join(root, "scripts"));
  cpSync(join(repoRoot, "scripts", "build-index.ts"), join(root, "scripts", "build-index.ts"));
  cpSync(join(repoRoot, "scripts", "marketplace.ts"), join(root, "scripts", "marketplace.ts"));
  for (const skill of [alpha, beta]) {
    mkdirSync(join(root, "skills", String(skill.name)), { recursive: true });
    writeFileSync(join(root, "skills", String(skill.name), "skill.json"), JSON.stringify(skill));
  }
  writeFileSync(join(root, "skills", "index.json"), PRIOR_INDEX);
  mkdirSync(join(root, ".claude-plugin"));
  writeFileSync(join(root, ".claude-plugin", "marketplace.json"), PRIOR_MARKETPLACE);
  return root;
}

function runBuildIndex(root: string) {
  const result = Bun.spawnSync(["bun", join(root, "scripts", "build-index.ts")], { cwd: root });
  return {
    exitCode: result.exitCode,
    stderr: result.stderr.toString(),
    index: readFileSync(join(root, "skills", "index.json"), "utf8"),
    marketplace: readFileSync(join(root, ".claude-plugin", "marketplace.json"), "utf8"),
  };
}

test("a skill.json without author exits 1 naming the skill and field, leaving both outputs untouched", () => {
  const { author: _, ...betaWithoutAuthor } = { ...alpha, name: "beta" };
  const run = runBuildIndex(repoWith(betaWithoutAuthor));
  expect(run.exitCode).toBe(1);
  expect(run.stderr).toContain("skills/beta/skill.json missing required field 'author'");
  expect(run.index).toBe(PRIOR_INDEX);
  expect(run.marketplace).toBe(PRIOR_MARKETPLACE);
});

test("a skill.json without tools exits 1 naming the field, leaving both outputs untouched", () => {
  const { tools: _, ...betaWithoutTools } = { ...alpha, name: "beta" };
  const run = runBuildIndex(repoWith(betaWithoutTools));
  expect(run.exitCode).toBe(1);
  expect(run.stderr).toContain("skills/beta/skill.json missing required field 'tools'");
  expect(run.index).toBe(PRIOR_INDEX);
  expect(run.marketplace).toBe(PRIOR_MARKETPLACE);
});

test("a valid set of skill.json files exits 0 and writes the marketplace", () => {
  const run = runBuildIndex(repoWith({ ...alpha, name: "beta", description: "Beta skill.", tools: ["codex"] }));
  expect(run.exitCode).toBe(0);
  expect(JSON.parse(run.marketplace)).toEqual({
    name: "iceinvein-skills",
    owner: { name: "iceinvein" },
    description: "Thinking frameworks from foundational software engineering texts, installed as skills for AI coding agents.",
    plugins: [
      {
        name: "alpha",
        source: "./skills/alpha",
        description: "Alpha skill.",
        version: "1.0.0",
        author: { name: "iceinvein" },
      },
    ],
  });
});
