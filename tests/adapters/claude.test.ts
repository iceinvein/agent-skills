import { test, expect, beforeEach, afterEach } from "bun:test";
import { claudeAdapter } from "../../src/cli/adapters/claude";
import { mkdirSync, rmSync, readFileSync, writeFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { SkillManifest } from "../../src/cli/types";

const TMP = join(import.meta.dir, ".tmp-claude");

beforeEach(() => {
  mkdirSync(join(TMP, ".claude"), { recursive: true });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

const promptManifest: SkillManifest = {
  name: "design-review",
  version: "1.0.0",
  description: "Design review",
  author: "iceinvein",
  type: "prompt",
  tools: ["claude"],
  files: { prompt: "SKILL.md" },
  install: {
    claude: { prompt: ".claude/skills/design-review/SKILL.md" },
  },
};

const mcpManifest: SkillManifest = {
  name: "code-intelligence",
  version: "1.0.0",
  description: "MCP server",
  author: "iceinvein",
  type: "code",
  tools: ["claude"],
  install: {
    claude: {
      mcpServers: {
        "code-intelligence": {
          command: "npx",
          args: ["-y", "@iceinvein/code-intelligence-mcp"],
        },
      },
    },
  },
};

test("install copies prompt file to .claude/skills/", async () => {
  const files = new Map([["SKILL.md", "# Design Review\nContent here"]]);
  const installed = await claudeAdapter.install(TMP, promptManifest, files);

  const content = readFileSync(join(TMP, ".claude/skills/design-review/SKILL.md"), "utf-8");
  expect(content).toBe("# Design Review\nContent here");
  expect(installed).toContain(".claude/skills/design-review/SKILL.md");
});

test("install adds MCP server to .claude/settings.json", async () => {
  const files = new Map<string, string>();
  const installed = await claudeAdapter.install(TMP, mcpManifest, files);

  const settings = JSON.parse(readFileSync(join(TMP, ".claude/settings.json"), "utf-8"));
  expect(settings.mcpServers["code-intelligence"]).toEqual({
    command: "npx",
    args: ["-y", "@iceinvein/code-intelligence-mcp"],
  });
  expect(installed).toContain(".claude/settings.json");
});

test("install merges MCP into existing settings.json", async () => {
  writeFileSync(
    join(TMP, ".claude/settings.json"),
    JSON.stringify({ mcpServers: { existing: { command: "node", args: ["server.js"] } } })
  );

  const files = new Map<string, string>();
  await claudeAdapter.install(TMP, mcpManifest, files);

  const settings = JSON.parse(readFileSync(join(TMP, ".claude/settings.json"), "utf-8"));
  expect(settings.mcpServers.existing).toBeDefined();
  expect(settings.mcpServers["code-intelligence"]).toBeDefined();
});

test("remove deletes prompt files", async () => {
  const files = new Map([["SKILL.md", "# Content"]]);
  await claudeAdapter.install(TMP, promptManifest, files);
  await claudeAdapter.remove(TMP, promptManifest, [".claude/skills/design-review/SKILL.md"]);

  const exists = await Bun.file(join(TMP, ".claude/skills/design-review/SKILL.md")).exists();
  expect(exists).toBe(false);
});

test("remove deletes MCP entry from settings.json", async () => {
  const files = new Map<string, string>();
  await claudeAdapter.install(TMP, mcpManifest, files);
  await claudeAdapter.remove(TMP, mcpManifest, [".claude/settings.json"]);

  const settings = JSON.parse(readFileSync(join(TMP, ".claude/settings.json"), "utf-8"));
  expect(settings.mcpServers["code-intelligence"]).toBeUndefined();
});

const bundleManifest: SkillManifest = {
  name: "bundled",
  version: "0.1.0",
  description: "bundled",
  author: "iceinvein",
  type: "prompt",
  tools: ["claude"],
  files: { prompt: "SKILL.md" },
  bundle: { include: ["bin", "scripts", "install.sh", "uninstall.sh"] },
  install: {
    claude: {
      prompt: ".claude/skills/bundled/SKILL.md",
      bundleRoot: ".claude/skills/bundled",
      postinstall: "install.sh",
      postremove: "uninstall.sh",
    },
  },
};

test("install writes bundle files under bundleRoot and runs postinstall", async () => {
  const root = join(TMP, ".claude/skills/bundled");
  const marker = join(TMP, "postinstall-ran");
  const files = new Map<string, string>([
    ["SKILL.md", "# Bundled"],
    ["bin/run", "#!/usr/bin/env bash\necho hi\n"],
    ["scripts/lib.ts", "export const x = 1;\n"],
    ["install.sh", `#!/usr/bin/env bash\ntouch "${marker}"\n`],
    ["uninstall.sh", "#!/usr/bin/env bash\nexit 0\n"],
  ]);

  const installed = await claudeAdapter.install(TMP, bundleManifest, files);

  expect(readFileSync(join(root, "bin/run"), "utf-8")).toContain("echo hi");
  expect(readFileSync(join(root, "scripts/lib.ts"), "utf-8")).toContain("export const x");
  expect(installed).toContain(".claude/skills/bundled/bin/run");
  expect(installed).toContain(".claude/skills/bundled/scripts/lib.ts");
  expect(installed).toContain(".claude/skills/bundled/install.sh");

  // Executable bits set on bin/* and *.sh
  expect(statSync(join(root, "bin/run")).mode & 0o111).not.toBe(0);
  expect(statSync(join(root, "install.sh")).mode & 0o111).not.toBe(0);
  expect(statSync(join(root, "scripts/lib.ts")).mode & 0o111).toBe(0);

  // Postinstall ran
  expect(existsSync(marker)).toBe(true);
});

test("remove runs postremove before deleting bundle files", async () => {
  const root = join(TMP, ".claude/skills/bundled");
  const removeMarker = join(TMP, "postremove-ran");
  const files = new Map<string, string>([
    ["SKILL.md", "# Bundled"],
    ["bin/run", "#!/usr/bin/env bash\n"],
    ["install.sh", "#!/usr/bin/env bash\nexit 0\n"],
    ["uninstall.sh", `#!/usr/bin/env bash\ntouch "${removeMarker}"\n`],
  ]);

  const installed = await claudeAdapter.install(TMP, bundleManifest, files);
  expect(existsSync(join(root, "install.sh"))).toBe(true);

  await claudeAdapter.remove(TMP, bundleManifest, installed);

  expect(existsSync(removeMarker)).toBe(true);
  expect(existsSync(join(root, "bin/run"))).toBe(false);
  expect(existsSync(join(root, "install.sh"))).toBe(false);
});
