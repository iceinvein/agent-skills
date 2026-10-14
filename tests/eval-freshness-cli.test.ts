import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "scripts", "eval-freshness.ts");
let skillDir: string;

function result(withScores: number[], withoutScores: number[]) {
	const run = (score: number) => ({ score, passed: score === 1, error: null, graders: [] });
	return {
		partial: false,
		claudeVersion: "2.1.0",
		startedAt: "2026-10-01T00:00:00.000Z",
		suite: { ablation: "with-without", modelOverride: "opus", judgeModel: "haiku" },
		cases: [{ name: "case-a", arms: { with: withScores.map(run), without: withoutScores.map(run) } }],
	};
}

function writeResult(value: unknown): string {
	const path = join(skillDir, "result.json");
	writeFileSync(path, JSON.stringify(value));
	return path;
}

function writeBaseline(model: string): void {
	mkdirSync(join(skillDir, "evals", "baselines"), { recursive: true });
	writeFileSync(
		join(skillDir, "evals", "baselines", `${model}.json`),
		JSON.stringify({
			model,
			judgeModel: "haiku",
			claudeVersion: "2.0.0",
			skillVersion: "1.2.0",
			date: "2026-09-01T00:00:00.000Z",
			cases: { "case-a": { with: [1, 1], without: [0, 0] } },
		}),
	);
}

function cli(...args: string[]) {
	return cliWithEnv({}, ...args);
}

function cliWithEnv(env: Record<string, string>, ...args: string[]) {
	const proc = Bun.spawnSync(["bun", CLI, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, ...env } });
	return { code: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

// Stands in for the paid `claude plugin eval`: records its argv and, when
// FAKE_RESULT is set, copies that file to the path after --json.
const FAKE_CLAUDE = `#!/bin/sh
printf '%s\\n' "$@" > "$FAKE_ARGV"
if [ -n "$FAKE_RESULT" ]; then
	prev=""
	for arg in "$@"; do
		if [ "$prev" = "--json" ]; then cp "$FAKE_RESULT" "$arg"; fi
		prev="$arg"
	done
fi
exit "\${FAKE_EXIT:-0}"
`;

function runWithFake(result: unknown | null, ...args: string[]) {
	const bin = join(skillDir, "bin");
	mkdirSync(bin);
	writeFileSync(join(bin, "claude"), FAKE_CLAUDE);
	chmodSync(join(bin, "claude"), 0o755);
	const argvFile = join(skillDir, "argv.txt");
	const env: Record<string, string> = { PATH: `${bin}:${process.env.PATH}`, FAKE_ARGV: argvFile, FAKE_EXIT: "0" };
	if (result !== null) env.FAKE_RESULT = writeResult(result);
	else env.FAKE_EXIT = "3";
	const out = cliWithEnv(env, "run", skillDir, ...args);
	const argv = existsSync(argvFile) ? readFileSync(argvFile, "utf8").trimEnd().split("\n") : null;
	return { ...out, argv };
}

beforeEach(() => {
	skillDir = mkdtempSync(join(tmpdir(), "ef-cli-"));
	writeFileSync(join(skillDir, "skill.json"), JSON.stringify({ name: "demo", version: "1.2.3" }));
	mkdirSync(join(skillDir, "evals", "case-a"), { recursive: true });
	writeFileSync(join(skillDir, "evals", "case-a", "prompt.md"), "Do the thing.\n");
	writeFileSync(
		join(skillDir, "evals", "rules.json"),
		JSON.stringify({
			rules: [{ id: "R1", states: "SKILL.md", origin: "skills/demo/SKILL.md", cases: ["case-a"] }],
			sandboxSensitive: [],
			vacuousWithout: [],
			unclaimed: [],
		}),
	);
});

afterEach(() => {
	rmSync(skillDir, { recursive: true, force: true });
});

test("diff with no baseline exits 0 and says there is no baseline", () => {
	const out = cli("diff", skillDir, writeResult(result([1, 1], [0, 0])));
	expect(out.code).toBe(0);
	expect(out.stdout).toContain("no baseline");
});

test("diff exits 1 when the result regresses against the baseline", () => {
	writeBaseline("opus");
	const out = cli("diff", skillDir, writeResult(result([0, 0], [0, 0])));
	expect(out.code).toBe(1);
});

test("diff compares against the model named by --against", () => {
	writeBaseline("sonnet");
	const out = cli("diff", skillDir, writeResult(result([0, 0], [0, 0])), "--against", "sonnet");
	expect(out.code).toBe(1);
	expect(out.stdout).toContain("against baseline sonnet");
});

test("diff does not flag a drop within --tolerance", () => {
	writeBaseline("opus");
	const out = cli("diff", skillDir, writeResult(result([1, 0], [0, 0])), "--tolerance", "0.5");
	expect(out.code).toBe(0);
});

test("accept writes the reduced baseline as two-space JSON with a trailing newline", () => {
	const out = cli("accept", skillDir, writeResult(result([1, 0.5], [0, 0])));
	expect(out.code).toBe(0);
	const text = readFileSync(join(skillDir, "evals", "baselines", "opus.json"), "utf8");
	const expected = {
		model: "opus",
		judgeModel: "haiku",
		claudeVersion: "2.1.0",
		skillVersion: "1.2.3",
		date: "2026-10-01T00:00:00.000Z",
		cases: { "case-a": { with: [1, 0.5], without: [0, 0] } },
	};
	expect(text).toBe(`${JSON.stringify(expected, null, 2)}\n`);
});

test("an unknown subcommand prints usage to stderr and exits 2", () => {
	const out = cli("frobnicate");
	expect(out.code).toBe(2);
	expect(out.stderr).toContain("usage");
});

test("diff without a result path prints usage and exits 2", () => {
	const out = cli("diff", skillDir);
	expect(out.code).toBe(2);
	expect(out.stderr).toContain("usage");
});

test("diff with an unreadable result file exits 2 and names the file", () => {
	const missing = join(skillDir, "nope.json");
	const out = cli("diff", skillDir, missing);
	expect(out.code).toBe(2);
	expect(out.stderr).toContain(missing);
});

test("run without --model exits 2", () => {
	const out = cli("run", skillDir);
	expect(out.code).toBe(2);
	expect(out.stderr).toContain("--model");
});

function writeRawBaseline(text: string): void {
	mkdirSync(join(skillDir, "evals", "baselines"), { recursive: true });
	writeFileSync(join(skillDir, "evals", "baselines", "opus.json"), text);
}

test("diff exits 2 naming the file when the baseline is null", () => {
	writeRawBaseline("null");
	const out = cli("diff", skillDir, writeResult(result([0, 0], [0, 0])));
	expect(out.code).toBe(2);
	expect(out.stderr).toContain(join(skillDir, "evals", "baselines", "opus.json"));
});

test("diff exits 2 naming the file when the baseline is an empty object", () => {
	writeRawBaseline("{}");
	const out = cli("diff", skillDir, writeResult(result([0, 0], [0, 0])));
	expect(out.code).toBe(2);
	expect(out.stderr).toContain(join(skillDir, "evals", "baselines", "opus.json"));
});

test("diff exits 2 when a baseline score is a string", () => {
	writeRawBaseline(
		JSON.stringify({
			model: "opus",
			judgeModel: "haiku",
			claudeVersion: "2.0.0",
			skillVersion: "1.2.0",
			date: "2026-09-01T00:00:00.000Z",
			cases: { "case-a": { with: ["1", 1], without: [0, 0] } },
		}),
	);
	const out = cli("diff", skillDir, writeResult(result([0, 0], [0, 0])));
	expect(out.code).toBe(2);
	expect(out.stderr).toContain(join(skillDir, "evals", "baselines", "opus.json"));
});

test("diff rejects an unknown flag with usage instead of ignoring it", () => {
	writeBaseline("sonnet");
	const out = cli("diff", skillDir, writeResult(result([0, 0], [0, 0])), "--agianst", "sonnet");
	expect(out.code).toBe(2);
	expect(out.stderr).toContain("usage");
});

test("diff rejects an extra positional argument with usage", () => {
	const out = cli("diff", skillDir, writeResult(result([1, 1], [0, 0])), "stray");
	expect(out.code).toBe(2);
	expect(out.stderr).toContain("usage");
});

test("accept maps characters outside [A-Za-z0-9._-] in the model id to dashes in the filename", () => {
	const value = result([1, 1], [0, 0]);
	value.suite.modelOverride = "vendor/opus:1m";
	const out = cli("accept", skillDir, writeResult(value));
	expect(out.code).toBe(0);
	expect(existsSync(join(skillDir, "evals", "baselines", "vendor-opus-1m.json"))).toBe(true);
});

test("run passes the eval its fixed flags, the defaults and a json path under evals/results", () => {
	const out = runWithFake(result([1, 1], [0, 0]), "--model", "vendor/opus:1m", "--case", "case-*");
	expect(out.code).toBe(0);
	const argv = out.argv ?? [];
	const jsonPath = argv.at(-1) ?? "";
	expect(argv.slice(0, -1)).toEqual([
		"plugin", "eval", skillDir,
		"--scaffold",
		"--allow-tools", "Bash", "Write", "Edit",
		"--ablation", "with-without",
		"--model", "vendor/opus:1m",
		"--judge-model", "vendor/opus:1m",
		"--runs", "3",
		"-j", "2",
		"--case", "case-*",
		"--no-publish",
		"--json",
	]);
	expect(jsonPath.startsWith(join(skillDir, "evals", "results", "fresh-vendor-opus-1m-"))).toBe(true);
	expect(jsonPath).toMatch(/fresh-vendor-opus-1m-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z\.json$/);
});

test("run passes --runs and -j through when given", () => {
	const out = runWithFake(result([1, 1], [0, 0]), "--model", "opus", "--runs", "5", "-j", "4");
	const argv = out.argv ?? [];
	expect(argv.slice(argv.indexOf("--runs"), argv.indexOf("--runs") + 4)).toEqual(["--runs", "5", "-j", "4"]);
});

test("run exits 2 when the eval fails and writes no result", () => {
	const out = runWithFake(null, "--model", "opus");
	expect(out.code).toBe(2);
	expect(out.stderr).toContain("wrote no result");
});

test("run hands the result to diff, printing the report and exiting 1 on a regression", () => {
	writeBaseline("opus");
	const out = runWithFake(result([0, 0], [0, 0]), "--model", "opus");
	expect(out.code).toBe(1);
	expect(out.stdout).toContain("opus against baseline opus");
});

test("run does not spawn the eval when skill.json has no version", () => {
	writeFileSync(join(skillDir, "skill.json"), JSON.stringify({ name: "demo" }));
	const out = runWithFake(result([1, 1], [0, 0]), "--model", "opus");
	expect(out.code).toBe(2);
	expect(out.argv).toBeNull();
});

test("run does not spawn the eval when rules.json is not a manifest", () => {
	writeFileSync(join(skillDir, "evals", "rules.json"), JSON.stringify({ rules: [] }));
	const out = runWithFake(result([1, 1], [0, 0]), "--model", "opus");
	expect(out.code).toBe(2);
	expect(out.argv).toBeNull();
});

function filteredResult() {
	const value = result([1, 1], [0, 0]);
	return { ...value, suite: { ...value.suite, caseFilter: "case-*" } };
}

function erroredResult() {
	const value = result([1, 0], [0, 0]);
	const run: { error: string | null } = value.cases[0].arms.with[1];
	run.error = "sandbox timed out";
	return value;
}

test("accept refuses a result filtered with --case, since a baseline needs a full run", () => {
	const out = cli("accept", skillDir, writeResult(filteredResult()));
	expect(out.code).toBe(2);
	expect(out.stderr).toContain("full run");
	expect(existsSync(join(skillDir, "evals", "baselines", "opus.json"))).toBe(false);
});

test("accept refuses a result with an errored run and names the case and error", () => {
	const out = cli("accept", skillDir, writeResult(erroredResult()));
	expect(out.code).toBe(2);
	expect(out.stderr).toContain("case-a");
	expect(out.stderr).toContain("sandbox timed out");
	expect(existsSync(join(skillDir, "evals", "baselines", "opus.json"))).toBe(false);
});

test("diff prints a line for each errored run after the report", () => {
	const out = cli("diff", skillDir, writeResult(erroredResult()));
	expect(out.code).toBe(0);
	expect(out.stdout).toContain("errored: case-a with run 2: sandbox timed out");
});

test("diff still compares a result filtered with --case", () => {
	const out = cli("diff", skillDir, writeResult(filteredResult()));
	expect(out.code).toBe(0);
	expect(out.stdout).toContain("against no baseline");
});

test("merge writes a result beside the full one that accept then takes", () => {
	const full = join(skillDir, "full.json");
	const errored = erroredResult();
	const suite = { ...errored.suite, root: skillDir };
	writeFileSync(full, JSON.stringify({ ...errored, suite, cases: [{ ...errored.cases[0], runsPerCase: 2 }] }));
	const rerun = join(skillDir, "rerun.json");
	const filtered = filteredResult();
	writeFileSync(rerun, JSON.stringify({ ...filtered, suite: { ...filtered.suite, root: skillDir }, cases: [{ ...filtered.cases[0], runsPerCase: 2 }] }));
	const out = cli("merge", skillDir, full, rerun);
	expect(out.code).toBe(0);
	const merged = join(skillDir, "full-merged.json");
	expect(out.stdout).toContain(merged);
	expect(cli("accept", skillDir, merged).code).toBe(0);
	const baseline = JSON.parse(readFileSync(join(skillDir, "evals", "baselines", "opus.json"), "utf8"));
	expect(baseline.cases["case-a"]).toEqual({ with: [1, 1], without: [0, 0] });
});

test("merge exits 2 and writes nothing when the rerun used another model", () => {
	const full = join(skillDir, "full.json");
	const errored = erroredResult();
	const suite = { ...errored.suite, root: skillDir };
	writeFileSync(full, JSON.stringify({ ...errored, suite, cases: [{ ...errored.cases[0], runsPerCase: 2 }] }));
	const rerun = join(skillDir, "rerun.json");
	const other = filteredResult();
	const otherCase = { ...other.cases[0], runsPerCase: 2 };
	writeFileSync(rerun, JSON.stringify({ ...other, suite: { ...other.suite, root: skillDir, modelOverride: "sonnet" }, cases: [otherCase] }));
	const out = cli("merge", skillDir, full, rerun);
	expect(out.code).toBe(2);
	expect(out.stderr).toContain("differs");
	expect(existsSync(join(skillDir, "full-merged.json"))).toBe(false);
});
