import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
	const proc = Bun.spawnSync(["bun", CLI, ...args], { stdout: "pipe", stderr: "pipe" });
	return { code: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
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
