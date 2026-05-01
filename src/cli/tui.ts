import { checkbox, select } from "@inquirer/prompts";
import { emitKeypressEvents } from "node:readline";
import type { SkillSummary } from "./commands/list";
import { TOOL_NAMES, type ActivationMode, type ToolName } from "./types";

const TYPE_TAGS: Record<string, string> = {
  prompt: "[prompt]",
  code: "[code]  ",
  hybrid: "[hybrid]",
};

const TOOL_LABELS: Record<ToolName, string> = {
  claude: "Claude Code",
  cursor: "Cursor",
  codex: "Codex",
  gemini: "Gemini CLI",
};

export function formatChoice(skill: SkillSummary): { name: string; value: string; description: string } {
  const tag = TYPE_TAGS[skill.type] ?? "[other] ";
  return {
    name: `${tag}  ${skill.name.padEnd(34)} v${skill.version}`,
    value: skill.name,
    description: skill.description,
  };
}

type Keypress = { name?: string; ctrl?: boolean };

export async function withEscape<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  emitKeypressEvents(process.stdin);
  const onKeypress = (_str: string | undefined, key: Keypress | undefined) => {
    if (key?.name === "escape") controller.abort();
  };
  process.stdin.on("keypress", onKeypress);
  try {
    return await fn(controller.signal);
  } finally {
    process.stdin.off("keypress", onKeypress);
  }
}

export async function browseAndSelect(skills: SkillSummary[]): Promise<{ picked: string[] }> {
  return withEscape(async (signal) => {
    const picked = await checkbox<string>(
      {
        message: `Select skills to install (${skills.length} available, Esc to cancel):`,
        choices: skills.map(formatChoice),
        pageSize: 15,
        loop: false,
      },
      { signal },
    );
    return { picked };
  });
}

export async function pickTools(message: string, allowed?: ToolName[]): Promise<ToolName[]> {
  const choices = TOOL_NAMES.filter((t) => !allowed || allowed.includes(t)).map((t) => ({
    name: TOOL_LABELS[t],
    value: t,
  }));
  return withEscape(async (signal) =>
    checkbox<ToolName>(
      {
        message: `${message} (Esc to cancel)`,
        choices,
        required: true,
      },
      { signal },
    ),
  );
}

export async function pickActivation(
  skillName: string,
  modes: ActivationMode[],
): Promise<ActivationMode> {
  const labels: Record<ActivationMode, string> = {
    session: `Per-session: invoke manually with /${skillName}`,
    global: "Global: auto-activate every session (adds SessionStart hook)",
  };
  return withEscape(async (signal) =>
    select<ActivationMode>(
      {
        message: `How should ${skillName} activate in Claude Code? (Esc to cancel)`,
        choices: modes.map((m) => ({ name: labels[m], value: m })),
      },
      { signal },
    ),
  );
}
