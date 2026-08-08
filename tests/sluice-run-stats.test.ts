import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "..", "skills", "sluice", "scripts", "run-stats.sh");

type Line = Record<string, unknown>;

/** An assistant turn carrying prose, and optionally tool calls. */
function assistant(ts: string, text: string | null, tools: Line[] = [], usage?: Line): Line {
	const content: Line[] = [];
	if (text !== null) content.push({ type: "text", text });
	for (const t of tools) content.push(t);
	return {
		type: "assistant",
		timestamp: ts,
		isSidechain: false,
		message: {
			role: "assistant",
			content,
			usage: usage ?? { output_tokens: 100, cache_read_input_tokens: 1000 },
		},
	};
}

function toolUse(id: string, name: string, input: Line = {}): Line {
	return { type: "tool_use", id, name, input };
}

/** A user turn that is a real prompt, not a tool result. */
function userPrompt(ts: string, text: string): Line {
	return {
		type: "user",
		timestamp: ts,
		isSidechain: false,
		message: { role: "user", content: text },
	};
}

/** A user turn carrying an Agent tool's structured result. */
function agentResult(
	ts: string,
	toolUseId: string,
	res: { agentType: string; model: string; tokens: number; ms: number; tools: number },
): Line {
	return {
		type: "user",
		timestamp: ts,
		isSidechain: false,
		message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolUseId }] },
		toolUseResult: {
			agentId: `agent_${toolUseId}`,
			agentType: res.agentType,
			resolvedModel: res.model,
			status: "completed",
			totalTokens: res.tokens,
			totalDurationMs: res.ms,
			totalToolUseCount: res.tools,
		},
	};
}

function writeTranscript(lines: Line[]): string {
	const dir = mkdtempSync(join(tmpdir(), "sluice-stats-"));
	const path = join(dir, "session.jsonl");
	writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
	return path;
}

async function run(args: string[]): Promise<{ code: number; out: string; err: string }> {
	const proc = Bun.spawn(["bash", SCRIPT, ...args], { stdout: "pipe", stderr: "pipe" });
	const [out, err] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	return { code: await proc.exited, out, err };
}

/** A minimal main-channel run: announce, work, finish. */
function mainChannelRun(): Line[] {
	return [
		userPrompt("2026-08-08T09:00:00.000Z", "add a --json flag"),
		assistant("2026-08-08T09:00:10.000Z", "Main channel, new interface. Agreeing the shape first.", [
			toolUse("t1", "Bash", { command: "ls" }),
		]),
		assistant("2026-08-08T09:02:00.000Z", "Done.", [toolUse("t2", "Edit", {})], {
			output_tokens: 250,
			cache_read_input_tokens: 50_000,
		}),
	];
}

describe("run-stats: run boundaries", () => {
	test("prints nothing and exits 2 when no channel was announced", async () => {
		const path = writeTranscript([
			userPrompt("2026-08-08T09:00:00.000Z", "what does this function do?"),
			assistant("2026-08-08T09:00:05.000Z", "It normalises the path."),
		]);
		const { code, out } = await run(["--transcript", path]);
		expect(code).toBe(2);
		expect(out.trim()).toBe("");
	});

	test("exits 1 when the transcript cannot be found", async () => {
		const { code, err } = await run(["--transcript", "/nonexistent/nope.jsonl"]);
		expect(code).toBe(1);
		expect(err).toContain("transcript");
	});

	test("starts the clock at the channel announcement, not the session", async () => {
		const path = writeTranscript([
			userPrompt("2026-08-08T08:00:00.000Z", "unrelated earlier question"),
			assistant("2026-08-08T08:00:30.000Z", "Answered."),
			...mainChannelRun(),
		]);
		const { code, out } = await run(["--transcript", path]);
		expect(code).toBe(0);
		// 09:00:10 -> 09:02:00 is 1m50s. Session start would have given over an hour.
		expect(out).toContain("1m50s");
		expect(out).not.toContain("2h");
	});

	test("a previous run-stats call ends the previous run", async () => {
		const path = writeTranscript([
			// An earlier, completed deep run that already printed its ledger.
			assistant("2026-08-08T07:00:00.000Z", "Deep channel, several subsystems."),
			assistant("2026-08-08T07:30:00.000Z", "Handing back.", [
				toolUse("old", "Bash", { command: "bash ~/.claude/skills/sluice/scripts/run-stats.sh" }),
			]),
			...mainChannelRun(),
		]);
		const { out } = await run(["--transcript", path]);
		expect(out).toContain("main");
		expect(out).not.toContain("deep");
		expect(out).toContain("1m50s");
	});
});

describe("run-stats: the ledger", () => {
	test("reports channel, elapsed, tools, tokens", async () => {
		const path = writeTranscript(mainChannelRun());
		const { code, out } = await run(["--transcript", path]);
		expect(code).toBe(0);
		expect(out).toMatch(/channel\s+main/);
		expect(out).toMatch(/elapsed\s+1m50s/);
		expect(out).toMatch(/tools\s+2\b/);
		expect(out).toContain("1 bash");
		expect(out).toContain("1 edit");
		// 100 + 250 output tokens; 1000 + 50000 cache read.
		expect(out).toMatch(/tokens\s+350 out/);
		expect(out).toContain("51.0k cache read");
	});

	test("ignores a channel named in the body of ordinary prose", async () => {
		const path = writeTranscript([
			userPrompt("2026-08-08T08:00:00.000Z", "analyse this transcript"),
			// A channel named early, but not as the announcement. A session about
			// sluice itself is the case that breaks a looser matcher.
			assistant(
				"2026-08-08T08:00:30.000Z",
				'The quirk came from prose: "deep channel" appeared in my analysis, ' +
					"not in a routing line, so the clock started in the wrong place.",
			),
			assistant(
				"2026-08-08T08:01:00.000Z",
				"Under a no-subagents directive the deep channel ships with no review tier.",
			),
			...mainChannelRun(),
		]);
		const { out } = await run(["--transcript", path]);
		expect(out).toMatch(/channel\s+main$/m);
		expect(out).toContain("1m50s");
	});

	test("names the escalation trail when the channel changed", async () => {
		const path = writeTranscript([
			userPrompt("2026-08-08T09:00:00.000Z", "tweak the parser"),
			assistant("2026-08-08T09:00:10.000Z", "Fast channel, existing interfaces."),
			assistant("2026-08-08T09:01:00.000Z", "**Main channel** now: this turns out to need a new interface."),
			assistant("2026-08-08T09:02:00.000Z", "Done."),
		]);
		const { out } = await run(["--transcript", path]);
		expect(out).toMatch(/channel\s+fast → main/);
	});

	test("counts time spent waiting on the partner", async () => {
		const path = writeTranscript([
			userPrompt("2026-08-08T09:00:00.000Z", "build it"),
			assistant("2026-08-08T09:00:10.000Z", "Deep channel, several subsystems."),
			assistant("2026-08-08T09:01:00.000Z", "Design written. Stopping for sign-off."),
			// Partner takes three minutes to reply.
			userPrompt("2026-08-08T09:04:00.000Z", "approved"),
			assistant("2026-08-08T09:05:00.000Z", "Done."),
		]);
		const { out } = await run(["--transcript", path]);
		expect(out).toMatch(/elapsed\s+4m50s/);
		expect(out).toContain("3m0s of that waiting on you");
	});

	test("counts an answered question as waiting too", async () => {
		const path = writeTranscript([
			assistant("2026-08-08T09:00:00.000Z", "Main channel, new interface.", [
				toolUse("q1", "AskUserQuestion", {}),
			]),
			{
				type: "user",
				timestamp: "2026-08-08T09:01:30.000Z",
				isSidechain: false,
				message: { role: "user", content: [{ type: "tool_result", tool_use_id: "q1" }] },
				toolUseResult: { questions: [], answers: { "Block shape": "Ledger" } },
			},
			assistant("2026-08-08T09:02:00.000Z", "Done."),
		]);
		const { out } = await run(["--transcript", path]);
		expect(out).toContain("1m30s of that waiting on you");
	});

	test("passes the test result through verbatim, and says so when absent", async () => {
		const path = writeTranscript(mainChannelRun());
		const withTests = await run(["--transcript", path, "--tests", "Rust 3248/3248 · TS 2267/2267"]);
		expect(withTests.out).toMatch(/tests\s+Rust 3248\/3248 · TS 2267\/2267/);

		const without = await run(["--transcript", path]);
		expect(without.out).toMatch(/tests\s+not reported/);
	});
});

describe("run-stats: the diff", () => {
	test("reports insertions, deletions and file count against the base", async () => {
		const repo = mkdtempSync(join(tmpdir(), "sluice-repo-"));
		const sh = (cmd: string) =>
			Bun.spawnSync(["bash", "-c", cmd], { cwd: repo, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
		sh("git init -q -b master && echo one > a.txt && git add -A && git commit -qm base");
		const base = new TextDecoder().decode(sh("git rev-parse HEAD").stdout).trim();
		// Two added lines in a new file, one line replaced in the existing one.
		sh("printf 'x\\ny\\n' > b.txt && echo two > a.txt");

		const path = writeTranscript(mainChannelRun());
		const proc = Bun.spawn(["bash", SCRIPT, "--transcript", path, "--base", base], {
			cwd: repo,
			stdout: "pipe",
			stderr: "pipe",
		});
		const out = await new Response(proc.stdout).text();
		await proc.exited;
		expect(out).toMatch(/diff\s+\+3 −1 across 2 files/);
	});
});

describe("run-stats: agents", () => {
	test("says so plainly when nothing was dispatched", async () => {
		const path = writeTranscript(mainChannelRun());
		const { out } = await run(["--transcript", path]);
		expect(out).toMatch(/agents\s+none dispatched/);
	});

	test("totals dispatched agents and lists one row each", async () => {
		const path = writeTranscript([
			userPrompt("2026-08-08T09:00:00.000Z", "build it"),
			assistant("2026-08-08T09:00:10.000Z", "Deep channel, several subsystems.", [
				toolUse("a1", "Agent", { description: "Task 1 implementer" }),
			]),
			agentResult("2026-08-08T09:01:14.000Z", "a1", {
				agentType: "general-purpose",
				model: "claude-sonnet-5",
				tokens: 112_000,
				ms: 64_000,
				tools: 18,
			}),
			assistant("2026-08-08T09:01:20.000Z", "Now the review.", [
				toolUse("a2", "Agent", { description: "Task 1 reviewer" }),
			]),
			agentResult("2026-08-08T09:04:31.000Z", "a2", {
				agentType: "general-purpose",
				model: "claude-opus-5",
				tokens: 201_000,
				ms: 191_000,
				tools: 31,
			}),
			assistant("2026-08-08T09:05:00.000Z", "Done."),
		]);
		const { out } = await run(["--transcript", path]);
		expect(out).toMatch(/agents\s+2 dispatched · 313k tok/);
		expect(out).toContain("Task 1 implementer");
		expect(out).toContain("sonnet-5");
		expect(out).toContain("18 tools");
		expect(out).toContain("Task 1 reviewer");
		expect(out).toContain("opus-5");
		expect(out).toContain("3m11s");
	});

	test("caps a long table at the dearest ten and says what it cut", async () => {
		const lines: Line[] = [
			assistant("2026-08-08T09:00:00.000Z", "Deep channel, several subsystems."),
		];
		// 20 agents, each costing 1000 tokens more than the last.
		for (let i = 0; i < 20; i++) {
			const id = `a${i}`;
			lines.push(
				assistant(`2026-08-08T09:${String(i).padStart(2, "0")}:00.000Z`, null, [
					toolUse(id, "Agent", { description: `worker ${i}` }),
				]),
			);
			lines.push(
				agentResult(`2026-08-08T09:${String(i).padStart(2, "0")}:30.000Z`, id, {
					agentType: "general-purpose",
					model: "claude-haiku-4-5-20251001",
					tokens: 1000 * (i + 1),
					ms: 1000,
					tools: 1,
				}),
			);
		}
		const { out } = await run(["--transcript", writeTranscript(lines)]);
		expect(out).toContain("20 dispatched");
		// Dearest ten are workers 10..19; the cheapest ten are summarised.
		expect(out).toContain("worker 19");
		expect(out).toContain("worker 10");
		expect(out).not.toContain("worker 9");
		expect(out).toContain("+10 more · 55.0k tok (dearest 10 shown)");
	});

	test("flags an agent that did not complete", async () => {
		const path = writeTranscript([
			assistant("2026-08-08T09:00:10.000Z", "Deep channel, several subsystems.", [
				toolUse("a1", "Agent", { description: "Task 1 implementer" }),
			]),
			{
				type: "user",
				timestamp: "2026-08-08T09:01:00.000Z",
				isSidechain: false,
				message: { role: "user", content: [{ type: "tool_result", tool_use_id: "a1" }] },
				toolUseResult: {
					agentId: "agent_a1",
					agentType: "general-purpose",
					resolvedModel: "claude-sonnet-5",
					status: "error",
					totalTokens: 900,
					totalDurationMs: 5000,
					totalToolUseCount: 1,
				},
			},
			assistant("2026-08-08T09:02:00.000Z", "Done."),
		]);
		const { out } = await run(["--transcript", path]);
		expect(out).toContain("error");
	});
});
