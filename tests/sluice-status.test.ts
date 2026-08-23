import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "..", "skills", "sluice", "scripts", "status.sh");

type Run = {
	schema: number;
	topic: string;
	channel: string;
	started: string;
	plan?: string;
	record?: string;
	preflight?: Record<string, string>;
	tasks: Array<Record<string, unknown>>;
};

function repo(): string {
	return mkdtempSync(join(tmpdir(), "sluice-status-"));
}

function run(dir: string, ...args: string[]) {
	// Every call is bounded. A flag loop that fails to consume its argument spins
	// instead of erroring, and the caller here is an agent issuing these from a
	// tool call, so a hang costs the whole session rather than one command.
	const proc = Bun.spawnSync({ cmd: ["bash", SCRIPT, ...args, "--dir", dir], timeout: 5000 });
	return {
		code: proc.exitCode,
		signal: proc.signalCode,
		out: proc.stdout.toString(),
		err: proc.stderr.toString(),
	};
}

/** Replaces the run state with something jq cannot parse. */
function corrupt(dir: string) {
	writeFileSync(join(dir, ".sluice", "run.json"), "{ truncated");
}

function state(dir: string): Run {
	return JSON.parse(readFileSync(join(dir, ".sluice", "run.json"), "utf8"));
}

/** A run with `n` tasks, all `todo`, named T1..Tn. */
function seeded(n: number, channel = "deep"): string {
	const dir = repo();
	run(dir, "init", "--topic", "widget", "--channel", channel);
	for (let i = 1; i <= n; i++) run(dir, "task", String(i), "--name", `T${i}`);
	return dir;
}

describe("status.sh syntax", () => {
	test("parses under bash -n", () => {
		const proc = Bun.spawnSync(["bash", "-n", SCRIPT]);
		expect(proc.stderr.toString()).toBe("");
		expect(proc.exitCode).toBe(0);
	});
});

describe("init", () => {
	test("writes the run state with channel, topic and a start time", () => {
		const dir = repo();
		const r = run(dir, "init", "--topic", "widget", "--channel", "deep");
		expect(r.code).toBe(0);

		const s = state(dir);
		expect(s.schema).toBe(1);
		expect(s.topic).toBe("widget");
		expect(s.channel).toBe("deep");
		expect(s.tasks).toEqual([]);
		// An ISO-8601 instant, so a later run is orderable against an earlier one.
		expect(s.started).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
	});

	test("records the plan and record paths when given", () => {
		const dir = repo();
		run(
			dir,
			"init",
			"--topic",
			"widget",
			"--channel",
			"deep",
			"--plan",
			"docs/plans/2026-08-23-widget.md",
			"--record",
			"docs/plans/2026-08-23-widget-record.md",
		);
		const s = state(dir);
		expect(s.plan).toBe("docs/plans/2026-08-23-widget.md");
		expect(s.record).toBe("docs/plans/2026-08-23-widget-record.md");
	});

	// Two runs in one tree means the second silently inherits the first's task rows,
	// which is the exact drift the file exists to prevent. Overwriting is a decision,
	// so it needs a flag.
	test("refuses to clobber a live run, and says which one is live", () => {
		const dir = repo();
		run(dir, "init", "--topic", "widget", "--channel", "deep");
		const r = run(dir, "init", "--topic", "other", "--channel", "fast");
		expect(r.code).toBe(3);
		expect(r.err).toMatch(/widget/);
		expect(state(dir).topic).toBe("widget");
	});

	test("--force replaces the live run", () => {
		const dir = repo();
		run(dir, "init", "--topic", "widget", "--channel", "deep");
		const r = run(dir, "init", "--topic", "other", "--channel", "fast", "--force");
		expect(r.code).toBe(0);
		expect(state(dir).topic).toBe("other");
	});

	test("rejects a channel outside the four", () => {
		const dir = repo();
		const r = run(dir, "init", "--topic", "widget", "--channel", "turbo");
		expect(r.code).toBe(4);
		expect(r.err).toMatch(/turbo/);
	});
});

describe("task", () => {
	test("a new id needs a name, since a row with none reads as nothing", () => {
		const dir = repo();
		run(dir, "init", "--topic", "widget", "--channel", "deep");
		const r = run(dir, "task", "1", "--status", "active");
		expect(r.code).toBe(4);
		expect(r.err).toMatch(/--name/);
		expect(state(dir).tasks).toEqual([]);
	});

	test("adds a row defaulting to todo", () => {
		const dir = repo();
		run(dir, "init", "--topic", "widget", "--channel", "deep");
		expect(run(dir, "task", "1", "--name", "schema").code).toBe(0);

		const [t] = state(dir).tasks;
		expect(t).toMatchObject({ id: 1, name: "schema", status: "todo" });
	});

	test("upserts by id rather than appending a second row", () => {
		const dir = seeded(2);
		run(dir, "task", "1", "--status", "done", "--commit", "abc1234");

		const s = state(dir);
		expect(s.tasks).toHaveLength(2);
		expect(s.tasks[0]).toMatchObject({ id: 1, name: "T1", status: "done", commit: "abc1234" });
	});

	test("keeps rows ordered by id however they arrive", () => {
		const dir = repo();
		run(dir, "init", "--topic", "widget", "--channel", "deep");
		for (const id of ["3", "1", "2"]) run(dir, "task", id, "--name", `T${id}`);
		expect(state(dir).tasks.map((t) => t.id)).toEqual([1, 2, 3]);
	});

	test("carries base, tier, model and flips", () => {
		const dir = seeded(1);
		run(dir, "task", "1", "--base", "deadbee", "--tier", "3", "--model", "cheap", "--flips");

		expect(state(dir).tasks[0]).toMatchObject({
			base: "deadbee",
			tier: 3,
			model: "cheap",
			flips: true,
		});
	});

	test("rejects a status outside the vocabulary", () => {
		const dir = seeded(1);
		const r = run(dir, "task", "1", "--status", "nearly");
		expect(r.code).toBe(4);
		expect(r.err).toMatch(/nearly/);
		expect(state(dir).tasks[0]).toMatchObject({ status: "todo" });
	});

	test("rejects a tier outside 0-3", () => {
		const dir = seeded(1);
		expect(run(dir, "task", "1", "--tier", "4").code).toBe(4);
	});

	test("needs a live run", () => {
		const dir = repo();
		const r = run(dir, "task", "1", "--name", "schema");
		expect(r.code).toBe(2);
		expect(r.err).toMatch(/no run/i);
	});
});

describe("preflight", () => {
	test("records the three answers", () => {
		const dir = seeded(1);
		const r = run(
			dir,
			"preflight",
			"--review",
			"tier 3 only",
			"--model",
			"6 of 9 cheap",
			"--workspace",
			"one worktree per implementer",
		);
		expect(r.code).toBe(0);

		expect(state(dir).preflight).toEqual({
			review: "tier 3 only",
			model: "6 of 9 cheap",
			workspace: "one worktree per implementer",
		});
	});

	test("shows in the table, so an undischarged pre-flight is visible", () => {
		const dir = seeded(1);
		expect(run(dir, "show").out).toMatch(/pre-flight.*not recorded/i);

		run(dir, "preflight", "--review", "a", "--model", "b", "--workspace", "c");
		expect(run(dir, "show").out).not.toMatch(/not recorded/i);
	});
});

describe("show", () => {
	test("exits 2 with no run, rather than printing an empty table", () => {
		const r = run(repo(), "show");
		expect(r.code).toBe(2);
		expect(r.out).toBe("");
	});

	test("prints every task with its id, name and status", () => {
		const dir = seeded(3);
		run(dir, "task", "1", "--status", "done", "--commit", "abc1234");
		run(dir, "task", "2", "--status", "active");

		const out = run(dir, "show").out;
		for (const name of ["T1", "T2", "T3"]) expect(out).toContain(name);
		expect(out).toContain("abc1234");
		expect(out).toMatch(/1\s*\/\s*3|1 of 3/);
	});

	test("names the plan and record paths, so they need no hunting", () => {
		const dir = repo();
		run(dir, "init", "--topic", "w", "--channel", "deep", "--plan", "docs/plans/p.md", "--record", "docs/plans/r.md");
		const out = run(dir, "show").out;
		expect(out).toContain("docs/plans/p.md");
		expect(out).toContain("docs/plans/r.md");
	});

	// A name clipped to the column width reads as the whole name, and the reader
	// has no way to tell. The marker is what makes the clip visible.
	test("marks a name it had to truncate", () => {
		const dir = repo();
		run(dir, "init", "--topic", "w", "--channel", "deep");
		run(dir, "task", "1", "--name", "a task whose name runs well past any sensible column width");

		const out = run(dir, "show").out;
		expect(out).toContain("…");
		expect(out).not.toContain("sensible column width");
	});

	test("leaves a name that fits unmarked", () => {
		const dir = seeded(1);
		expect(run(dir, "show").out).not.toContain("…");
	});

	test("keeps the header aligned with the rows it heads", () => {
		const dir = seeded(1);
		const lines = run(dir, "show").out.split("\n");
		const header = lines.findIndex((l) => /\bid\s+status\b/.test(l));
		expect(header).toBeGreaterThan(-1);

		// The status column starts at the same offset in both, so a row can be read
		// against the header rather than counted out by eye.
		const at = (l: string) => l.indexOf("status") >= 0 ? l.indexOf("status") : l.indexOf("todo");
		expect(at(lines[header] as string)).toBe(at(lines[header + 1] as string));
	});

	test("--json emits the state verbatim for another reader", () => {
		const dir = seeded(2);
		const r = run(dir, "show", "--json");
		expect(r.code).toBe(0);
		expect(JSON.parse(r.out)).toEqual(state(dir));
	});
});

describe("line", () => {
	test("carries the channel, the progress and the active task", () => {
		const dir = seeded(9);
		run(dir, "task", "1", "--status", "done");
		run(dir, "task", "2", "--status", "done");
		run(dir, "task", "3", "--status", "active");

		const r = run(dir, "line");
		expect(r.code).toBe(0);
		expect(r.out.trim()).toContain("deep");
		expect(r.out.trim()).toContain("2/9");
		expect(r.out.trim()).toMatch(/T3/);
	});

	// A statusline runs on every render. Anything it prints on the no-run path is
	// permanent clutter, and anything it writes to stderr may surface as an error.
	test("is silent and succeeds when no run is live", () => {
		const r = run(repo(), "line");
		expect(r.code).toBe(0);
		expect(r.out).toBe("");
		expect(r.err).toBe("");
	});

	test("is silent rather than noisy on unreadable state", () => {
		const dir = repo();
		run(dir, "init", "--topic", "widget", "--channel", "deep");
		writeFileSync(join(dir, ".sluice", "run.json"), "{ not json");

		const r = run(dir, "line");
		expect(r.code).toBe(0);
		expect(r.out).toBe("");
		expect(r.err).toBe("");
	});

	test("flags a blocked task, which is the one state worth interrupting for", () => {
		const dir = seeded(4);
		run(dir, "task", "2", "--status", "blocked");
		expect(run(dir, "line").out).toMatch(/blocked|!/i);
	});

	test("says nothing about an active task when none is", () => {
		const dir = seeded(2);
		expect(run(dir, "line").out.trim()).not.toMatch(/T\d/);
	});
});

describe("close", () => {
	test("archives the run and clears the live state", () => {
		const dir = seeded(2);
		run(dir, "task", "1", "--status", "done");

		const r = run(dir, "close");
		expect(r.code).toBe(0);
		expect(run(dir, "show").code).toBe(2);

		const archived = [...new Bun.Glob("*.json").scanSync(join(dir, ".sluice", "archive"))];
		expect(archived).toHaveLength(1);
		expect(JSON.parse(readFileSync(join(dir, ".sluice", "archive", archived[0] as string), "utf8")).topic).toBe(
			"widget",
		);
	});

	// The parse error names `close` as the way out, so close is the one command
	// that has to accept state nothing else will touch. Refusing it too leaves a
	// corrupt file wedged in the tree with no route past it.
	test("archives unreadable state, since that is the way out of it", () => {
		const dir = seeded(1);
		corrupt(dir);

		const r = run(dir, "close");
		expect(r.code).toBe(0);
		expect(run(dir, "show").code).toBe(2);

		const archived = [...new Bun.Glob("*.json").scanSync(join(dir, ".sluice", "archive"))];
		expect(archived).toHaveLength(1);
		expect(readFileSync(join(dir, ".sluice", "archive", archived[0] as string), "utf8")).toBe("{ truncated");
	});

	test("exits 2 with nothing to close", () => {
		expect(run(repo(), "close").code).toBe(2);
	});

	// The archive is the only copy of a closed run. Two runs whose start second
	// and topic agree name the same file, and mv would leave one of them.
	test("does not overwrite an archive entry it collides with", () => {
		const dir = repo();
		for (const _ of [1, 2]) {
			run(dir, "init", "--topic", "widget", "--channel", "deep", "--force");
			const path = join(dir, ".sluice", "run.json");
			const s = JSON.parse(readFileSync(path, "utf8"));
			s.started = "2026-08-23T04:00:00Z";
			writeFileSync(path, JSON.stringify(s));
			expect(run(dir, "close").code).toBe(0);
		}
		expect([...new Bun.Glob("*.json").scanSync(join(dir, ".sluice", "archive"))]).toHaveLength(2);
	});

	test("an archived run does not block a fresh init", () => {
		const dir = seeded(1);
		run(dir, "close");
		expect(run(dir, "init", "--topic", "next", "--channel", "fast").code).toBe(0);
	});
});

// The state file is the one part of a run that survives compaction, so a command
// that cannot complete has to leave it exactly as it found it. The failure mode
// worth guarding is not a bad write but an empty one: jq dying upstream of the
// writer feeds it nothing, and nothing written atomically is still a wipe.
describe("state is never destroyed by a failed update", () => {
	for (const cmd of [
		["task", "1", "--name", "x"],
		["task", "1", "--status", "done"],
		["preflight", "--review", "tier 3 only"],
	]) {
		test(`\`${cmd[0]} ${cmd[1]}\` leaves unreadable state untouched`, () => {
			const dir = seeded(1);
			corrupt(dir);
			const before = readFileSync(join(dir, ".sluice", "run.json"), "utf8");

			const r = run(dir, ...cmd);
			expect(r.code).not.toBe(0);
			expect(readFileSync(join(dir, ".sluice", "run.json"), "utf8")).toBe(before);
		});
	}

	// 5 is the missing-jq code. Reported for a corrupt state file it sends the
	// reader off to install a tool they already have.
	test("unreadable state gets its own exit code, not the missing-jq one", () => {
		const dir = seeded(1);
		corrupt(dir);
		const r = run(dir, "task", "1", "--status", "done");
		expect(r.code).toBe(6);
		expect(r.err).toMatch(/read|parse|corrupt/i);
	});

	// The guard reads the task list to decide whether an id is new. A read that
	// failed is not the same answer as "the id is known", but an unchecked one
	// returns the empty string and is treated as exactly that.
	test("the new-id guard does not open when the task list cannot be read", () => {
		const dir = seeded(1);
		corrupt(dir);
		const r = run(dir, "task", "5", "--status", "done");
		expect(r.code).not.toBe(0);
	});
});

describe("a flag that lost its value", () => {
	// `shift 2` refuses to shift with fewer than two arguments left and, with no
	// `set -e`, the loop then never terminates: $# stops decreasing and the
	// condition stays true. It has to be caught before the shift, not after.
	for (const args of [
		["init", "--topic", "w", "--channel"],
		["init", "--channel", "deep", "--topic"],
		["init", "--topic", "w", "--channel", "deep", "--plan"],
		["task", "1", "--name"],
		["task", "1", "--status"],
		["task", "1", "--tier"],
		["preflight", "--review"],
	]) {
		test(`\`${args.join(" ")}\` exits rather than spinning`, () => {
			const r = run(repo(), ...args);
			// The timeout in `run` kills a spin with SIGTERM, so this is the
			// assertion that separates "rejected the argument" from "hung".
			expect(r.signal).not.toBe("SIGTERM");
			expect(r.code).toBe(4);
			expect(r.err).toMatch(/needs a value/i);
		});
	}

	// Not in final position, the missing value quietly becomes the next flag, so
	// the field holds a flag name and the flag itself was never applied.
	test("does not swallow the following flag as its value", () => {
		const dir = seeded(1);
		const r = run(dir, "task", "1", "--model", "--flips");
		expect(r.code).toBe(4);
		expect(r.err).toContain("--flips");
		expect(state(dir).tasks[0]).not.toHaveProperty("model");
		expect(state(dir).tasks[0]).not.toHaveProperty("flips");
	});
});

describe("argument handling", () => {
	test("an unknown subcommand exits 4 and names it", () => {
		const r = run(repo(), "frobnicate");
		expect(r.code).toBe(4);
		expect(r.err).toMatch(/frobnicate/);
	});

	test("no subcommand prints usage to stderr", () => {
		const proc = Bun.spawnSync(["bash", SCRIPT]);
		expect(proc.exitCode).toBe(4);
		expect(proc.stderr.toString()).toMatch(/usage/i);
	});

	test("an unknown flag exits 4 rather than being ignored", () => {
		const dir = repo();
		const r = run(dir, "init", "--topic", "w", "--channel", "fast", "--turbo");
		expect(r.code).toBe(4);
		expect(r.err).toMatch(/--turbo/);
	});
});
