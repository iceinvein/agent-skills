import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ToolName } from "./types";

const TOOL_MARKERS: Record<ToolName, (cwd: string) => boolean> = {
  claude: (cwd) => existsSync(join(cwd, ".claude")),
  cursor: (cwd) => existsSync(join(cwd, ".cursor")),
  codex: (cwd) => existsSync(join(cwd, "AGENTS.md")),
  gemini: (cwd) => existsSync(join(cwd, ".gemini")),
};

export async function detectTools(cwd: string): Promise<ToolName[]> {
  const detected: ToolName[] = [];
  for (const [tool, check] of Object.entries(TOOL_MARKERS)) {
    if (check(cwd)) {
      detected.push(tool as ToolName);
    }
  }
  return detected;
}
