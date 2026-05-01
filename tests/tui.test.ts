import { test, expect } from "bun:test";
import { filterSkills, formatChoice } from "../src/cli/tui";
import type { SkillSummary } from "../src/cli/commands/list";

const SAMPLE: SkillSummary[] = [
  { name: "code-intelligence", description: "Semantic code search via MCP", type: "code", version: "1.0.0" },
  { name: "design-review", description: "Brooks-inspired design integrity", type: "prompt", version: "1.0.0" },
  { name: "cohesion-analyzer", description: "Module cohesion patterns", type: "prompt", version: "0.2.1" },
];

test("filterSkills returns all when query is empty", () => {
  expect(filterSkills(SAMPLE, "")).toEqual(SAMPLE);
  expect(filterSkills(SAMPLE, "   ")).toEqual(SAMPLE);
});

test("filterSkills matches against name (case-insensitive)", () => {
  const result = filterSkills(SAMPLE, "DESIGN");
  expect(result).toHaveLength(1);
  expect(result[0].name).toBe("design-review");
});

test("filterSkills matches against description", () => {
  const result = filterSkills(SAMPLE, "mcp");
  expect(result).toHaveLength(1);
  expect(result[0].name).toBe("code-intelligence");
});

test("filterSkills returns empty array on no match", () => {
  expect(filterSkills(SAMPLE, "zzzznope")).toEqual([]);
});

test("formatChoice renders type tag, padded name, and version", () => {
  const c = formatChoice(SAMPLE[0]);
  expect(c.value).toBe("code-intelligence");
  expect(c.description).toBe("Semantic code search via MCP");
  expect(c.name).toContain("⚙️");
  expect(c.name).toContain("code-intelligence");
  expect(c.name).toContain("v1.0.0");
});

test("formatChoice falls back to bullet for unknown type", () => {
  const c = formatChoice({ name: "x", description: "y", type: "unknown", version: "0.0.1" });
  expect(c.name).toContain("•");
});
