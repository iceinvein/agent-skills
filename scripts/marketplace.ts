// Each Claude skill becomes one plugin whose root is its skill dir, so the
// skill-relative hook script paths in skill.json resolve under CLAUDE_PLUGIN_ROOT.

export type SkillManifest = {
  name: string;
  description: string;
  version: string;
  author: string;
  tools: string[];
  activation?: {
    default: "session" | "global";
    claudeHookDirective?: string;
    claudeHookScript?: string;
    claudeStopScript?: string;
  };
};

export type HookGroup = { hooks: { type: "command"; command: string }[] };

export type PluginEntry = {
  name: string;
  source: string;
  description: string;
  version: string;
  author: { name: string };
  hooks?: { SessionStart?: HookGroup[]; Stop?: HookGroup[] };
};

export type MarketplaceFile = {
  name: "iceinvein-skills";
  owner: { name: "iceinvein" };
  plugins: PluginEntry[];
};

function shellQuote(text: string): string {
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

// Left as a literal so Claude Code expands it at hook run time, not us at build time.
function pluginScript(relativePath: string): string {
  return `bash "\${CLAUDE_PLUGIN_ROOT}/${relativePath}"`;
}

function commandGroup(command: string): HookGroup[] {
  return [{ hooks: [{ type: "command", command }] }];
}

function buildHooks(activation: NonNullable<SkillManifest["activation"]>): PluginEntry["hooks"] {
  const hooks: NonNullable<PluginEntry["hooks"]> = {};

  const sessionStart: string[] = [];
  if (activation.claudeHookDirective) sessionStart.push(`echo ${shellQuote(activation.claudeHookDirective)}`);
  if (activation.claudeHookScript) sessionStart.push(pluginScript(activation.claudeHookScript));
  if (sessionStart.length > 0) hooks.SessionStart = commandGroup(sessionStart.join("; "));

  if (activation.claudeStopScript) hooks.Stop = commandGroup(pluginScript(activation.claudeStopScript));

  return Object.keys(hooks).length > 0 ? hooks : undefined;
}

export function buildMarketplace(skills: SkillManifest[]): MarketplaceFile {
  const plugins = skills
    .filter((skill) => skill.tools.includes("claude"))
    .map((skill): PluginEntry => {
      const entry: PluginEntry = {
        name: skill.name,
        source: `./skills/${skill.name}`,
        description: skill.description,
        version: skill.version,
        author: { name: skill.author },
      };
      // Session-activated skills are opted into per session by the CLI, so a
      // plugin install must not fire their hooks in every session.
      if (skill.activation?.default === "global") {
        const hooks = buildHooks(skill.activation);
        if (hooks) entry.hooks = hooks;
      }
      return entry;
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return { name: "iceinvein-skills", owner: { name: "iceinvein" }, plugins };
}
