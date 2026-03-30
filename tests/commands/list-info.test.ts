import { test, expect, mock } from "bun:test";
import { listSkills } from "../../src/cli/commands/list";
import { infoSkill } from "../../src/cli/commands/info";

test("listSkills returns array of skill summaries", async () => {
  const index = [
    { name: "design-review", description: "Design review", type: "prompt", version: "1.0.0" },
    { name: "code-intelligence", description: "MCP server", type: "code", version: "1.0.0" },
  ];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock(async () =>
    new Response(JSON.stringify(index), { status: 200 })
  ) as any;

  const result = await listSkills();
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.skills.length).toBe(2);
    expect(result.skills[0].name).toBe("design-review");
  }

  globalThis.fetch = originalFetch;
});

test("infoSkill returns full manifest", async () => {
  const manifest = {
    name: "design-review",
    version: "1.0.0",
    description: "Design review",
    author: "iceinvein",
    type: "prompt",
    tools: ["claude", "cursor"],
    files: { prompt: "SKILL.md" },
    install: {},
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock(async () =>
    new Response(JSON.stringify(manifest), { status: 200 })
  ) as any;

  const result = await infoSkill("design-review");
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.manifest.name).toBe("design-review");
    expect(result.manifest.tools).toContain("claude");
  }

  globalThis.fetch = originalFetch;
});
