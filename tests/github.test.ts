import { test, expect, mock } from "bun:test";
import { buildRawUrl, fetchSkillManifest, fetchSkillFile } from "../src/cli/github";

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
