export const TOOL_NAMES = ["claude", "cursor", "codex", "gemini"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export const SKILL_TYPES = ["prompt", "code", "hybrid"] as const;
export type SkillType = (typeof SKILL_TYPES)[number];

export type McpServerConfig = {
  command: string;
  args: string[];
};

export type ToolInstallConfig = {
  prompt?: string;
  append?: boolean;
  supporting?: Record<string, string>;
  mcpServers?: Record<string, McpServerConfig>;
};

export type SkillManifest = {
  name: string;
  version: string;
  description: string;
  author: string;
  type: SkillType;
  tools: ToolName[];
  files?: {
    prompt?: string;
    supporting?: string[];
  };
  mcp?: {
    package: string;
    command: string;
    args: string[];
  };
  install: Partial<Record<ToolName, ToolInstallConfig>>;
};

export type LockfileEntry = {
  version: string;
  tools: ToolName[];
  installedAt: string;
  files: string[];
};

export type Lockfile = {
  skills: Record<string, LockfileEntry>;
};

export type ValidationResult =
  | { ok: true; manifest: SkillManifest }
  | { ok: false; error: string };

export function validateManifest(data: unknown): ValidationResult {
  if (typeof data !== "object" || data === null) {
    return { ok: false, error: "Manifest must be an object" };
  }

  const d = data as Record<string, unknown>;

  if (typeof d.name !== "string" || d.name.length === 0) {
    return { ok: false, error: "Missing or invalid 'name'" };
  }
  if (typeof d.version !== "string") {
    return { ok: false, error: "Missing or invalid 'version'" };
  }
  if (typeof d.description !== "string") {
    return { ok: false, error: "Missing or invalid 'description'" };
  }
  if (typeof d.author !== "string") {
    return { ok: false, error: "Missing or invalid 'author'" };
  }
  if (!SKILL_TYPES.includes(d.type as SkillType)) {
    return { ok: false, error: `Invalid 'type': must be one of ${SKILL_TYPES.join(", ")}` };
  }
  if (!Array.isArray(d.tools) || d.tools.length === 0) {
    return { ok: false, error: "Missing or empty 'tools' array" };
  }
  for (const tool of d.tools) {
    if (!TOOL_NAMES.includes(tool as ToolName)) {
      return { ok: false, error: `Invalid tool '${tool}': must be one of ${TOOL_NAMES.join(", ")}` };
    }
  }
  if (typeof d.install !== "object" || d.install === null) {
    return { ok: false, error: "Missing 'install' configuration" };
  }

  return { ok: true, manifest: d as unknown as SkillManifest };
}
