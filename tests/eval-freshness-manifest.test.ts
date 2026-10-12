import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { caseNames, checkManifest, loadManifest } from "../scripts/eval-freshness/manifest";

type Tree = { cases?: string[]; rules?: unknown; sandboxSensitive?: string[] };

/**
 * Builds <root>/skills/demo with SKILL.md, a docs/design.md origin, and one
 * directory per case, so every reference in the baseline manifest resolves.
 */
function skillTree(tree: Tree = {}): string {
	const root = mkdtempSync(join(tmpdir(), "eval-freshness-manifest-"));
	const skill = join(root, "skills", "demo");
	mkdirSync(join(skill, "evals"), { recursive: true });
	mkdirSync(join(root, "docs"), { recursive: true });
	writeFileSync(join(root, "docs", "design.md"), "# design\n");
	writeFileSync(join(skill, "SKILL.md"), "# demo\n");
	for (const name of tree.cases ?? ["alpha", "beta"]) {
		mkdirSync(join(skill, "evals", name));
		writeFileSync(join(skill, "evals", name, "prompt.md"), "do it\n");
	}
	const manifest = {
		rules: tree.rules ?? [
			{ id: "r1", states: "SKILL.md: step 1", origin: "docs/design.md", cases: ["alpha"] },
			{ id: "r2", states: "SKILL.md", origin: "docs/design.md", cases: ["beta"] },
		],
		sandboxSensitive: tree.sandboxSensitive ?? [],
	};
	writeFileSync(join(skill, "evals", "rules.json"), JSON.stringify(manifest));
	return skill;
}

const rule = (over: Record<string, unknown>) => ({
	id: "r1",
	states: "SKILL.md",
	origin: "docs/design.md",
	cases: ["alpha"],
	...over,
});

describe("checkManifest", () => {
	test("a consistent manifest has no problems", () => {
		expect(checkManifest(skillTree())).toEqual([]);
	});

	test("reports a rule naming a case that does not exist", () => {
		const skill = skillTree({ cases: ["alpha"], rules: [rule({ cases: ["alpha", "ghost"] })] });
		expect(checkManifest(skill)).toEqual(['rule r1 names case "ghost", which does not exist']);
	});

	test("reports a case no rule names", () => {
		const skill = skillTree({ rules: [rule({})] });
		expect(checkManifest(skill)).toEqual(['case "beta" is named by no rule']);
	});

	test("reports a duplicate rule id", () => {
		const skill = skillTree({ rules: [rule({}), rule({ cases: ["beta"] })] });
		expect(checkManifest(skill)).toEqual(["rule id r1 is used more than once"]);
	});

	test("reports a rule with no cases and no unpinned reason", () => {
		const skill = skillTree({ cases: ["alpha"], rules: [rule({}), rule({ id: "r2", cases: [] })] });
		expect(checkManifest(skill)).toEqual(["rule r2 has no cases and no unpinned reason"]);
	});

	test("reports a rule with both cases and an unpinned reason", () => {
		const skill = skillTree({ cases: ["alpha"], rules: [rule({ unpinned: "too costly" })] });
		expect(checkManifest(skill)).toEqual(["rule r1 has both cases and an unpinned reason"]);
	});

	test("reports a sandboxSensitive name that is not a case", () => {
		const skill = skillTree({ cases: ["alpha"], rules: [rule({})], sandboxSensitive: ["ghost"] });
		expect(checkManifest(skill)).toEqual(['sandboxSensitive names "ghost", which is not a case']);
	});

	test("reports a states file missing under the skill dir", () => {
		const skill = skillTree({ cases: ["alpha"], rules: [rule({ states: " references/gone.md : step 2" })] });
		expect(checkManifest(skill)).toEqual(['rule r1 states "references/gone.md", which does not exist in the skill']);
	});

	test("reports an origin missing under the repo root", () => {
		const skill = skillTree({ cases: ["alpha"], rules: [rule({ origin: "docs/gone.md" })] });
		expect(checkManifest(skill)).toEqual(['rule r1 origin "docs/gone.md" does not exist in the repo']);
	});
});

describe("loadManifest", () => {
	test("throws when rules.json is missing", () => {
		const skill = mkdtempSync(join(tmpdir(), "eval-freshness-manifest-"));
		expect(() => loadManifest(skill)).toThrow();
	});

	test("throws when rules.json is not the manifest shape", () => {
		const skill = skillTree({ rules: [{ id: "r1", cases: "alpha" }] });
		expect(() => loadManifest(skill)).toThrow();
	});
});

describe("caseNames", () => {
	test("lists sorted case dirs, ignoring results, README and unmarked dirs", () => {
		const skill = skillTree({ cases: ["zeta", "alpha"] });
		const evals = join(skill, "evals");
		mkdirSync(join(evals, "gamma"));
		writeFileSync(join(evals, "gamma", "case.yaml"), "x: 1\n");
		mkdirSync(join(evals, "results"));
		writeFileSync(join(evals, "results", "prompt.md"), "not a case\n");
		mkdirSync(join(evals, "scratch"));
		writeFileSync(join(evals, "README.md"), "# evals\n");
		expect(caseNames(skill)).toEqual(["alpha", "gamma", "zeta"]);
	});
});
