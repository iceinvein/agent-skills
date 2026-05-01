import { test, expect } from "bun:test";
import { formatChoice } from "../src/cli/tui";

test("formatChoice renders type tag, padded name, and version", () => {
  const c = formatChoice({
    name: "code-intelligence",
    description: "Semantic code search via MCP",
    type: "code",
    version: "1.0.0",
  });
  expect(c.value).toBe("code-intelligence");
  expect(c.description).toBe("Semantic code search via MCP");
  expect(c.name).toContain("[code]");
  expect(c.name).toContain("code-intelligence");
  expect(c.name).toContain("v1.0.0");
});

test("formatChoice falls back to [other] for unknown type", () => {
  const c = formatChoice({ name: "x", description: "y", type: "unknown", version: "0.0.1" });
  expect(c.name).toContain("[other]");
});

test("formatChoice maps each known type to its tag", () => {
  expect(
    formatChoice({ name: "a", description: "", type: "prompt", version: "1" }).name,
  ).toContain("[prompt]");
  expect(
    formatChoice({ name: "a", description: "", type: "hybrid", version: "1" }).name,
  ).toContain("[hybrid]");
});
