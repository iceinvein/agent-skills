import { test, expect, mock } from "bun:test";
import {
  buildRawUrl,
  fetchSkillManifest,
  fetchSkillFile,
  fetchSkillTree,
  resolveBundlePaths,
  type TreeEntry,
} from "../src/cli/github";

const REPO = "iceinvein/agent-skills";
const BRANCH = "master";

test("buildRawUrl constructs correct GitHub raw URL", () => {
  const url = buildRawUrl("design-review", "skill.json");
  expect(url).toBe(
    `https://raw.githubusercontent.com/${REPO}/${BRANCH}/skills/design-review/skill.json`
  );
});

test("buildRawUrl handles nested paths", () => {
  const url = buildRawUrl("codebase-architecture", "patterns-reference.md");
  expect(url).toBe(
    `https://raw.githubusercontent.com/${REPO}/${BRANCH}/skills/codebase-architecture/patterns-reference.md`
  );
});

test("fetchSkillManifest returns parsed manifest for valid skill", async () => {
  const fakeManifest = {
    name: "test",
    version: "1.0.0",
    description: "test",
    author: "iceinvein",
    type: "prompt",
    tools: ["claude"],
    install: {},
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock(async () =>
    new Response(JSON.stringify(fakeManifest), { status: 200 })
  ) as any;

  const result = await fetchSkillManifest("test");
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.manifest.name).toBe("test");

  globalThis.fetch = originalFetch;
});

test("fetchSkillManifest returns error for 404", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock(async () =>
    new Response("Not Found", { status: 404 })
  ) as any;

  const result = await fetchSkillManifest("nonexistent");
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toContain("not found");

  globalThis.fetch = originalFetch;
});

test("fetchSkillFile returns file content", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock(async () =>
    new Response("# Skill content", { status: 200 })
  ) as any;

  const result = await fetchSkillFile("test", "SKILL.md");
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.content).toBe("# Skill content");

  globalThis.fetch = originalFetch;
});

test("fetchSkillTree returns entries scoped to the skill directory", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock(async () =>
    new Response(
      JSON.stringify({
        tree: [
          { path: "skills/magpie/SKILL.md", type: "blob" },
          { path: "skills/magpie/bin", type: "tree" },
          { path: "skills/magpie/bin/magpie", type: "blob" },
          { path: "skills/other/SKILL.md", type: "blob" },
          { path: "src/cli/index.ts", type: "blob" },
        ],
        truncated: false,
      }),
      { status: 200 }
    )
  ) as any;

  const result = await fetchSkillTree("magpie");
  expect(result.ok).toBe(true);
  if (result.ok) {
    const paths = result.entries.map((e) => e.path);
    expect(paths).toContain("SKILL.md");
    expect(paths).toContain("bin/magpie");
    expect(paths).toContain("bin");
    expect(paths).not.toContain("skills/other/SKILL.md");
  }

  globalThis.fetch = originalFetch;
});

test("fetchSkillTree fails when GitHub truncates the response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock(async () =>
    new Response(JSON.stringify({ tree: [], truncated: true }), { status: 200 })
  ) as any;

  const result = await fetchSkillTree("magpie");
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toContain("truncated");

  globalThis.fetch = originalFetch;
});

test("resolveBundlePaths expands directories and respects excludes", () => {
  const entries: TreeEntry[] = [
    { path: "bin", type: "tree" },
    { path: "bin/magpie", type: "blob" },
    { path: "scripts", type: "tree" },
    { path: "scripts/run.ts", type: "blob" },
    { path: "scripts/__tests__", type: "tree" },
    { path: "scripts/__tests__/run.test.ts", type: "blob" },
    { path: "install.sh", type: "blob" },
    { path: "README.md", type: "blob" },
  ];

  const paths = resolveBundlePaths(entries, {
    include: ["bin", "scripts", "install.sh"],
    exclude: ["scripts/__tests__/"],
  });

  expect(paths).toEqual(["bin/magpie", "install.sh", "scripts/run.ts"]);
});

test("resolveBundlePaths deduplicates overlapping includes", () => {
  const entries: TreeEntry[] = [
    { path: "bin", type: "tree" },
    { path: "bin/magpie", type: "blob" },
  ];

  const paths = resolveBundlePaths(entries, { include: ["bin", "bin/magpie"] });
  expect(paths).toEqual(["bin/magpie"]);
});
