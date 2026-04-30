import { test, expect } from "bun:test";
import { readFile } from "node:fs/promises";

const AUDIT_NAMES = [
  "design-review", "codebase-architecture", "contract-enforcer",
  "complexity-accountant", "module-secret-auditor", "seam-finder",
  "simplicity-razor", "coupling-auditor", "evolution-analyzer",
  "error-strategist", "rams-design-audit", "cognitive-load-auditor",
  "gestalt-reviewer", "cohesion-analyzer", "demeter-enforcer",
  "dependency-direction-auditor", "type-driven-designer", "cqs-auditor",
  "integration-pattern-auditor", "unidirectional-flow-enforcer",
  "event-design-reviewer", "bounded-context-auditor",
  "port-adapter-auditor", "idempotency-guardian",
  "composability-auditor", "temporal-coupling-detector",
];

const VALID_AREAS = new Set([
  "any", "ui", "domain", "integration", "architecture", "errors", "legacy",
]);

test("every audit declares applies and quick", async () => {
  const raw = await readFile("skills/index.json", "utf-8");
  const catalogue = JSON.parse(raw) as Array<Record<string, unknown>>;

  for (const name of AUDIT_NAMES) {
    const entry = catalogue.find((e) => e.name === name);
    expect(entry, `${name} missing from catalogue`).toBeDefined();
    expect(Array.isArray(entry!.applies), `${name}.applies must be array`).toBe(true);
    expect((entry!.applies as string[]).length, `${name}.applies non-empty`).toBeGreaterThan(0);
    for (const area of entry!.applies as string[]) {
      expect(VALID_AREAS.has(area), `${name}.applies contains invalid area "${area}"`).toBe(true);
    }
    expect(typeof entry!.quick, `${name}.quick must be boolean`).toBe("boolean");
  }
});
