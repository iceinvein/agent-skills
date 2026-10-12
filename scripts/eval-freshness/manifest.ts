import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export type Rule = { id: string; states: string; origin: string; cases: string[]; unpinned?: string };
export type Manifest = { rules: Rule[]; sandboxSensitive: string[] };

const isStringArray = (value: unknown): value is string[] =>
	Array.isArray(value) && value.every((item) => typeof item === "string");

function isRule(value: unknown): value is Rule {
	if (typeof value !== "object" || value === null) return false;
	const r = value as Record<string, unknown>;
	return (
		typeof r.id === "string" &&
		typeof r.states === "string" &&
		typeof r.origin === "string" &&
		isStringArray(r.cases) &&
		(r.unpinned === undefined || typeof r.unpinned === "string")
	);
}

export function loadManifest(skillDir: string): Manifest {
	const path = join(skillDir, "evals", "rules.json");
	if (!existsSync(path)) throw new Error(`${path} is missing`);
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		throw new Error(`${path} is not valid JSON: ${(error as Error).message}`);
	}
	const m = parsed as Record<string, unknown>;
	if (
		typeof parsed !== "object" ||
		parsed === null ||
		!Array.isArray(m.rules) ||
		!m.rules.every(isRule) ||
		!isStringArray(m.sandboxSensitive)
	) {
		throw new Error(`${path} is not a rules manifest ({ rules: Rule[], sandboxSensitive: string[] })`);
	}
	return { rules: m.rules, sandboxSensitive: m.sandboxSensitive };
}

const isFile = (path: string): boolean => existsSync(path) && statSync(path).isFile();

export function caseNames(skillDir: string): string[] {
	const evals = join(skillDir, "evals");
	return readdirSync(evals)
		.filter((name) => {
			const dir = join(evals, name);
			if (name === "results" || !statSync(dir).isDirectory()) return false;
			return existsSync(join(dir, "prompt.md")) || existsSync(join(dir, "case.yaml"));
		})
		.sort();
}

export function checkManifest(skillDir: string): string[] {
	const { rules, sandboxSensitive } = loadManifest(skillDir);
	const cases = caseNames(skillDir);
	// The skill lives at <root>/skills/<name>, and origins are repo-relative.
	const repoRoot = join(skillDir, "..", "..");
	const problems: string[] = [];
	const seenIds = new Set<string>();
	const named = new Set<string>();

	for (const rule of rules) {
		if (seenIds.has(rule.id)) problems.push(`rule id ${rule.id} is used more than once`);
		seenIds.add(rule.id);
		for (const name of rule.cases) {
			named.add(name);
			if (!cases.includes(name)) problems.push(`rule ${rule.id} names case "${name}", which does not exist`);
		}
		const hasReason = (rule.unpinned ?? "").trim() !== "";
		if (rule.cases.length === 0 && !hasReason) {
			problems.push(`rule ${rule.id} has no cases and no unpinned reason`);
		}
		if (rule.cases.length > 0 && hasReason) {
			problems.push(`rule ${rule.id} has both cases and an unpinned reason`);
		}
		const statesFile = rule.states.split(":")[0].trim();
		if (statesFile === "") {
			problems.push(`rule ${rule.id} states no file`);
		} else if (!isFile(join(skillDir, statesFile))) {
			problems.push(`rule ${rule.id} states "${statesFile}", which is not a file in the skill`);
		}
		if (rule.origin.trim() === "") {
			problems.push(`rule ${rule.id} has no origin`);
		} else if (!isFile(join(repoRoot, rule.origin))) {
			problems.push(`rule ${rule.id} origin "${rule.origin}" is not a file in the repo`);
		}
	}
	for (const name of cases) {
		if (!named.has(name)) problems.push(`case "${name}" is named by no rule`);
	}
	for (const name of sandboxSensitive) {
		if (!cases.includes(name)) problems.push(`sandboxSensitive names "${name}", which is not a case`);
	}
	return problems;
}
