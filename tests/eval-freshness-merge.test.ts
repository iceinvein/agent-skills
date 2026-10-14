import { expect, test } from "bun:test";
import { merge } from "../scripts/eval-freshness/merge";

type Run = { score: number; error: string | null };
type Case = { name: string; runsPerCase: number; arms: { with: Run[]; without: Run[] } };

const ok = (score: number): Run => ({ score, error: null });
const failed = (error: string): Run => ({ score: 0, error });

function entry(name: string, withRuns: Run[], withoutRuns: Run[], runsPerCase = 2): Case {
	return { name, runsPerCase, arms: { with: withRuns, without: withoutRuns } };
}

function result(cases: Case[], extra: Record<string, unknown> = {}) {
	return {
		partial: false,
		claudeVersion: "2.1.0",
		startedAt: "2026-10-01T00:00:00.000Z",
		costUsd: 10,
		durationSeconds: 100,
		aggregates: { score: 0.5 },
		suite: { root: "/skills/demo", ablation: "with-without", modelOverride: "opus", judgeModel: "opus" },
		cases,
		...extra,
	};
}

const NAMES = ["case-a", "case-b"];
const sources = { full: "full.json", rerun: "rerun.json" };

test("an errored case takes the rerun's runs and the merged result is complete", () => {
	const full = result([entry("case-a", [ok(1), failed("timed out")], [ok(0), ok(0)]), entry("case-b", [ok(1), ok(1)], [ok(0), ok(0)])]);
	const rerun = result([entry("case-a", [ok(1), ok(0.5)], [ok(0), ok(1)])], { suite: { ...full.suite, caseFilter: "case-a" } });
	const merged = merge(full, rerun, NAMES, sources);
	expect(merged.partial).toBe(false);
	expect(merged.cases).toEqual([
		entry("case-a", [ok(1), ok(0.5)], [ok(0), ok(1)]),
		entry("case-b", [ok(1), ok(1)], [ok(0), ok(0)]),
	]);
});

test("a case the partial full result never reached is added from the rerun", () => {
	const full = result([entry("case-a", [ok(1), ok(1)], [ok(0), ok(0)])], { partial: true, partialReason: "interrupted" });
	const rerun = result([entry("case-b", [ok(1), ok(1)], [ok(1), ok(1)])]);
	const merged = merge(full, rerun, NAMES, sources);
	expect(merged.partial).toBe(false);
	expect(merged.partialReason).toBeUndefined();
	expect(merged.cases.map((c) => c.name)).toEqual(["case-a", "case-b"]);
	expect(merged.cases[1]).toEqual(entry("case-b", [ok(1), ok(1)], [ok(1), ok(1)]));
});

test("a case cut short with fewer runs than runsPerCase is replaced", () => {
	const full = result([entry("case-a", [ok(1), ok(1)], []), entry("case-b", [ok(1), ok(1)], [ok(0), ok(0)])], { partial: true });
	const rerun = result([entry("case-a", [ok(1), ok(1)], [ok(0), ok(0)])]);
	const merged = merge(full, rerun, NAMES, sources);
	expect(merged.cases[0]).toEqual(entry("case-a", [ok(1), ok(1)], [ok(0), ok(0)]));
});

test("the merged result keeps the full run's start date, names both sources and drops stale totals", () => {
	const full = result([entry("case-a", [failed("x"), ok(1)], [ok(0), ok(0)]), entry("case-b", [ok(1), ok(1)], [ok(0), ok(0)])]);
	const rerun = result([entry("case-a", [ok(1), ok(1)], [ok(0), ok(0)])], { startedAt: "2026-10-02T00:00:00.000Z" });
	const merged = merge(full, rerun, NAMES, sources);
	expect(merged.startedAt).toBe("2026-10-01T00:00:00.000Z");
	expect(merged.mergedFrom).toEqual(["full.json", "rerun.json"]);
	expect(merged.aggregates).toBeUndefined();
	expect(merged.costUsd).toBeUndefined();
	expect(merged.durationSeconds).toBeUndefined();
});

test.each([
	["model", { suite: { root: "/skills/demo", ablation: "with-without", modelOverride: "sonnet", judgeModel: "opus" } }],
	["judge", { suite: { root: "/skills/demo", ablation: "with-without", modelOverride: "opus", judgeModel: "haiku" } }],
	["ablation", { suite: { root: "/skills/demo", ablation: "none", modelOverride: "opus", judgeModel: "opus" } }],
	["skill root", { suite: { root: "/skills/other", ablation: "with-without", modelOverride: "opus", judgeModel: "opus" } }],
	["CLI version", { claudeVersion: "2.2.0" }],
])("refuses a rerun whose %s differs from the full run's", (_label, override) => {
	const full = result([entry("case-a", [failed("x"), ok(1)], [ok(0), ok(0)]), entry("case-b", [ok(1), ok(1)], [ok(0), ok(0)])]);
	const rerun = result([entry("case-a", [ok(1), ok(1)], [ok(0), ok(0)])], override);
	expect(() => merge(full, rerun, NAMES, sources)).toThrow("differs");
});

test("refuses a rerun with a different number of runs per case", () => {
	const full = result([entry("case-a", [failed("x"), ok(1)], [ok(0), ok(0)]), entry("case-b", [ok(1), ok(1)], [ok(0), ok(0)])]);
	const rerun = result([entry("case-a", [ok(1), ok(1), ok(1)], [ok(0), ok(0), ok(0)], 3)]);
	expect(() => merge(full, rerun, NAMES, sources)).toThrow("runsPerCase");
});

test("refuses a rerun that replaces a case the full run already has complete", () => {
	const full = result([entry("case-a", [failed("x"), ok(1)], [ok(0), ok(0)]), entry("case-b", [ok(0), ok(0)], [ok(0), ok(0)])]);
	const rerun = result([entry("case-a", [ok(1), ok(1)], [ok(0), ok(0)]), entry("case-b", [ok(1), ok(1)], [ok(0), ok(0)])]);
	expect(() => merge(full, rerun, NAMES, sources)).toThrow("case-b");
});

test("refuses when the rerun leaves out a case that still needs runs", () => {
	const full = result([entry("case-a", [failed("x"), ok(1)], [ok(0), ok(0)])], { partial: true });
	const rerun = result([entry("case-a", [ok(1), ok(1)], [ok(0), ok(0)])]);
	expect(() => merge(full, rerun, NAMES, sources)).toThrow("case-b");
});

test("refuses a rerun whose own case errored", () => {
	const full = result([entry("case-a", [failed("x"), ok(1)], [ok(0), ok(0)]), entry("case-b", [ok(1), ok(1)], [ok(0), ok(0)])]);
	const rerun = result([entry("case-a", [ok(1), failed("rate limited")], [ok(0), ok(0)])]);
	expect(() => merge(full, rerun, NAMES, sources)).toThrow("case-a");
});

test("refuses a rerun case the skill no longer has", () => {
	const full = result([entry("case-a", [failed("x"), ok(1)], [ok(0), ok(0)]), entry("case-b", [ok(1), ok(1)], [ok(0), ok(0)])]);
	const rerun = result([entry("case-a", [ok(1), ok(1)], [ok(0), ok(0)]), entry("case-gone", [ok(1), ok(1)], [ok(0), ok(0)])]);
	expect(() => merge(full, rerun, NAMES, sources)).toThrow("case-gone");
});

test("refuses a full result that was itself filtered with --case", () => {
	const filtered = { root: "/skills/demo", ablation: "with-without", modelOverride: "opus", judgeModel: "opus", caseFilter: "case-*" };
	const full = result([entry("case-a", [failed("x"), ok(1)], [ok(0), ok(0)]), entry("case-b", [ok(1), ok(1)], [ok(0), ok(0)])], { suite: filtered });
	const rerun = result([entry("case-a", [ok(1), ok(1)], [ok(0), ok(0)])]);
	expect(() => merge(full, rerun, NAMES, sources)).toThrow("--case");
});

test("refuses a rerun that names the same case twice", () => {
	const full = result([entry("case-a", [failed("x"), ok(1)], [ok(0), ok(0)]), entry("case-b", [ok(1), ok(1)], [ok(0), ok(0)])]);
	const rerun = result([entry("case-a", [ok(0), ok(0)], [ok(0), ok(0)]), entry("case-a", [ok(1), ok(1)], [ok(0), ok(0)])]);
	expect(() => merge(full, rerun, NAMES, sources)).toThrow("more than once");
});

test("refuses a full result that names the same case twice", () => {
	const full = result([
		entry("case-a", [ok(0), ok(0)], [ok(0), ok(0)]),
		entry("case-a", [failed("x"), ok(1)], [ok(0), ok(0)]),
		entry("case-b", [ok(1), ok(1)], [ok(0), ok(0)]),
	]);
	const rerun = result([entry("case-a", [ok(1), ok(1)], [ok(0), ok(0)])]);
	expect(() => merge(full, rerun, NAMES, sources)).toThrow("more than once");
});

test("refuses results that both lack the skill root, since nothing then ties them to one skill", () => {
	const suite = { ablation: "with-without", modelOverride: "opus", judgeModel: "opus" };
	const full = result([entry("case-a", [failed("x"), ok(1)], [ok(0), ok(0)]), entry("case-b", [ok(1), ok(1)], [ok(0), ok(0)])], { suite });
	const rerun = result([entry("case-a", [ok(1), ok(1)], [ok(0), ok(0)])], { suite });
	expect(() => merge(full, rerun, NAMES, sources)).toThrow("suite.root");
});

test("merges results that both leave the judge unset, as the CLI does for its default judge", () => {
	const suite = { root: "/skills/demo", ablation: "with-without", modelOverride: "opus" };
	const full = result([entry("case-a", [failed("x"), ok(1)], [ok(0), ok(0)]), entry("case-b", [ok(1), ok(1)], [ok(0), ok(0)])], { suite });
	const rerun = result([entry("case-a", [ok(1), ok(1)], [ok(0), ok(0)])], { suite });
	expect(merge(full, rerun, NAMES, sources).cases[0]).toEqual(entry("case-a", [ok(1), ok(1)], [ok(0), ok(0)]));
});

test("a case with no without arm at all is replaced", () => {
	const cut = { name: "case-a", runsPerCase: 2, arms: { with: [ok(1), ok(1)] } };
	const full = result([cut as Case, entry("case-b", [ok(1), ok(1)], [ok(0), ok(0)])], { partial: true });
	const rerun = result([entry("case-a", [ok(1), ok(1)], [ok(0), ok(0)])]);
	expect(merge(full, rerun, NAMES, sources).cases[0]).toEqual(entry("case-a", [ok(1), ok(1)], [ok(0), ok(0)]));
});

test("refuses a run that is not an object, naming its case", () => {
	const broken = { name: "case-a", runsPerCase: 2, arms: { with: [null, ok(1)], without: [ok(0), ok(0)] } };
	const full = result([broken as unknown as Case, entry("case-b", [ok(1), ok(1)], [ok(0), ok(0)])]);
	const rerun = result([entry("case-a", [ok(1), ok(1)], [ok(0), ok(0)])]);
	expect(() => merge(full, rerun, NAMES, sources)).toThrow("case case-a");
});
