type Run = { error?: unknown };
type Case = { name: string; runsPerCase: number; arms: { with?: Run[]; without?: Run[] } };
type Result = Record<string, unknown> & { suite: Record<string, unknown>; cases: Case[] };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

function asResult(value: unknown, path: string): Result {
	if (!isObject(value) || !isObject(value.suite) || !Array.isArray(value.cases)) {
		throw new Error(`${path} is not an eval result ({ suite, cases })`);
	}
	const seen = new Set<string>();
	for (const [i, entry] of value.cases.entries()) {
		if (!isObject(entry) || typeof entry.name !== "string" || !isObject(entry.arms)) {
			throw new Error(`${path} cases[${i}] has no name or arms`);
		}
		if (seen.has(entry.name)) throw new Error(`${path} names case ${entry.name} more than once`);
		seen.add(entry.name);
		if (typeof entry.runsPerCase !== "number") throw new Error(`${path} case ${entry.name} has no runsPerCase`);
		for (const arm of ["with", "without"]) {
			const runs = entry.arms[arm];
			if (runs === undefined) continue;
			if (!Array.isArray(runs) || !runs.every(isObject)) {
				throw new Error(`${path} case ${entry.name} arms.${arm} is not a list of runs`);
			}
		}
	}
	return value as Result;
}

const errored = (run: Run): boolean => run.error !== null && run.error !== undefined;

// A case is complete when both arms ran every sample and none errored. A cut
// run leaves its in-flight case with a short arm rather than an error.
function complete(entry: Case): boolean {
	return (["with", "without"] as const).every((arm) => {
		const runs = entry.arms[arm] ?? [];
		return runs.length === entry.runsPerCase && !runs.some(errored);
	});
}

// Two results that both lack a field would compare equal, so these must be
// present. The judge alone may be absent: the CLI leaves it unset for its default.
const REQUIRED_SUITE = ["modelOverride", "ablation", "root"];

function sameField(full: unknown, rerun: unknown, field: string, required: boolean, sources: { full: string; rerun: string }) {
	if (required && (typeof full !== "string" || typeof rerun !== "string")) {
		throw new Error(`${field} must be set in both results: ${String(full)} in ${sources.full}, ${String(rerun)} in ${sources.rerun}`);
	}
	if (full !== rerun) throw new Error(`${field} differs: ${String(full)} in ${sources.full}, ${String(rerun)} in ${sources.rerun}`);
}

export function merge(
	fullValue: unknown,
	rerunValue: unknown,
	caseNames: string[],
	sources: { full: string; rerun: string },
): Record<string, unknown> & { cases: Case[] } {
	const full = asResult(fullValue, sources.full);
	const rerun = asResult(rerunValue, sources.rerun);

	const caseFilter = full.suite.caseFilter;
	if (typeof caseFilter === "string" && caseFilter !== "") {
		throw new Error(`${sources.full} was filtered with --case ${caseFilter}; merge needs the full run as its base`);
	}
	for (const field of REQUIRED_SUITE) sameField(full.suite[field], rerun.suite[field], `suite.${field}`, true, sources);
	sameField(full.suite.judgeModel, rerun.suite.judgeModel, "suite.judgeModel", false, sources);
	sameField(full.claudeVersion, rerun.claudeVersion, "claudeVersion", true, sources);
	const runsPerCase = new Set([...full.cases, ...rerun.cases].map((entry) => entry.runsPerCase));
	if (runsPerCase.size > 1) throw new Error(`runsPerCase differs between the results: ${[...runsPerCase].join(", ")}`);

	const unknown = [...full.cases, ...rerun.cases].filter((entry) => !caseNames.includes(entry.name));
	if (unknown.length > 0) {
		throw new Error(`cases not in the skill's evals: ${[...new Set(unknown.map((c) => c.name))].join(", ")}`);
	}

	const fullCases = new Map(full.cases.map((entry) => [entry.name, entry]));
	const rerunCases = new Map(rerun.cases.map((entry) => [entry.name, entry]));

	// Replacing a case that already finished would let a low score be rerolled
	// until it comes up good, so the rerun may only fill what the full run lacks.
	const rerolled = rerun.cases.filter((entry) => {
		const original = fullCases.get(entry.name);
		return original !== undefined && complete(original);
	});
	if (rerolled.length > 0) {
		throw new Error(`${sources.rerun} reruns cases ${sources.full} already has complete: ${rerolled.map((c) => c.name).join(", ")}`);
	}
	const incomplete = rerun.cases.filter((entry) => !complete(entry));
	if (incomplete.length > 0) {
		throw new Error(`${sources.rerun} has errored or short cases itself: ${incomplete.map((c) => c.name).join(", ")}`);
	}

	const cases: Case[] = [];
	const missing: string[] = [];
	for (const name of caseNames) {
		const original = fullCases.get(name);
		const replacement = rerunCases.get(name);
		if (original !== undefined && complete(original)) cases.push(original);
		else if (replacement !== undefined) cases.push(replacement);
		else missing.push(name);
	}
	if (missing.length > 0) throw new Error(`no complete runs for ${missing.join(", ")} in either result; rerun them with --case`);

	const { aggregates, costUsd, durationSeconds, partialReason, ...kept } = full;
	return { ...kept, partial: false, mergedFrom: [sources.full, sources.rerun], cases };
}
