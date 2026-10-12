import type { Manifest } from "./manifest";

export type CaseRecord = { with: number[]; without: number[] };
export type Baseline = {
	model: string;
	judgeModel: string;
	claudeVersion: string;
	skillVersion: string;
	date: string;
	cases: Record<string, CaseRecord>;
};

export type CaseVerdict = "regressed" | "redundant" | "flaky" | "sandbox" | "new" | "steady";
export type RuleStatus = "at-risk" | "expiry-candidate" | "unpinned" | "ok";
export type CaseReport = {
	name: string;
	verdicts: CaseVerdict[];
	withMean: number;
	withoutMean: number;
	baselineWithMean: number | null;
};
export type Report = {
	model: string;
	against: string | null;
	cases: CaseReport[];
	rules: { id: string; status: RuleStatus }[];
};

// The CLI judges with haiku unless --judge-model is given.
const DEFAULT_JUDGE = "haiku";

// Means of quarter and third scores carry float error, so a drop of exactly
// the tolerance can compute as a hair over it and must not count.
const MEAN_EPSILON = 1e-9;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

function scores(runs: unknown, where: string): number[] {
	if (!Array.isArray(runs)) throw new Error(`${where} is not a list of runs`);
	return runs.map((run, i) => {
		if (!isObject(run) || typeof run.score !== "number") throw new Error(`${where}[${i}] has no numeric score`);
		return run.score;
	});
}

export function reduce(result: unknown, skillVersion: string): Baseline {
	if (!isObject(result)) throw new Error("eval result is not an object");
	if (result.partial !== false) throw new Error("eval result is partial; rerun it to completion");
	const suite = result.suite;
	if (!isObject(suite)) throw new Error("eval result has no suite");
	if (suite.ablation !== "with-without") {
		throw new Error(`eval result ran with ablation "${String(suite.ablation)}"; it needs with-without`);
	}
	if (typeof suite.modelOverride !== "string") {
		throw new Error("eval result has no suite.modelOverride; rerun it with --model");
	}
	if (suite.judgeModel !== undefined && typeof suite.judgeModel !== "string") {
		throw new Error("eval result suite.judgeModel is not a string");
	}
	if (typeof result.claudeVersion !== "string") throw new Error("eval result has no claudeVersion");
	if (typeof result.startedAt !== "string") throw new Error("eval result has no startedAt");
	if (!Array.isArray(result.cases)) throw new Error("eval result has no cases");

	const cases: Record<string, CaseRecord> = {};
	for (const [i, entry] of result.cases.entries()) {
		if (!isObject(entry) || typeof entry.name !== "string" || !isObject(entry.arms)) {
			throw new Error(`eval result cases[${i}] has no name or arms`);
		}
		if (Object.hasOwn(cases, entry.name)) throw new Error(`eval result names case ${entry.name} more than once`);
		const where = `case ${entry.name}`;
		cases[entry.name] = {
			with: scores(entry.arms.with, `${where} arms.with`),
			without: entry.arms.without === undefined ? [] : scores(entry.arms.without, `${where} arms.without`),
		};
	}

	return {
		model: suite.modelOverride,
		judgeModel: suite.judgeModel ?? DEFAULT_JUDGE,
		claudeVersion: result.claudeVersion,
		skillVersion,
		date: result.startedAt,
		cases,
	};
}

const mean = (values: number[]): number =>
	values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

const passes = (score: number): boolean => score === 1;

const disagrees = (runs: number[]): boolean => runs.some(passes) && !runs.every(passes);

function caseReport(
	name: string,
	current: CaseRecord,
	baseline: Baseline | null,
	manifest: Manifest,
	tolerance: number,
): CaseReport {
	const withMean = mean(current.with);
	const withoutMean = mean(current.without);
	const before = baseline?.cases[name];
	const baselineWithMean = before === undefined ? null : mean(before.with);
	const verdicts: CaseVerdict[] = [];

	const dropped = baselineWithMean !== null && baselineWithMean - withMean > tolerance + MEAN_EPSILON;
	const sandboxSensitive = manifest.sandboxSensitive.includes(name);
	if (dropped && !sandboxSensitive) verdicts.push("regressed");
	// The CLI drops Skill-fired graders from the without arm's score, so some
	// cases pass there because the model did nothing, which proves nothing.
	const vacuous = manifest.vacuousWithout.includes(name);
	if (!vacuous && current.without.length > 0 && withMean === 1 && withoutMean >= withMean) {
		verdicts.push("redundant");
	}
	if (disagrees(current.with) || disagrees(current.without)) verdicts.push("flaky");
	if (dropped && sandboxSensitive) verdicts.push("sandbox");
	if (baseline !== null && before === undefined) verdicts.push("new");
	if (verdicts.length === 0) verdicts.push("steady");

	return { name, verdicts, withMean, withoutMean, baselineWithMean };
}

function ruleStatus(rule: Manifest["rules"][number], cases: CaseReport[]): RuleStatus {
	if (rule.cases.length === 0) return "unpinned";
	// A rule's case can be missing when the run was narrowed with --case.
	const ran = cases.filter((c) => rule.cases.includes(c.name));
	if (ran.some((c) => c.verdicts.includes("regressed"))) return "at-risk";
	if (ran.length === rule.cases.length && ran.every((c) => c.verdicts.includes("redundant"))) {
		return "expiry-candidate";
	}
	return "ok";
}

export function compare(current: Baseline, baseline: Baseline | null, manifest: Manifest, tolerance: number): Report {
	const cases = Object.entries(current.cases).map(([name, record]) =>
		caseReport(name, record, baseline, manifest, tolerance),
	);
	return {
		model: current.model,
		against: baseline?.model ?? null,
		cases,
		rules: manifest.rules.map((rule) => ({ id: rule.id, status: ruleStatus(rule, cases) })),
	};
}

function section(title: string, lines: string[]): string[] {
	return lines.length === 0 ? [`${title}: none`] : [`${title}:`, ...lines.map((line) => `  ${line}`)];
}

export function formatReport(report: Report): string {
	const rulesWith = (status: RuleStatus) => report.rules.filter((r) => r.status === status).map((r) => r.id);
	const flagged = report.cases
		.filter((c) => !c.verdicts.includes("steady"))
		.map((c) => {
			const baselineWith = c.baselineWithMean === null ? "none" : c.baselineWithMean.toFixed(2);
			const means = `with ${c.withMean.toFixed(2)}, without ${c.withoutMean.toFixed(2)}, baseline with ${baselineWith}`;
			return `${c.name}: ${c.verdicts.join(", ")} (${means})`;
		});
	const header =
		report.against === null
			? `${report.model} against no baseline`
			: `${report.model} against baseline ${report.against}`;
	return [
		header,
		"",
		...section("At-risk rules", rulesWith("at-risk")),
		...section("Expiry candidates", rulesWith("expiry-candidate")),
		...section("Non-steady cases", flagged),
		"",
	].join("\n");
}
