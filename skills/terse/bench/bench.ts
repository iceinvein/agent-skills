import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import {
	type ArmSummary,
	type JudgedPair,
	type JudgeOutput,
	type RunRecord,
	summariseArms,
	toVerdict,
} from "./stats";

type Prompt = {
	id: string;
	category: string;
	prompt: string;
	files?: Record<string, string>;
	/** ES module source run with node in the workspace afterwards; exit 0 means the task was done. */
	check?: string;
};

const BENCH_DIR = import.meta.dir;
const TASK_TOOLS = "Read,Edit,Glob,Grep,Bash";
const TASK_ALLOWED = "Read,Edit,Glob,Grep,Bash(node:*)";
const CLAUDE_TIMEOUT_MS = 10 * 60 * 1000;
const CHECK_TIMEOUT_MS = 30 * 1000;

// Only what the CLI needs to find itself and its login. Anything else in the
// operator's shell (MAX_THINKING_TOKENS, an effort override, CLAUDE_CONFIG_DIR)
// would change every arm without showing up in the results.
const CHILD_ENV_KEYS = ["HOME", "PATH", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "TERM"];
const childEnv = Object.fromEntries(
	CHILD_ENV_KEYS.filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key] as string]),
);

const sha1 = (text: string) => createHash("sha1").update(text).digest("hex");

function terseSystemPrompt(skillPath: string, level: string): string {
	const skill = readFileSync(skillPath, "utf8");
	const body = skill.replace(/^---\n[\s\S]*?\n---\n/, "");
	return body.replaceAll("$1", level);
}

/** Each arm's system-prompt addition. Plain gets none. */
function armPrompts(skillPath: string): Record<string, string | null> {
	return { plain: null, concise: "Be concise.", terse: terseSystemPrompt(skillPath, "tight") };
}

type ClaudeResult = {
	result: string;
	is_error: boolean;
	num_turns: number;
	total_cost_usd: number;
	structured_output?: unknown;
	usage?: { output_tokens?: number; output_tokens_details?: { thinking_tokens?: number } };
	modelUsage?: Record<string, { outputTokens: number; thinkingTokens?: number }>;
};

/**
 * Runs `claude -p` with no user, project or local settings, so the operator's
 * own CLAUDE.md, skills and hooks (terse's SessionStart hook among them) stay
 * out of every arm. The prompt goes in on stdin because --allowedTools is
 * variadic and would swallow a positional prompt.
 */
function claude(args: string[], stdin: string, cwd: string): Promise<ClaudeResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(
			"claude",
			["-p", "--output-format", "json", "--setting-sources=", "--strict-mcp-config", "--no-session-persistence", ...args],
			{ cwd, env: childEnv, stdio: ["pipe", "pipe", "pipe"], timeout: CLAUDE_TIMEOUT_MS },
		);
		let out = "";
		let err = "";
		child.stdout.on("data", (chunk) => {
			out += chunk;
		});
		child.stderr.on("data", (chunk) => {
			err += chunk;
		});
		child.on("error", reject);
		child.on("close", (code) => {
			try {
				resolve(JSON.parse(out) as ClaudeResult);
			} catch {
				reject(new Error(`claude exited ${code} without JSON: ${err.slice(0, 500)}${out.slice(0, 500)}`));
			}
		});
		child.stdin.end(stdin);
	});
}

function outputTokens(res: ClaudeResult, model: string): { output: number; thinking: number } {
	const usage = Object.entries(res.modelUsage ?? {});
	const entries = usage.filter(([name]) => name.startsWith(model));
	if (usage.length > 0 && entries.length === 0) {
		throw new Error(`--model ${model} matches none of ${usage.map(([name]) => name).join(", ")}; pass the full model id`);
	}
	if (entries.length > 0) {
		return {
			output: entries.reduce((sum, [, u]) => sum + u.outputTokens, 0),
			thinking: entries.reduce((sum, [, u]) => sum + (u.thinkingTokens ?? 0), 0),
		};
	}
	if (res.usage?.output_tokens === undefined) throw new Error(`no usage for ${model} in claude output`);
	return { output: res.usage.output_tokens, thinking: res.usage.output_tokens_details?.thinking_tokens ?? 0 };
}

// A fix that loops forever is a failed check, killed by the timeout.
function runCheck(check: string, cwd: string): Promise<boolean> {
	return new Promise((resolve, reject) => {
		const child = spawn("node", ["--input-type=module", "-e", check], {
			cwd,
			env: childEnv,
			stdio: "ignore",
			timeout: CHECK_TIMEOUT_MS,
		});
		child.on("error", reject);
		child.on("close", (code) => resolve(code === 0));
	});
}

async function runOne(
	p: Prompt,
	arm: string,
	append: string | null,
	sample: number,
	model: string,
	cliVersion: string,
): Promise<RunRecord> {
	const cwd = mkdtempSync(join(tmpdir(), "terse-bench-"));
	try {
		for (const [path, content] of Object.entries(p.files ?? {})) {
			mkdirSync(dirname(join(cwd, path)), { recursive: true });
			writeFileSync(join(cwd, path), content);
		}
		const tools = p.files
			? ["--tools", TASK_TOOLS, "--allowedTools", TASK_ALLOWED, "--max-turns", "20"]
			: ["--tools", ""];
		const args = ["--model", model, "--max-budget-usd", "2", ...tools];
		if (append !== null) args.push("--append-system-prompt", append);
		const res = await claude(args, p.prompt, cwd);
		const tokens = outputTokens(res, model);
		return {
			promptId: p.id,
			category: p.category,
			arm,
			sample,
			model,
			outputTokens: tokens.output,
			thinkingTokens: tokens.thinking,
			visibleTokens: tokens.output - tokens.thinking,
			words: res.result.split(/\s+/).filter(Boolean).length,
			costUsd: res.total_cost_usd,
			turns: res.num_turns,
			isError: res.is_error,
			checkPassed: p.check ? await runCheck(p.check, cwd) : null,
			result: res.result,
			promptSha: append === null ? null : sha1(append),
			cliVersion,
		};
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
}

async function pool(jobs: (() => Promise<void>)[], concurrency: number): Promise<void> {
	let next = 0;
	const worker = async () => {
		while (next < jobs.length) {
			const job = jobs[next++];
			await job();
		}
	};
	await Promise.all(Array.from({ length: concurrency }, worker));
}

function readJsonl<T>(path: string): T[] {
	if (!existsSync(path)) return [];
	return readFileSync(path, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as T);
}

const runKey = (promptId: string, arm: string, sample: number) => `${promptId}/${arm}/${sample}`;

function cliVersion(): string {
	const result = Bun.spawnSync(["claude", "--version"], { env: childEnv });
	if (result.exitCode !== 0) throw new Error(`claude --version failed: ${result.stderr.toString()}`);
	return result.stdout.toString().trim();
}

async function run(
	dir: string,
	model: string,
	samples: number,
	concurrency: number,
	only: string[] | null,
	skillPath: string,
	arms: string[] | null,
) {
	const prompts = (JSON.parse(readFileSync(join(BENCH_DIR, "prompts.json"), "utf8")) as Prompt[]).filter(
		(p) => only === null || only.includes(p.id),
	);
	const runsPath = join(dir, "runs.jsonl");
	const version = cliVersion();
	const recorded = readJsonl<RunRecord>(runsPath);
	// One results directory measures one prompt per arm. A run against another
	// SKILL.md would be skipped as already done, or mixed into the same report.
	for (const [arm, append] of Object.entries(armPrompts(skillPath))) {
		if (arms !== null && !arms.includes(arm)) continue;
		const promptSha = append === null ? null : sha1(append);
		const other = recorded.find((r) => r.arm === arm && (r.promptSha ?? null) !== promptSha);
		if (other) {
			throw new Error(`${dir} already holds ${arm} runs from a different prompt (${other.promptSha ?? "unrecorded"}); use a new --dir`);
		}
	}
	const done = new Set(recorded.filter((r) => !r.isError).map((r) => runKey(r.promptId, r.arm, r.sample)));
	const jobs: (() => Promise<void>)[] = [];
	for (const p of prompts) {
		for (const [arm, append] of Object.entries(armPrompts(skillPath))) {
			if (arms !== null && !arms.includes(arm)) continue;
			for (let sample = 0; sample < samples; sample++) {
				if (done.has(runKey(p.id, arm, sample))) continue;
				jobs.push(async () => {
					try {
						const record = await runOne(p, arm, append, sample, model, version);
						appendFileSync(runsPath, `${JSON.stringify(record)}\n`);
						const check = record.checkPassed === null ? "" : record.checkPassed ? " check ok" : " CHECK FAILED";
						console.log(`${runKey(p.id, arm, sample)}  ${record.visibleTokens} tok  $${record.costUsd.toFixed(3)}${check}`);
					} catch (error) {
						console.error(`${runKey(p.id, arm, sample)}  FAILED: ${(error as Error).message}`);
					}
				});
			}
		}
	}
	console.log(`${jobs.length} runs to do, ${done.size} already recorded (${version})`);
	await pool(jobs, concurrency);
}

const JUDGE_SCHEMA = {
	type: "object",
	properties: {
		same_conclusion: { type: "boolean" },
		missing_from_1: { type: "array", items: { type: "string" } },
		missing_from_2: { type: "array", items: { type: "string" } },
		incorrect_in_1: { type: "array", items: { type: "string" } },
		incorrect_in_2: { type: "array", items: { type: "string" } },
		easier_to_read: { type: "string", enum: ["1", "2", "same"] },
	},
	required: ["same_conclusion", "missing_from_1", "missing_from_2", "incorrect_in_1", "incorrect_in_2", "easier_to_read"],
};

function judgePrompt(question: string, first: string, second: string): string {
	return `Two assistants answered the same request. Compare their replies.

<request>
${question}
</request>

<response_1>
${first}
</response_1>

<response_2>
${second}
</response_2>

Report:
- same_conclusion: do both reach the same answer, recommendation or diagnosis? Differences in length, wording or detail do not count; only a different verdict or a different root cause does.
- missing_from_1 / missing_from_2: points present in the other response that a reader of this one would need to act correctly or understand the answer, and that this one lacks. Leave out examples, background and nice-to-have extras. Empty when nothing needed is missing.
- incorrect_in_1 / incorrect_in_2: statements in that response that are factually wrong. Empty when none.
- easier_to_read: which reply a busy engineer would rather receive, given that both are about the request above. "same" when there is no clear preference.`;
}

/** Deterministic order per pair, so a rerun shows the judge the same layout. */
function swapFor(key: string): boolean {
	return (createHash("sha1").update(key).digest()[0] & 1) === 1;
}

async function judge(dir: string, judgeModel: string, concurrency: number) {
	const prompts = new Map(
		(JSON.parse(readFileSync(join(BENCH_DIR, "prompts.json"), "utf8")) as Prompt[]).map((p) => [p.id, p]),
	);
	const runs = readJsonl<RunRecord>(join(dir, "runs.jsonl")).filter((r) => !r.isError);
	const byKey = new Map(runs.map((r) => [runKey(r.promptId, r.arm, r.sample), r]));
	const judgedPath = join(dir, "judged.jsonl");
	const done = new Set(readJsonl<JudgedPair>(judgedPath).map((j) => runKey(j.promptId, j.arm, j.sample)));
	const plainSamples = new Map<string, number>();
	for (const r of runs.filter((run) => run.arm === "plain")) {
		plainSamples.set(r.promptId, Math.max(plainSamples.get(r.promptId) ?? 0, r.sample + 1));
	}

	const jobs: (() => Promise<void>)[] = [];
	for (const [key, candidate] of byKey) {
		if (done.has(key)) continue;
		// Plain is judged against the next plain sample: the noise floor every other arm is read against.
		const n = plainSamples.get(candidate.promptId) ?? 0;
		const referenceSample = candidate.arm === "plain" ? (candidate.sample + 1) % n : candidate.sample;
		const reference = byKey.get(runKey(candidate.promptId, "plain", referenceSample));
		if (!reference || reference === candidate) {
			console.error(`skip ${key}: no plain sample ${referenceSample} to compare against`);
			continue;
		}
		const question = (prompts.get(candidate.promptId) as Prompt).prompt;
		jobs.push(async () => {
			const swapped = swapFor(key);
			const [first, second] = swapped ? [candidate.result, reference.result] : [reference.result, candidate.result];
			const cwd = mkdtempSync(join(tmpdir(), "terse-judge-"));
			try {
				const res = await claude(
					["--model", judgeModel, "--tools", "", "--json-schema", JSON.stringify(JUDGE_SCHEMA)],
					judgePrompt(question, first, second),
					cwd,
				);
				if (res.is_error || !res.structured_output) throw new Error(`judge returned no verdict: ${res.result}`);
				const pair: JudgedPair = {
					promptId: candidate.promptId,
					arm: candidate.arm,
					sample: candidate.sample,
					verdict: toVerdict(res.structured_output as JudgeOutput, swapped),
				};
				appendFileSync(judgedPath, `${JSON.stringify({ ...pair, costUsd: res.total_cost_usd })}\n`);
				console.log(`judged ${key}`);
			} catch (error) {
				console.error(`judge ${key} FAILED: ${(error as Error).message}`);
			} finally {
				rmSync(cwd, { recursive: true, force: true });
			}
		});
	}
	console.log(`${jobs.length} pairs to judge, ${done.size} already judged`);
	await pool(jobs, concurrency);
}

const pct = (v: number | null) => (v === null ? "n/a" : `${Math.round(v * 100)}%`);
const num = (v: number) => v.toFixed(0);

const ARM_ORDER = ["plain", "concise", "terse"];

function table(unordered: ArmSummary[]): string {
	const rows = [...unordered].sort((a, b) => ARM_ORDER.indexOf(a.arm) - ARM_ORDER.indexOf(b.arm));
	const lines = [
		"| Arm | Runs | Visible tokens (mean) | vs plain | Thinking tokens | Words | Cost/run | Checks | Judged | Lost a needed point | Conclusion changed | Incorrect | Easier to read: arm / same / plain |",
		"|---|---|---|---|---|---|---|---|---|---|---|---|---|",
	];
	for (const r of rows) {
		const ratio = r.ratioToPlain === null ? "n/a" : `${Math.round((r.ratioToPlain - 1) * 100)}%`;
		const checks = r.checksRun === 0 ? "n/a" : `${r.checksPassed}/${r.checksRun}`;
		lines.push(
			`| ${r.arm} | ${r.runs}${r.errors ? ` (+${r.errors} errored)` : ""} | ${num(r.meanVisibleTokens)} | ${ratio} | ${num(r.meanThinkingTokens)} | ${num(r.meanWords)} | $${r.meanCostUsd.toFixed(3)} | ${checks} | ${r.judged} | ${pct(r.lostFactRate)} | ${pct(r.conclusionChangedRate)} | ${pct(r.candidateIncorrectRate)} | ${r.readability.candidate} / ${r.readability.same} / ${r.readability.reference} |`,
		);
	}
	return lines.join("\n");
}

function report(dir: string) {
	const runsPath = join(dir, "runs.jsonl");
	if (!existsSync(runsPath)) throw new Error(`no runs.jsonl in ${dir}`);
	const runs = readJsonl<RunRecord>(runsPath);
	const judged = readJsonl<JudgedPair & { costUsd: number }>(join(dir, "judged.jsonl"));
	const categories = [...new Set(runs.map((r) => r.category))];
	const runCost = runs.reduce((sum, r) => sum + r.costUsd, 0);
	const judgeCost = judged.reduce((sum, j) => sum + j.costUsd, 0);
	const promptCategory = new Map(runs.map((r) => [r.promptId, r.category]));

	const sections = [
		`# terse benchmark: ${[...new Set(runs.map((r) => r.model))].join(", ")}`,
		`Runs cost $${runCost.toFixed(2)}, judging $${judgeCost.toFixed(2)}. The plain row's judged columns compare two plain samples with each other: the noise floor.`,
		"## All prompts",
		table(summariseArms(runs, judged)),
	];
	for (const category of categories) {
		sections.push(
			`## ${category}`,
			table(
				summariseArms(
					runs.filter((r) => r.category === category),
					judged.filter((j) => promptCategory.get(j.promptId) === category),
				),
			),
		);
	}
	const text = `${sections.join("\n\n")}\n`;
	writeFileSync(join(dir, "report.md"), text);
	console.log(text);
}

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		dir: { type: "string" },
		model: { type: "string" },
		"judge-model": { type: "string" },
		samples: { type: "string", default: "3" },
		concurrency: { type: "string", default: "6" },
		prompts: { type: "string" },
		arms: { type: "string" },
		skill: { type: "string" },
	},
});

const command = positionals[0];

if (command === "run") {
	if (!values.model) throw new Error("run needs --model");
	const dir = values.dir ?? join(BENCH_DIR, "results", new Date().toISOString().replaceAll(":", "-"));
	mkdirSync(dir, { recursive: true });
	await run(
		dir,
		values.model,
		Number(values.samples),
		Number(values.concurrency),
		values.prompts?.split(",") ?? null,
		values.skill ?? join(BENCH_DIR, "..", "SKILL.md"),
		values.arms?.split(",") ?? null,
	);
	console.log(`results in ${dir}`);
} else if (command === "judge") {
	if (!values.dir || !values["judge-model"]) throw new Error("judge needs --dir and --judge-model");
	await judge(values.dir, values["judge-model"], Number(values.concurrency));
} else if (command === "report") {
	if (!values.dir) throw new Error("report needs --dir");
	report(values.dir);
} else {
	throw new Error("usage: bench.ts run|judge|report --dir <results dir> [--model m] [--judge-model m]");
}
