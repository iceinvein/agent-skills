import { test, expect, beforeEach, afterEach, mock } from "bun:test";
import { checkForUpdates } from "../src/cli/update-check";
import { writeLockfile } from "../src/cli/lockfile";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const TMP = join(import.meta.dir, ".tmp-update-check");

beforeEach(() => {
  mkdirSync(TMP, { recursive: true });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

test("checkForUpdates returns empty array when no skills installed", async () => {
  const result = await checkForUpdates(TMP);
  expect(result).toEqual([]);
});

test("checkForUpdates skips check if lastUpdateCheck within 24h", async () => {
  await writeLockfile(TMP, {
    lastUpdateCheck: new Date().toISOString(),
    skills: {
      terse: {
        version: "1.0.0",
        tools: ["claude"],
        installedAt: "2026-04-11T10:00:00Z",
        files: [".claude/skills/terse/SKILL.md"],
      },
    },
  });

  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = mock(async () => {
    fetchCalled = true;
    return new Response("{}", { status: 200 });
  }) as any;

  const result = await checkForUpdates(TMP);
  expect(result).toEqual([]);
  expect(fetchCalled).toBe(false);

  globalThis.fetch = originalFetch;
});

test("checkForUpdates returns outdated skills", async () => {
  const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  await writeLockfile(TMP, {
    lastUpdateCheck: yesterday,
    skills: {
      terse: {
        version: "1.0.0",
        tools: ["claude"],
        installedAt: "2026-04-10T10:00:00Z",
        files: [".claude/skills/terse/SKILL.md"],
      },
    },
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock(async () => {
    return new Response(
      JSON.stringify({
        name: "terse",
        version: "1.1.0",
        description: "test",
        author: "test",
        type: "prompt",
        tools: ["claude"],
        install: { claude: { prompt: "SKILL.md" } },
      }),
      { status: 200 }
    );
  }) as any;

  const result = await checkForUpdates(TMP);
  expect(result).toEqual([{ name: "terse", installed: "1.0.0", latest: "1.1.0" }]);

  globalThis.fetch = originalFetch;
});

test("checkForUpdates silently handles fetch errors", async () => {
  const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  await writeLockfile(TMP, {
    lastUpdateCheck: yesterday,
    skills: {
      terse: {
        version: "1.0.0",
        tools: ["claude"],
        installedAt: "2026-04-10T10:00:00Z",
        files: [".claude/skills/terse/SKILL.md"],
      },
    },
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock(async () => {
    throw new Error("Network error");
  }) as any;

  const result = await checkForUpdates(TMP);
  expect(result).toEqual([]);

  globalThis.fetch = originalFetch;
});

test("checkForUpdates excludes up-to-date skills", async () => {
  const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  await writeLockfile(TMP, {
    lastUpdateCheck: yesterday,
    skills: {
      terse: {
        version: "1.0.0",
        tools: ["claude"],
        installedAt: "2026-04-10T10:00:00Z",
        files: [".claude/skills/terse/SKILL.md"],
      },
    },
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock(async () => {
    return new Response(
      JSON.stringify({
        name: "terse",
        version: "1.0.0",
        description: "test",
        author: "test",
        type: "prompt",
        tools: ["claude"],
        install: { claude: { prompt: "SKILL.md" } },
      }),
      { status: 200 }
    );
  }) as any;

  const result = await checkForUpdates(TMP);
  expect(result).toEqual([]);

  globalThis.fetch = originalFetch;
});
