import type { ToolName } from "../types";
import { claudeAdapter, type Adapter } from "./claude";
import { cursorAdapter } from "./cursor";
import { codexAdapter } from "./codex";
import { geminiAdapter } from "./gemini";

export type { Adapter };

const adapters: Record<ToolName, Adapter> = {
  claude: claudeAdapter,
  cursor: cursorAdapter,
  codex: codexAdapter,
  gemini: geminiAdapter,
};

export function getAdapter(tool: ToolName): Adapter {
  return adapters[tool];
}
