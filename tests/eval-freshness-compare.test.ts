import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Baseline, type CaseRecord, compare, formatReport, reduce } from "../scripts/eval-freshness/compare";
import type { Manifest } from "../scripts/eval-freshness/manifest";

const fixture = (): Record<string, unknown> =>
	JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "eval-freshness", "two-arm-bypass.json"), "utf8"));

function baseline(model: string, cases: Record<string, CaseRecord>): Baseline {
	return {
		model,
		judgeModel: "haiku",
		claudeVersion: "2.1.0",
		skillVersion: "1.0.0",
		date: "2026-10-01T00:00:00.000Z",
		cases,
	};
}

const noRules: Manifest = { rules: [], sandboxSensitive: [], vacuousWithout: [], unclaimed: [] };

describe("reduce", () => {
	test("keeps the model, judge, CLI version, start time and per-run scores of a real result", () => {
		expect(reduce(fixture(), "2.3.0")).toEqual({
			model: "claude-opus-5-5",
			judgeModel: "claude-opus-5-5",
			claudeVersion: "2.1.296",
			skillVersion: "2.3.0",
			date: "2026-10-12T13:57:25.414Z",
			cases: { "bypass-question-stays-silent": { with: [1], without: [1] } },
		});
	});

	test("falls back to the haiku judge when the suite names none", () => {
		const result = fixture();
		delete (result.suite as Record<string, unknown>).judgeModel;
		expect(reduce(result, "2.3.0").judgeModel).toBe("haiku");
	});

	test("gives an empty without list for a case that ran no without arm", () => {
		const result = fixture();
		const only = (result.cases as { arms: Record<string, unknown> }[])[0];
		delete only.arms.without;
		expect(reduce(result, "2.3.0").cases["bypass-question-stays-silent"]).toEqual({ with: [1], without: [] });
	});

	// An errored run keeps a score of 0 that says nothing about the skill, so
	// counting it would read a crashed sandbox as a regression.
	test("leaves errored runs out of the scores", () => {
		const result = fixture();
		const arms = (result.cases as { arms: Record<string, unknown[]> }[])[0].arms;
		arms.with.push({ score: 0, passed: false, error: "sandbox timed out" });
		expect(reduce(result, "2.3.0").cases["bypass-question-stays-silent"]).toEqual({ with: [1], without: [1] });
	});

	test("leaves out a case whose with arm has no run that finished", () => {
		const result = fixture();
		const arms = (result.cases as { arms: Record<string, unknown[]> }[])[0].arms;
		arms.with = [{ score: 0, passed: false, error: "rate limited" }];
		expect(reduce(result, "2.3.0").cases).toEqual({});
	});

	test("gives an empty without list for a case whose without arm is null", () => {
		const result = fixture();
		const only = (result.cases as { arms: Record<string, unknown> }[])[0];
		only.arms.without = null;
		expect(reduce(result, "2.3.0").cases["bypass-question-stays-silent"]).toEqual({ with: [1], without: [] });
	});

	test("rejects a partial result", () => {
		const result = fixture();
		result.partial = true;
		expect(() => reduce(result, "2.3.0")).toThrow(/partial/);
	});

	test("rejects a result that ran without ablation", () => {
		const result = fixture();
		(result.suite as Record<string, unknown>).ablation = "none";
		expect(() => reduce(result, "2.3.0")).toThrow(/with-without/);
	});

	test("rejects a result with no partial field as malformed", () => {
		const result = fixture();
		delete result.partial;
		expect(() => reduce(result, "2.3.0")).toThrow(/partial/);
	});

	test("rejects a result that names the same case twice", () => {
		const result = fixture();
		const cases = result.cases as unknown[];
		cases.push(structuredClone(cases[0]));
		expect(() => reduce(result, "2.3.0")).toThrow(/bypass-question-stays-silent/);
	});

	test("rejects a result with no model override", () => {
		const result = fixture();
		delete (result.suite as Record<string, unknown>).modelOverride;
		expect(() => reduce(result, "2.3.0")).toThrow(/modelOverride/);
	});
});

describe("compare verdicts", () => {
	const verdictsOf = (
		current: CaseRecord,
		before: CaseRecord | null | undefined,
		manifest: Manifest = noRules,
		tolerance = 0.1,
	): string[] => {
		const base = before === null ? null : baseline("old", before === undefined ? {} : { c: before });
		return compare(baseline("new", { c: current }), base, manifest, tolerance).cases[0].verdicts;
	};

	test("a with mean below the baseline's by more than the tolerance is regressed", () => {
		expect(verdictsOf({ with: [0.5, 0.6], without: [0] }, { with: [0.8, 0.8], without: [0] })).toEqual([
			"regressed",
		]);
	});

	test("a drop just over the tolerance is regressed", () => {
		expect(verdictsOf({ with: [0.69], without: [0] }, { with: [0.8], without: [0] })).toEqual(["regressed"]);
	});

	test("a drop of exactly the tolerance is not regressed despite float means", () => {
		expect(verdictsOf({ with: [0.73, 0.73, 1], without: [0] }, { with: [0.92], without: [0] })).toEqual(["flaky"]);
		expect(verdictsOf({ with: [0.7], without: [0] }, { with: [0.8], without: [0] })).toEqual(["steady"]);
	});

	test("a drop within the tolerance is steady", () => {
		expect(verdictsOf({ with: [0.75], without: [0] }, { with: [0.8], without: [0] })).toEqual(["steady"]);
	});

	test("the same drop on a sandbox-sensitive case is sandbox and not regressed", () => {
		const manifest: Manifest = { ...noRules, sandboxSensitive: ["c"] };
		expect(verdictsOf({ with: [0.5, 0.6], without: [0] }, { with: [0.8, 0.8], without: [0] }, manifest)).toEqual([
			"sandbox",
		]);
	});

	test("a sandbox-sensitive case that did not drop is steady", () => {
		const manifest: Manifest = { ...noRules, sandboxSensitive: ["c"] };
		expect(verdictsOf({ with: [1], without: [0] }, { with: [1], without: [0] }, manifest)).toEqual(["steady"]);
	});

	test("a perfect with arm matched by the without arm is redundant", () => {
		expect(verdictsOf({ with: [1, 1], without: [1, 1] }, { with: [1], without: [1] })).toEqual(["redundant"]);
	});

	test("a vacuous-without case with both arms perfect is steady, not redundant", () => {
		const manifest: Manifest = { ...noRules, vacuousWithout: ["c"] };
		expect(verdictsOf({ with: [1, 1], without: [1, 1] }, { with: [1], without: [1] }, manifest)).toEqual(["steady"]);
	});

	test("a vacuous-without case that dropped is still regressed", () => {
		const manifest: Manifest = { ...noRules, vacuousWithout: ["c"] };
		expect(verdictsOf({ with: [0.5], without: [1] }, { with: [1], without: [1] }, manifest)).toEqual(["regressed"]);
	});

	test("a vacuous-without case whose runs disagree is still flaky", () => {
		const manifest: Manifest = { ...noRules, vacuousWithout: ["c"] };
		expect(verdictsOf({ with: [1, 0], without: [1, 1] }, { with: [0.5], without: [1] }, manifest)).toEqual(["flaky"]);
	});

	test("a vacuous-without case with both arms perfect that is absent from the baseline is only new", () => {
		const manifest: Manifest = { ...noRules, vacuousWithout: ["c"] };
		expect(verdictsOf({ with: [1], without: [1] }, undefined, manifest)).toEqual(["new"]);
	});

	test("listing a different case as vacuous-without leaves a perfect case redundant", () => {
		const manifest: Manifest = { ...noRules, vacuousWithout: ["other"] };
		expect(verdictsOf({ with: [1, 1], without: [1, 1] }, { with: [1], without: [1] }, manifest)).toEqual(["redundant"]);
	});

	test("a without arm matching an imperfect with arm is not redundant", () => {
		expect(verdictsOf({ with: [0.5], without: [0.5] }, { with: [0.5], without: [0.5] })).toEqual(["steady"]);
	});

	test("a case with no without runs is never redundant", () => {
		expect(verdictsOf({ with: [1], without: [] }, { with: [1], without: [] })).toEqual(["steady"]);
	});

	test("a with mean below the without mean by more than the tolerance is skill-worse", () => {
		expect(verdictsOf({ with: [0.5, 0.6], without: [0.9, 0.9] }, null)).toEqual(["skill-worse"]);
	});

	test("a without mean above the with mean by no more than the tolerance is not skill-worse", () => {
		expect(verdictsOf({ with: [0.8], without: [0.9] }, null)).toEqual(["steady"]);
	});

	test("a vacuous-without case is never skill-worse", () => {
		const manifest: Manifest = { ...noRules, vacuousWithout: ["c"] };
		expect(verdictsOf({ with: [0.5], without: [1] }, null, manifest)).toEqual(["steady"]);
	});

	test("runs that disagree on passing within one arm are flaky", () => {
		expect(verdictsOf({ with: [0.5, 0.5], without: [1, 0.9] }, { with: [0.5], without: [1] })).toEqual([
			"skill-worse",
			"flaky",
		]);
	});

	test("a case absent from the baseline is new", () => {
		expect(verdictsOf({ with: [0.5], without: [0] }, undefined)).toEqual(["new"]);
	});

	test("a case that changed in no flagged way is steady", () => {
		expect(verdictsOf({ with: [1], without: [0] }, { with: [1], without: [0] })).toEqual(["steady"]);
	});

	test("with no baseline a case is never new or regressed", () => {
		expect(verdictsOf({ with: [0], without: [0] }, null)).toEqual(["steady"]);
	});

	test("a case can be flaky and regressed at once", () => {
		expect(verdictsOf({ with: [1, 0], without: [0] }, { with: [1, 1], without: [0] })).toEqual([
			"regressed",
			"flaky",
		]);
	});

	test("cases only in the baseline are not reported", () => {
		const report = compare(
			baseline("new", { a: { with: [1], without: [0] } }),
			baseline("old", { a: { with: [1], without: [0] }, b: { with: [1], without: [0] } }),
			noRules,
			0.1,
		);
		expect(report.cases.map((c) => c.name)).toEqual(["a"]);
	});

	test("reports the means and the baseline it was compared against", () => {
		const report = compare(
			baseline("new", { a: { with: [1, 0.5], without: [0, 0.25] } }),
			baseline("old", { a: { with: [0.5, 0.5, 1], without: [0] } }),
			noRules,
			0.5,
		);
		expect(report.model).toBe("new");
		expect(report.against).toBe("old");
		expect(report.cases[0]).toEqual({
			name: "a",
			verdicts: ["flaky"],
			withMean: 0.75,
			withoutMean: 0.125,
			baselineWithMean: 2 / 3,
		});
	});

	test("with no baseline there is nothing it was compared against", () => {
		const report = compare(baseline("new", { a: { with: [1], without: [] } }), null, noRules, 0.1);
		expect(report.against).toBeNull();
		expect(report.cases[0].withoutMean).toBe(0);
		expect(report.cases[0].baselineWithMean).toBeNull();
	});
});

describe("compare rule status", () => {
	const statusOf = (rule: Manifest["rules"][number], sandboxSensitive: string[] = []): string => {
		const current = baseline("new", {
			dropped: { with: [0.2], without: [0] },
			solved: { with: [1], without: [1] },
			fine: { with: [1], without: [0] },
		});
		const before = baseline("old", {
			dropped: { with: [1], without: [0] },
			solved: { with: [1], without: [1] },
			fine: { with: [1], without: [0] },
		});
		return compare(current, before, { ...noRules, rules: [rule], sandboxSensitive }, 0.1).rules[0].status;
	};
	const rule = (cases: string[]) => ({ id: "r", states: "SKILL.md", origin: "docs/design.md", cases });

	test("a rule with a regressed case is at risk", () => {
		expect(statusOf(rule(["fine", "dropped"]))).toBe("at-risk");
	});

	test("a rule whose every case is redundant is an expiry candidate", () => {
		expect(statusOf(rule(["solved"]))).toBe("expiry-candidate");
	});

	test("a rule whose dropped case is sandbox-sensitive is not at risk", () => {
		expect(statusOf(rule(["dropped"]), ["dropped"])).toBe("ok");
	});

	test("a rule with no cases is unpinned", () => {
		expect(statusOf({ ...rule([]), unpinned: "judgement call" })).toBe("unpinned");
	});

	test("a rule with a mix of steady and redundant cases is ok", () => {
		expect(statusOf(rule(["fine", "solved"]))).toBe("ok");
	});

	test("a rule whose cases did not run is ok", () => {
		expect(statusOf(rule(["absent"]))).toBe("ok");
	});

	test("a rule is not an expiry candidate while one of its cases did not run", () => {
		expect(statusOf(rule(["solved", "absent"]))).toBe("ok");
	});

	test("an unclaimed case keeps its verdicts and changes no rule's status", () => {
		const current = baseline("new", { dropped: { with: [0.2], without: [0] }, fine: { with: [1], without: [0] } });
		const before = baseline("old", { dropped: { with: [1], without: [0] }, fine: { with: [1], without: [0] } });
		const manifest: Manifest = {
			...noRules,
			rules: [rule(["fine"])],
			unclaimed: [{ case: "dropped", reason: "guards a repo convention" }],
		};
		const report = compare(current, before, manifest, 0.1);
		expect(report.cases.map((c) => [c.name, c.verdicts])).toEqual([
			["dropped", ["regressed"]],
			["fine", ["steady"]],
		]);
		expect(report.rules).toEqual([{ id: "r", status: "ok" }]);
	});

	test("a missing case does not hide a regression in a case that ran", () => {
		expect(statusOf(rule(["absent", "dropped"]))).toBe("at-risk");
	});
});

describe("formatReport", () => {
	test("lists at-risk rules, then expiry candidates, then non-steady cases, naming the baseline", () => {
		const text = formatReport({
			model: "claude-opus-5-5",
			against: "claude-opus-5-4",
			cases: [
				{ name: "alpha", verdicts: ["regressed", "flaky"], withMean: 0.5, withoutMean: 0, baselineWithMean: 1 },
				{ name: "beta", verdicts: ["steady"], withMean: 1, withoutMean: 0, baselineWithMean: 1 },
				{ name: "gamma", verdicts: ["redundant"], withMean: 1, withoutMean: 1, baselineWithMean: null },
			],
			rules: [
				{ id: "r-ok", status: "ok" },
				{ id: "r-old", status: "expiry-candidate" },
				{ id: "r-risk", status: "at-risk" },
				{ id: "r-free", status: "unpinned" },
			],
		});
		expect(text).toBe(
			[
				"claude-opus-5-5 against baseline claude-opus-5-4",
				"",
				"At-risk rules:",
				"  r-risk",
				"Expiry candidates:",
				"  r-old",
				"Non-steady cases:",
				"  alpha: regressed, flaky (with 0.50, without 0.00, baseline with 1.00)",
				"  gamma: redundant (with 1.00, without 1.00, baseline with none)",
				"",
			].join("\n"),
		);
	});

	test("says when there was no baseline and nothing to flag", () => {
		const text = formatReport({
			model: "claude-opus-5-5",
			against: null,
			cases: [{ name: "beta", verdicts: ["steady"], withMean: 1, withoutMean: 0, baselineWithMean: null }],
			rules: [{ id: "r-ok", status: "ok" }],
		});
		expect(text).toBe(
			[
				"claude-opus-5-5 against no baseline",
				"",
				"At-risk rules: none",
				"Expiry candidates: none",
				"Non-steady cases: none",
				"",
			].join("\n"),
		);
	});
});
