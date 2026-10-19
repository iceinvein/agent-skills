import { test, expect } from "bun:test";
import { buildMarketplace, type SkillManifest } from "../scripts/marketplace";

function skill(overrides: Partial<SkillManifest> = {}): SkillManifest {
  return {
    name: "magpie",
    description: "Collects things.",
    version: "1.2.3",
    author: "iceinvein",
    tools: ["claude"],
    ...overrides,
  };
}

test("buildMarketplace turns a Claude skill into a plugin entry under the iceinvein-skills marketplace", () => {
  expect(buildMarketplace([skill()])).toEqual({
    name: "iceinvein-skills",
    owner: { name: "iceinvein" },
    description: "Thinking frameworks from foundational software engineering texts, installed as skills for AI coding agents.",
    plugins: [
      {
        name: "magpie",
        source: "./skills/magpie",
        description: "Collects things.",
        version: "1.2.3",
        author: { name: "iceinvein" },
      },
    ],
  });
});

test("buildMarketplace omits a skill whose tools do not include claude", () => {
  expect(buildMarketplace([skill({ tools: ["codex", "cursor"] })]).plugins).toEqual([]);
});

test("buildMarketplace gives a session-activated skill no hooks", () => {
  const [entry] = buildMarketplace([
    skill({ activation: { default: "session", claudeHookDirective: "Pick a channel." } }),
  ]).plugins;
  expect("hooks" in entry!).toBe(false);
});

test("buildMarketplace wires directive, hook script and stop script of a global skill into SessionStart and Stop", () => {
  const [entry] = buildMarketplace([
    skill({
      activation: {
        default: "global",
        claudeHookDirective: "Pick a channel.",
        claudeHookScript: "scripts/session-start.sh",
        claudeStopScript: "scripts/stop-guard.sh",
      },
    }),
  ]).plugins;
  expect(entry!.hooks).toEqual({
    SessionStart: [
      {
        hooks: [
          {
            type: "command",
            command: "echo 'Pick a channel.'; bash \"${CLAUDE_PLUGIN_ROOT}/scripts/session-start.sh\"",
          },
        ],
      },
    ],
    Stop: [
      {
        hooks: [{ type: "command", command: "bash \"${CLAUDE_PLUGIN_ROOT}/scripts/stop-guard.sh\"" }],
      },
    ],
  });
});

test("buildMarketplace gives a global skill with only a directive an echo SessionStart hook and no Stop hook", () => {
  const [entry] = buildMarketplace([
    skill({ activation: { default: "global", claudeHookDirective: "Pick a channel." } }),
  ]).plugins;
  expect(entry!.hooks).toEqual({
    SessionStart: [{ hooks: [{ type: "command", command: "echo 'Pick a channel.'" }] }],
  });
});

test("buildMarketplace shell-escapes a single quote in the directive", () => {
  const [entry] = buildMarketplace([
    skill({ activation: { default: "global", claudeHookDirective: "It's on." } }),
  ]).plugins;
  expect(entry!.hooks?.SessionStart?.[0]?.hooks[0]?.command).toBe("echo 'It'\\''s on.'");
});

test("buildMarketplace sorts plugins by name", () => {
  const names = buildMarketplace([skill({ name: "sluice" }), skill({ name: "bug-hunter" }), skill({ name: "magpie" })])
    .plugins.map((p) => p.name);
  expect(names).toEqual(["bug-hunter", "magpie", "sluice"]);
});
