import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { caseNames, checkManifest, loadManifest } from "../scripts/eval-freshness/manifest";

type Tree = {
	cases?: string[];
	rules?: unknown;
	sandboxSensitive?: string[];
	vacuousWithout?: string[];
	unclaimed?: { case: string; reason: string }[];
};

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
		vacuousWithout: tree.vacuousWithout ?? [],
		unclaimed: tree.unclaimed ?? [],
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

	test("reports a rule naming the same case twice", () => {
		const skill = skillTree({ rules: [rule({ cases: ["alpha", "alpha"] }), rule({ id: "r2", cases: ["beta"] })] });
		expect(checkManifest(skill)).toEqual(['rule r1 names case "alpha" more than once']);
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
		expect(checkManifest(skill)).toEqual(['rule r1 states "references/gone.md", which is not a file in the skill']);
	});

	test("reports an origin missing under the repo root", () => {
		const skill = skillTree({ cases: ["alpha"], rules: [rule({ origin: "docs/gone.md" })] });
		expect(checkManifest(skill)).toEqual(['rule r1 origin "docs/gone.md" is not a file in the repo']);
	});
});

describe("checkManifest on empty or non-file references", () => {
	test("reports an empty states string as naming no file", () => {
		const skill = skillTree({ cases: ["alpha"], rules: [rule({ states: "" })] });
		expect(checkManifest(skill)).toEqual(["rule r1 states no file"]);
	});

	test("reports a states with nothing before the colon as naming no file", () => {
		const skill = skillTree({ cases: ["alpha"], rules: [rule({ states: " : step 2" })] });
		expect(checkManifest(skill)).toEqual(["rule r1 states no file"]);
	});

	test("reports a states naming a directory", () => {
		const skill = skillTree({ cases: ["alpha"], rules: [rule({ states: "evals: step 1" })] });
		expect(checkManifest(skill)).toEqual(['rule r1 states "evals", which is not a file in the skill']);
	});

	test("reports an empty origin", () => {
		const skill = skillTree({ cases: ["alpha"], rules: [rule({ origin: "" })] });
		expect(checkManifest(skill)).toEqual(["rule r1 has no origin"]);
	});

	test("reports an origin naming a directory", () => {
		const skill = skillTree({ cases: ["alpha"], rules: [rule({ origin: "docs" })] });
		expect(checkManifest(skill)).toEqual(['rule r1 origin "docs" is not a file in the repo']);
	});
});

describe("checkManifest on vacuous, unclaimed and commit-origin entries", () => {
	test("reports a vacuousWithout name that is not a case", () => {
		const skill = skillTree({ cases: ["alpha"], rules: [rule({})], vacuousWithout: ["ghost"] });
		expect(checkManifest(skill)).toEqual(['vacuousWithout names "ghost", which is not a case']);
	});

	test("reports an unclaimed case that is not a case", () => {
		const skill = skillTree({
			cases: ["alpha"],
			rules: [rule({})],
			unclaimed: [{ case: "ghost", reason: "guards a repo convention" }],
		});
		expect(checkManifest(skill)).toEqual(['unclaimed names "ghost", which is not a case']);
	});

	test("reports an unclaimed case that a rule also names", () => {
		const skill = skillTree({
			rules: [rule({}), rule({ id: "r2", cases: ["beta"] })],
			unclaimed: [{ case: "beta", reason: "guards a repo convention" }],
		});
		expect(checkManifest(skill)).toEqual(['unclaimed case "beta" is also named by rule r2']);
	});

	test("still reports a case no rule names when a different case is unclaimed", () => {
		const skill = skillTree({
			cases: ["alpha", "beta", "x"],
			rules: [rule({})],
			unclaimed: [{ case: "beta", reason: "guards a repo convention" }],
		});
		expect(checkManifest(skill)).toEqual(['case "x" is named by no rule']);
	});

	test("reports an unclaimed entry with a blank reason", () => {
		const skill = skillTree({ rules: [rule({})], unclaimed: [{ case: "beta", reason: "  " }] });
		expect(checkManifest(skill)).toEqual(['unclaimed case "beta" has no reason']);
	});

	test("accepts a case listed as unclaimed though no rule names it", () => {
		const skill = skillTree({ rules: [rule({})], unclaimed: [{ case: "beta", reason: "guards a repo convention" }] });
		expect(checkManifest(skill)).toEqual([]);
	});

	test("accepts a well-formed commit origin without looking for a file", () => {
		const skill = skillTree({ cases: ["alpha"], rules: [rule({ origin: "commit:dd12f45" })] });
		expect(checkManifest(skill)).toEqual([]);
	});

	test("accepts a full 40-character commit origin", () => {
		const skill = skillTree({
			cases: ["alpha"],
			rules: [rule({ origin: "commit:0123456789abcdef0123456789abcdef01234567" })],
		});
		expect(checkManifest(skill)).toEqual([]);
	});

	test("reports a commit origin whose SHA is too short", () => {
		const skill = skillTree({ cases: ["alpha"], rules: [rule({ origin: "commit:dd12f4" })] });
		expect(checkManifest(skill)).toEqual(['rule r1 origin "commit:dd12f4" is not commit:<7 to 40 lowercase hex>']);
	});

	test("reports a commit origin whose SHA is longer than 40 characters", () => {
		const origin = `commit:${"a".repeat(41)}`;
		const skill = skillTree({ cases: ["alpha"], rules: [rule({ origin })] });
		expect(checkManifest(skill)).toEqual([`rule r1 origin "${origin}" is not commit:<7 to 40 lowercase hex>`]);
	});

	test("reports a commit origin with uppercase hex", () => {
		const skill = skillTree({ cases: ["alpha"], rules: [rule({ origin: "commit:DD12F45" })] });
		expect(checkManifest(skill)).toEqual(['rule r1 origin "commit:DD12F45" is not commit:<7 to 40 lowercase hex>']);
	});

	test("reports a commit origin with lowercase letters that are not hex", () => {
		const skill = skillTree({ cases: ["alpha"], rules: [rule({ origin: "commit:ghijklm" })] });
		expect(checkManifest(skill)).toEqual(['rule r1 origin "commit:ghijklm" is not commit:<7 to 40 lowercase hex>']);
	});

	test("checks a bare commit origin as a file path", () => {
		const skill = skillTree({ cases: ["alpha"], rules: [rule({ origin: "commit" })] });
		expect(checkManifest(skill)).toEqual(['rule r1 origin "commit" is not a file in the repo']);
	});

	test("treats a blank unpinned as no reason", () => {
		const skill = skillTree({ cases: ["alpha"], rules: [rule({}), rule({ id: "r2", cases: [], unpinned: "  " })] });
		expect(checkManifest(skill)).toEqual(["rule r2 has no cases and no unpinned reason"]);
	});
});

describe("loadManifest", () => {
	test("throws when rules.json is missing", () => {
		const skill = mkdtempSync(join(tmpdir(), "eval-freshness-manifest-"));
		expect(() => loadManifest(skill)).toThrow(join(skill, "evals", "rules.json"));
	});

	const validTop = { rules: [rule({})], sandboxSensitive: [], vacuousWithout: [], unclaimed: [] };

	function rulesFile(text: string): string {
		const skill = skillTree();
		writeFileSync(join(skill, "evals", "rules.json"), text);
		return skill;
	}

	test("throws naming the file when cases is a string", () => {
		const skill = rulesFile(JSON.stringify({ ...validTop, rules: [rule({ cases: "alpha" })] }));
		expect(() => loadManifest(skill)).toThrow(join(skill, "evals", "rules.json"));
	});

	test("throws naming the file when sandboxSensitive is missing", () => {
		const skill = rulesFile(JSON.stringify({ ...validTop, sandboxSensitive: undefined }));
		expect(() => loadManifest(skill)).toThrow(join(skill, "evals", "rules.json"));
	});

	test("throws naming the file when unpinned is not a string", () => {
		const skill = rulesFile(JSON.stringify({ ...validTop, rules: [rule({ cases: [], unpinned: 3 })] }));
		expect(() => loadManifest(skill)).toThrow(join(skill, "evals", "rules.json"));
	});

	test("loads a manifest carrying all four keys", () => {
		const top = { ...validTop, vacuousWithout: ["alpha"], unclaimed: [{ case: "beta", reason: "convention" }] };
		const skill = rulesFile(JSON.stringify(top));
		expect(loadManifest(skill)).toEqual({
			rules: [{ id: "r1", states: "SKILL.md", origin: "docs/design.md", cases: ["alpha"] }],
			sandboxSensitive: [],
			vacuousWithout: ["alpha"],
			unclaimed: [{ case: "beta", reason: "convention" }],
		});
	});

	test("throws naming the file when vacuousWithout is missing", () => {
		const skill = rulesFile(JSON.stringify({ ...validTop, vacuousWithout: undefined }));
		expect(() => loadManifest(skill)).toThrow(join(skill, "evals", "rules.json"));
	});

	test("throws naming the file when vacuousWithout holds a non-string", () => {
		const skill = rulesFile(JSON.stringify({ ...validTop, vacuousWithout: [3] }));
		expect(() => loadManifest(skill)).toThrow(join(skill, "evals", "rules.json"));
	});

	test("throws naming the file when unclaimed is missing", () => {
		const skill = rulesFile(JSON.stringify({ ...validTop, unclaimed: undefined }));
		expect(() => loadManifest(skill)).toThrow(join(skill, "evals", "rules.json"));
	});

	test("throws naming the file when an unclaimed entry is a bare case name", () => {
		const skill = rulesFile(JSON.stringify({ ...validTop, unclaimed: ["beta"] }));
		expect(() => loadManifest(skill)).toThrow(join(skill, "evals", "rules.json"));
	});

	test("throws naming the file when an unclaimed entry has no reason", () => {
		const skill = rulesFile(JSON.stringify({ ...validTop, unclaimed: [{ case: "beta" }] }));
		expect(() => loadManifest(skill)).toThrow(join(skill, "evals", "rules.json"));
	});

	test("throws naming the file when an unclaimed case is not a string", () => {
		const skill = rulesFile(JSON.stringify({ ...validTop, unclaimed: [{ case: 3, reason: "convention" }] }));
		expect(() => loadManifest(skill)).toThrow(join(skill, "evals", "rules.json"));
	});

	test("throws naming the file when the top level is not an object", () => {
		const skill = rulesFile("[]");
		expect(() => loadManifest(skill)).toThrow(join(skill, "evals", "rules.json"));
	});

	test("throws naming the file when it is not valid JSON", () => {
		const skill = rulesFile("{ rules: ");
		expect(() => loadManifest(skill)).toThrow(join(skill, "evals", "rules.json"));
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

	test("names a case link that points nowhere", () => {
		const skill = skillTree({ cases: ["alpha"] });
		symlinkSync(join(skill, "missing"), join(skill, "evals", "dangling"));
		expect(() => caseNames(skill)).toThrow("evals/dangling is a link to nothing");
	});
});
