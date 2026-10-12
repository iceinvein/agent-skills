import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Baseline, compare, formatReport, reduce } from "./eval-freshness/compare";
import { loadManifest } from "./eval-freshness/manifest";

const USAGE = `usage:
  bun scripts/eval-freshness.ts run <skillDir> --model <id> [--runs <n>] [-j <n>] [--case <glob>] [--tolerance <x>]
  bun scripts/eval-freshness.ts diff <skillDir> <result.json> [--against <model>] [--tolerance <x>]
  bun scripts/eval-freshness.ts accept <skillDir> <result.json>`;

const DEFAULT_TOLERANCE = 0.1;

class UsageError extends Error {}

const ALLOWED_FLAGS: Record<string, string[]> = {
	run: ["model", "runs", "j", "case", "tolerance"],
	diff: ["against", "tolerance"],
	accept: [],
};

function parse(argv: string[]): { positional: string[]; flags: Record<string, string> } {
	const positional: string[] = [];
	const flags: Record<string, string> = {};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg.startsWith("-")) {
			const value = argv[i + 1];
			if (value === undefined) throw new UsageError(`${arg} needs a value`);
			flags[arg.replace(/^-+/, "")] = value;
			i++;
		} else {
			positional.push(arg);
		}
	}
	return { positional, flags };
}

function readJson(path: string): unknown {
	let text: string;
	try {
		text = readFileSync(path, "utf8");
	} catch (error) {
		throw new Error(`cannot read ${path}: ${(error as Error).message}`);
	}
	try {
		return JSON.parse(text);
	} catch (error) {
		throw new Error(`${path} is not valid JSON: ${(error as Error).message}`);
	}
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const isNumberArray = (value: unknown): value is number[] =>
	Array.isArray(value) && value.every((item) => typeof item === "number");

function isBaseline(value: unknown): value is Baseline {
	if (!isObject(value)) return false;
	const fields = ["model", "judgeModel", "claudeVersion", "skillVersion", "date"];
	if (!fields.every((field) => typeof value[field] === "string")) return false;
	if (!isObject(value.cases)) return false;
	return Object.values(value.cases).every(
		(record) => isObject(record) && isNumberArray(record.with) && record.with.length > 0 && isNumberArray(record.without),
	);
}

function readBaseline(path: string): Baseline | null {
	if (!existsSync(path)) return null;
	const value = readJson(path);
	if (!isBaseline(value)) {
		throw new Error(`${path} is not a baseline ({ model, judgeModel, claudeVersion, skillVersion, date, cases })`);
	}
	return value;
}

function skillVersion(skillDir: string): string {
	const path = join(skillDir, "skill.json");
	const skill = readJson(path) as Record<string, unknown> | null;
	if (typeof skill?.version !== "string") throw new Error(`${path} has no version`);
	return skill.version;
}

function tolerance(flags: Record<string, string>): number {
	if (flags.tolerance === undefined) return DEFAULT_TOLERANCE;
	const value = Number(flags.tolerance);
	if (!Number.isFinite(value) || value < 0) throw new UsageError(`--tolerance must be a non-negative number`);
	return value;
}

function positiveInt(flags: Record<string, string>, name: string, fallback: number): number {
	if (flags[name] === undefined) return fallback;
	const value = Number(flags[name]);
	if (!Number.isInteger(value) || value < 1) throw new UsageError(`${name} must be a positive integer`);
	return value;
}

// Model ids such as "vendor/opus:1m" carry path separators and characters
// some filesystems reject, so they are flattened before naming a file.
const modelFileName = (model: string) => model.replace(/[^A-Za-z0-9._-]/g, "-");

const baselinePath = (skillDir: string, model: string) =>
	join(skillDir, "evals", "baselines", `${modelFileName(model)}.json`);

function diff(skillDir: string, resultPath: string, against: string | undefined, tol: number): number {
	const current = reduce(readJson(resultPath), skillVersion(skillDir));
	const manifest = loadManifest(skillDir);
	const path = baselinePath(skillDir, against ?? current.model);
	const baseline = readBaseline(path);
	const report = compare(current, baseline, manifest, tol);
	process.stdout.write(formatReport(report));
	return report.cases.some((c) => c.verdicts.includes("regressed")) ? 1 : 0;
}

function accept(skillDir: string, resultPath: string): number {
	const baseline = reduce(readJson(resultPath), skillVersion(skillDir));
	const path = baselinePath(skillDir, baseline.model);
	mkdirSync(join(skillDir, "evals", "baselines"), { recursive: true });
	writeFileSync(path, `${JSON.stringify(baseline, null, 2)}\n`);
	console.log(`wrote ${path}`);
	return 0;
}

function run(skillDir: string, flags: Record<string, string>): number {
	const model = flags.model;
	if (model === undefined) throw new UsageError("run needs --model <id>");
	const runs = positiveInt(flags, "runs", 3);
	const jobs = positiveInt(flags, "j", 2);
	const tol = tolerance(flags);
	// Fail on a bad skill before paying for an eval whose result could not be diffed.
	skillVersion(skillDir);
	loadManifest(skillDir);
	const resultsDir = join(skillDir, "evals", "results");
	mkdirSync(resultsDir, { recursive: true });
	const stamp = new Date().toISOString().replaceAll(":", "-");
	const resultPath = join(resultsDir, `fresh-${modelFileName(model)}-${stamp}.json`);
	const args = [
		"claude", "plugin", "eval", skillDir,
		"--scaffold",
		"--allow-tools", "Bash", "Write", "Edit",
		"--ablation", "with-without",
		"--model", model,
		"--judge-model", model,
		"--runs", String(runs),
		"-j", String(jobs),
		...(flags.case === undefined ? [] : ["--case", flags.case]),
		"--no-publish",
		"--json", resultPath,
	];
	const proc = Bun.spawnSync(args, { stdio: ["inherit", "inherit", "inherit"] });
	if (!existsSync(resultPath)) {
		console.error(`claude plugin eval exited ${proc.exitCode} and wrote no result at ${resultPath}`);
		return 2;
	}
	return diff(skillDir, resultPath, undefined, tol);
}

function main(argv: string[]): number {
	const [command, ...rest] = argv;
	const { positional, flags } = parse(rest);
	if (command === undefined || !Object.hasOwn(ALLOWED_FLAGS, command)) {
		throw new UsageError(command === undefined ? "no subcommand given" : `unknown subcommand "${command}"`);
	}
	const allowed = ALLOWED_FLAGS[command];
	const unknown = Object.keys(flags).filter((flag) => !allowed.includes(flag));
	if (unknown.length > 0) throw new UsageError(`unknown flag for ${command}: ${unknown.join(", ")}`);
	if (positional.length !== (command === "run" ? 1 : 2)) throw new UsageError(`wrong number of arguments for ${command}`);
	const [skillDir, resultPath] = positional;
	if (command === "run") return run(skillDir, flags);
	if (command === "diff") return diff(skillDir, resultPath, flags.against, tolerance(flags));
	return accept(skillDir, resultPath);
}

try {
	process.exit(main(process.argv.slice(2)));
} catch (error) {
	console.error((error as Error).message);
	if (error instanceof UsageError) console.error(USAGE);
	process.exit(2);
}
