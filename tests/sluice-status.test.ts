import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
	paused?: string;
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

	test("usage prints the command list, not the whole script", () => {
		const r = run(repo());
		expect(r.code).toBe(4);
		const lines = r.err.trim().split("\n");
		expect(lines.length).toBeLessThan(30);
		expect(r.err).toContain("status.sh move --to");
		expect(r.err).not.toContain("set -uo pipefail");
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

	// Run state is working state, not history, and it lands in whatever tree the
	// run happens in. Ignoring it from inside costs every project nothing; the
	// alternative is a line in every .gitignore the skill ever touches.
	test("the run directory ignores itself, so no project .gitignore has to", () => {
		const dir = repo();
		run(dir, "init", "--topic", "widget", "--channel", "deep");
		// `*` matches the .gitignore too, so the whole directory drops out of git.
		expect(readFileSync(join(dir, ".sluice", ".gitignore"), "utf8")).toBe("*\n");
	});

	test("leaves an existing ignore file alone", () => {
		const dir = repo();
		run(dir, "init", "--topic", "widget", "--channel", "deep");
		writeFileSync(join(dir, ".sluice", ".gitignore"), "run.json\n");
		run(dir, "init", "--topic", "other", "--channel", "fast", "--force");
		expect(readFileSync(join(dir, ".sluice", ".gitignore"), "utf8")).toBe("run.json\n");
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

// "Where is this run" is the question the state file exists to answer, and a
// run read from a tree it does not live in answers it silently wrong: the
// reader takes the tree they are in. Worth a row exactly when the answer is
// not the tree they asked about.
describe("show says where the run is when it is not here", () => {
	test("the tree the run moved to is named", () => {
		const main = gitRepo();
		run(main, "init", "--topic", "widget", "--channel", "deep");
		const wt = worktree(main, "impl");
		run(main, "move", "--to", wt);

		expect(run(main, "show").out).toContain(realpathSync(wt));
	});

	test("a worktree reading the set's run is told which tree holds it", () => {
		const main = gitRepo();
		run(main, "init", "--topic", "widget", "--channel", "deep");

		expect(run(worktree(main, "impl"), "show").out).toContain(realpathSync(main));
	});

	test("a tree holding its own run is told nothing about trees", () => {
		const dir = gitRepo();
		run(dir, "init", "--topic", "widget", "--channel", "deep");

		expect(run(dir, "show").out).not.toContain(realpathSync(dir));
	});

	// A directory inside the tree the run is in is that tree, one level down,
	// and a row there would fire on every session that works from a subdirectory.
	test("a subdirectory of the tree holding the run is told nothing about trees", () => {
		const dir = gitRepo();
		run(dir, "init", "--topic", "widget", "--channel", "deep");
		const nested = join(dir, "src", "deep");
		mkdirSync(nested, { recursive: true });

		expect(run(nested, "show").out).not.toContain(realpathSync(dir));
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

	test("restores the ignore file, so the archive stays out of git too", () => {
		const dir = repo();
		run(dir, "init", "--topic", "widget", "--channel", "deep");
		rmSync(join(dir, ".sluice", ".gitignore"));
		expect(run(dir, "close").code).toBe(0);
		expect(readFileSync(join(dir, ".sluice", ".gitignore"), "utf8")).toBe("*\n");
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

/** ANSI stripped, since the render colours cells for a terminal. */
function plain(s: string): string {
	// eslint-disable-next-line no-control-regex
	return s.replace(/\x1b\[[0-9;]*m/g, "");
}

// The tier table promises a review per qualifying task. Nothing tracked whether
// one happened, so "review outstanding" first appeared in the closing summary, at
// the one moment the partner could no longer do anything about it.
describe("review debt", () => {
	test("--reviewed marks a task, and nothing else does", () => {
		const dir = seeded(2);
		run(dir, "task", "1", "--tier", "1", "--status", "done");
		expect(state(dir).tasks[0]).not.toHaveProperty("reviewed");

		expect(run(dir, "task", "1", "--reviewed").code).toBe(0);
		expect(state(dir).tasks[0]).toMatchObject({ id: 1, reviewed: true });
	});

	test("survives a later status flip, since a review does not un-happen", () => {
		const dir = seeded(1);
		run(dir, "task", "1", "--tier", "1", "--reviewed");
		run(dir, "task", "1", "--status", "done");
		expect(state(dir).tasks[0]).toMatchObject({ reviewed: true });
	});

	test("show names the debt so it is visible before handback", () => {
		const dir = seeded(2);
		run(dir, "task", "1", "--tier", "1", "--status", "done");
		run(dir, "task", "2", "--tier", "2", "--status", "done");
		expect(run(dir, "show").out).toMatch(/2 (tasks )?(done )?(and )?unreviewed|unreviewed[:\s]+2/i);

		run(dir, "task", "1", "--reviewed");
		expect(run(dir, "show").out).toMatch(/unreviewed[:\s]+1|1 (task )?(done )?(and )?unreviewed/i);
	});

	// Tier 0 buys a stat read rather than a dispatch, so it was never owed one.
	test("a tier 0 task is not debt", () => {
		const dir = seeded(1);
		run(dir, "task", "1", "--tier", "0", "--status", "done");
		expect(run(dir, "show").out).not.toMatch(/unreviewed[:\s]+[1-9]/i);
	});

	test("nor is a task that is not done yet", () => {
		const dir = seeded(1);
		run(dir, "task", "1", "--tier", "3", "--status", "active");
		expect(run(dir, "show").out).not.toMatch(/unreviewed[:\s]+[1-9]/i);
	});
});

describe("line --full", () => {
	/** A run of `n` tasks with the flip on `flip`, every task at tier 1. */
	function run9(n = 9, flip = 8): string {
		const dir = repo();
		run(dir, "init", "--topic", "cross-harness", "--channel", "deep");
		for (let i = 1; i <= n; i++) {
			run(dir, "task", String(i), "--name", `task number ${i}`, "--tier", "1");
			if (i === flip) run(dir, "task", String(i), "--flips");
		}
		return dir;
	}
	/** The three rendered rows, colour stripped. */
	const rows = (dir: string) => plain(run(dir, "line", "--full").out).replace(/\n$/, "").split("\n");
	const bar = (dir: string) => (rows(dir)[1] ?? "").trim();

	test("renders three rows, so the bar never shares one with text", () => {
		expect(rows(run9())).toHaveLength(3);
	});

	test("the first names the run and how long it has been open", () => {
		const [head] = rows(run9());
		expect(head).toContain("deep");
		expect(head).toContain("cross-harness");
		expect(head).toMatch(/◷/);
	});

	// The flip left the header for the bar, where it draws as a boundary. Its own
	// cell then shows its status like every other task.
	test("the header does not name the flip", () => {
		expect(rows(run9())[0]).not.toMatch(/flip/i);
	});

	test("the bar draws one group of cells per task, separated", () => {
		const groups = bar(run9(9)).split(/\s+/).filter((g) => g && !g.includes("┃"));
		expect(groups).toHaveLength(9);
		for (const g of groups) expect(g).toHaveLength(3);
	});

	test("each group is one repeated glyph, so a state reads as a block", () => {
		const dir = run9(5, 5);
		run(dir, "task", "1", "--status", "done", "--reviewed");
		run(dir, "task", "2", "--status", "active");
		run(dir, "task", "3", "--status", "review");
		run(dir, "task", "4", "--status", "blocked");

		const groups = bar(dir).split(/\s+/).filter((g) => g && !g.includes("┃"));
		expect(groups).toEqual(["▰▰▰", "◈◈◈", "▨▨▨", "▮▮▮", "▱▱▱"]);
	});

	test("cells narrow as the task count grows", () => {
		const cell = (n: number) => (bar(run9(n, n)).split(/\s+/).find((g) => !g.includes("┃")) ?? "").length;
		expect(cell(9)).toBeGreaterThan(cell(20));
		expect(cell(20)).toBeGreaterThan(cell(40));
	});

	test("the third row carries the progress count", () => {
		const dir = run9();
		run(dir, "task", "1", "--status", "done");
		expect(rows(dir)[2]).toContain("1/9");
	});

	test("it names the active task in full", () => {
		const dir = run9();
		run(dir, "task", "4", "--status", "active");
		const detail = rows(dir)[2] ?? "";
		expect(detail).toContain("T4");
		expect(detail).toContain("task number 4");
	});

	test("a blocked task displaces the active one, being the thing to act on", () => {
		const dir = run9();
		run(dir, "task", "4", "--status", "active");
		run(dir, "task", "2", "--status", "blocked");
		const detail = rows(dir)[2] ?? "";
		expect(detail).toContain("T2");
		expect(detail).not.toContain("T4");
	});

	test("and it counts the review debt, saying nothing at zero", () => {
		const dir = run9();
		expect(rows(dir)[2]).not.toMatch(/unreviewed/);

		run(dir, "task", "1", "--status", "done");
		run(dir, "task", "2", "--status", "done");
		expect(rows(dir)[2]).toMatch(/2 unreviewed/);

		run(dir, "task", "1", "--reviewed");
		expect(rows(dir)[2]).toMatch(/1 unreviewed/);
	});

	// The debt glyph is ambiguous-width in terminal fonts, so a digit set hard
	// against it is drawn over it. Every other symbol in the render takes a
	// space before its text for the same reason.
	test("the debt glyph is separated from its count by a space", () => {
		const dir = run9();
		run(dir, "task", "1", "--status", "done");
		expect(rows(dir)[2]).toMatch(/⟲ 1 unreviewed/);
		expect(rows(dir)[2]).not.toMatch(/⟲1/);
	});

	// Same contract as the compact form: its caller renders on every keystroke.
	test("is silent and exits 0 with no run", () => {
		const r = run(repo(), "line", "--full");
		expect(r.code).toBe(0);
		expect(r.out).toBe("");
		expect(r.err).toBe("");
	});

	test("is silent on unreadable state", () => {
		const dir = run9(2);
		corrupt(dir);
		const r = run(dir, "line", "--full");
		expect(r.code).toBe(0);
		expect(r.out).toBe("");
		expect(r.err).toBe("");
	});

	test("the compact form is unchanged, so the old caller still works", () => {
		const dir = run9();
		run(dir, "task", "4", "--status", "active");
		expect(plain(run(dir, "line").out).trim()).toBe("sluice deep 0/9 ▸T4");
	});

	test("an unknown flag exits 4 rather than being ignored", () => {
		expect(run(run9(1), "line", "--turbo").code).toBe(4);
	});
});

describe("line --full survives bad data", () => {
	function withStarted(value: string): string {
		const dir = repo();
		run(dir, "init", "--topic", "widget", "--channel", "deep");
		run(dir, "task", "1", "--name", "first", "--tier", "1");
		const path = join(dir, ".sluice", "run.json");
		const s = JSON.parse(readFileSync(path, "utf8"));
		s.started = value;
		writeFileSync(path, JSON.stringify(s));
		return dir;
	}

	test.each([
		["an offset instead of Z", "2026-08-23T10:00:00+00:00"],
		["fractional seconds", "2026-08-23T10:00:00.123Z"],
		["not a date at all", "yesterday"],
		["empty", ""],
	])("renders the run when started is %s", (_label, value) => {
		const dir = withStarted(value);
		const out = run(dir, "line", "--full").out;
		expect(out).toContain("deep");
		expect(out).toContain("0/1");
	});

	test("and drops only the clock cell", () => {
		expect(run(withStarted("yesterday"), "line", "--full").out).not.toMatch(/◷/);
	});

	test("keeping it where the timestamp is good", () => {
		const dir = seeded(1);
		expect(run(dir, "line", "--full").out).toMatch(/◷/);
	});

	test("a run with no tasks renders rather than erroring", () => {
		const dir = repo();
		run(dir, "init", "--topic", "widget", "--channel", "deep");
		const r = run(dir, "line", "--full");
		expect(r.code).toBe(0);
		expect(r.out).toContain("0/0");
	});
});

// The flip is a plan fact, not a run decision, so re-import has to be
// authoritative on it. Without a way to clear one, a moved flip left two.
describe("clearing the flip", () => {
	test("--no-flips removes a flip that was set", () => {
		const dir = seeded(2);
		run(dir, "task", "1", "--flips");
		expect(state(dir).tasks[0]).toMatchObject({ flips: true });

		expect(run(dir, "task", "1", "--no-flips").code).toBe(0);
		expect(state(dir).tasks[0]).not.toHaveProperty("flips");
	});

	test("it is harmless on a task that never had one", () => {
		const dir = seeded(1);
		expect(run(dir, "task", "1", "--no-flips").code).toBe(0);
		expect(state(dir).tasks[0]).not.toHaveProperty("flips");
	});

	test("passing both is a contradiction rather than a precedence puzzle", () => {
		const dir = seeded(1);
		const r = run(dir, "task", "1", "--flips", "--no-flips");
		expect(r.code).toBe(4);
		expect(r.err).toMatch(/both|contradict/i);
	});
});

// The proposals from the representation note, plus the two render findings that
// shipped alongside the layout.
describe("the bar carries debt in position and the flip as a boundary", () => {
	function plan(n: number, flip: number): string {
		const dir = repo();
		run(dir, "init", "--topic", "cross-harness", "--channel", "deep");
		for (let i = 1; i <= n; i++) {
			run(dir, "task", String(i), "--name", `task number ${i}`, "--tier", "1");
			if (i === flip) run(dir, "task", String(i), "--flips");
		}
		return dir;
	}
	const rows = (dir: string) => plain(run(dir, "line", "--full").out).replace(/\n$/, "").split("\n");
	const bar = (dir: string) => (rows(dir)[1] ?? "").trim();

	// Done was hiding two states: reviewed, and owed a review nobody did. A count
	// says how much debt there is and never where.
	test("a done task owed a review reads differently from one that got it", () => {
		const dir = plan(3, 3);
		run(dir, "task", "1", "--status", "done", "--reviewed");
		run(dir, "task", "2", "--status", "done");

		const groups = bar(dir).split(/\s+/).filter((g) => !g.includes("┃"));
		expect(groups[0]).toBe("▰▰▰");
		expect(groups[1]).toBe("▰▰▨");
	});

	test("the trailing glyph is the review marker, so it says what is outstanding", () => {
		const dir = plan(2, 2);
		run(dir, "task", "1", "--status", "done");
		expect(bar(dir)).toContain("▰▰▨");

		run(dir, "task", "1", "--reviewed");
		expect(bar(dir)).toContain("▰▰▰");
	});

	// Tier 0 was never owed a dispatch, so it is done rather than in debt.
	test("a tier 0 task reads as plainly done", () => {
		const dir = plan(2, 2);
		run(dir, "task", "1", "--tier", "0", "--status", "done");
		expect(bar(dir).split(/\s+/)[0]).toBe("▰▰▰");
	});

	// The flip's meaning is a boundary: before it the branch is inert and safe to
	// leave landed, after it it is not. A header phrase could not say that.
	test("the flip draws as a boundary before its task", () => {
		const dir = plan(4, 3);
		const groups = bar(dir).split(/\s+/);
		expect(groups).toEqual(["▱▱▱", "▱▱▱", "┃", "▱▱▱", "▱▱▱"]);
	});

	test("and the header no longer has to name it", () => {
		expect(rows(plan(4, 3))[0]).not.toMatch(/flip/i);
	});

	test("a flip on the first task puts the boundary at the start", () => {
		expect(bar(plan(3, 1)).split(/\s+/)[0]).toBe("┃");
	});

	// The width schedule was non-monotonic: 30 tasks rendered wider than 12,
	// because the gaps were never counted into the threshold.
	test.each([[9], [12], [13], [20], [30], [31], [40], [60]])(
		"the bar fits a terminal at %i tasks",
		(n) => {
			expect(bar(plan(n, n)).length).toBeLessThanOrEqual(76);
		},
	);

	// The band edges are where the old count-based schedule blew past its cap, and
	// they are exactly what the earlier tests at 9, 18 and 40 stepped over.
	test.each([[17], [18], [19], [23], [24], [25]])("fits at the band edge of %i tasks", (n) => {
		expect(bar(plan(n, n)).length).toBeLessThanOrEqual(76);
	});

	// Four simultaneous actives is the designed case for this very run, so naming
	// one and silently dropping three misreports it.
	test("several actives are counted, not silently reduced to one", () => {
		const dir = plan(9, 8);
		for (const id of ["1", "2", "3"]) run(dir, "task", id, "--status", "active");
		const detail = rows(dir)[2] ?? "";
		expect(detail).toContain("T1");
		expect(detail).toMatch(/\+2/);
	});

	test("as are several blocked", () => {
		const dir = plan(9, 8);
		run(dir, "task", "2", "--status", "blocked");
		run(dir, "task", "5", "--status", "blocked");
		const detail = rows(dir)[2] ?? "";
		expect(detail).toContain("T2");
		expect(detail).toMatch(/\+1/);
	});

	test("and a single one carries no count", () => {
		const dir = plan(9, 8);
		run(dir, "task", "4", "--status", "active");
		expect(rows(dir)[2]).not.toMatch(/\+\d/);
	});
});

// The wave question: which tasks may go now. A graph query, not a status display,
// which is why it is a command rather than another row on the bar.
describe("ready", () => {
	function graph(dir: string, tasks: Array<Record<string, unknown>>) {
		run(dir, "init", "--topic", "t", "--channel", "deep");
		const path = join(dir, ".sluice", "run.json");
		const s = JSON.parse(readFileSync(path, "utf8"));
		s.tasks = tasks;
		writeFileSync(path, JSON.stringify(s));
		return dir;
	}
	const wave = () =>
		graph(repo(), [
			{ id: 1, name: "producer", status: "done", tier: 1, offers: ["seam"], touches: ["src/one.ts"] },
			{ id: 2, name: "consumer", status: "todo", tier: 1, needs: ["seam"], touches: ["src/two.ts"] },
			{ id: 3, name: "independent", status: "todo", tier: 1, touches: ["src/two.ts"] },
			{ id: 4, name: "needs nothing built", status: "todo", tier: 1, needs: ["absent"], touches: ["src/four.ts"] },
			{ id: 5, name: "the flip", status: "todo", tier: 3, flips: true, touches: ["src/five.ts"] },
		]);

	test("names the tasks whose Needs are all satisfied", () => {
		const out = run(wave(), "ready").out;
		expect(out).toContain("T2");
		expect(out).toContain("T3");
	});

	// Disjoint Touches is what makes two ready tasks safe together, and the reason
	// pre-flight asks for a worktree each.
	test("says which of them collide, so the wave is not guessed", () => {
		const out = run(wave(), "ready").out;
		expect(out).toMatch(/src\/two\.ts/);
	});

	test("holds back a task whose Needs nothing offers", () => {
		const out = run(wave(), "ready").out;
		const readySection = out.split(/waiting|blocked|flip/i)[0] ?? "";
		expect(readySection).not.toContain("T4");
	});

	// Nothing goes concurrent with the flip, whatever the graph says.
	test("keeps the flip out of the wave and says it runs alone", () => {
		const out = run(wave(), "ready").out;
		expect(out).toMatch(/T5/);
		expect(out).toMatch(/alone/i);
	});

	// An active task may still be named as the holder of a contended path, which
	// is the point of the collision warning. What must not happen is it appearing
	// as an offer, so the assertion is on the offer rows rather than the section.
	test("does not offer a task that is already running", () => {
		const dir = wave();
		run(dir, "task", "2", "--status", "active");
		const offers = run(dir, "ready")
			.out.split("\n")
			.filter((l) => /^ {2}T\d+ {2}/.test(l));
		expect(offers.join("\n")).not.toMatch(/^ {2}T2 {2}/m);
	});

	test("nor one already done", () => {
		expect(run(wave(), "ready").out.split(/waiting/i)[0]).not.toContain("T1");
	});

	// A plan imported before the graph was stored has no edges, and guessing is
	// worse than saying so.
	test("says the graph is missing rather than reporting everything ready", () => {
		const dir = graph(repo(), [
			{ id: 1, name: "no edges", status: "todo", tier: 1 },
			{ id: 2, name: "nor here", status: "todo", tier: 1 },
		]);
		const r = run(dir, "ready");
		expect(r.out + r.err).toMatch(/re-?import|no graph|plan\.sh import/i);
	});

	test("needs a live run", () => {
		expect(run(repo(), "ready").code).toBe(2);
	});

	test("an unknown flag exits 4", () => {
		expect(run(wave(), "ready", "--turbo").code).toBe(4);
	});
});

describe("ready reads cleanly", () => {
	function withTasks(tasks: Array<Record<string, unknown>>) {
		const dir = repo();
		run(dir, "init", "--topic", "t", "--channel", "deep");
		const path = join(dir, ".sluice", "run.json");
		const s = JSON.parse(readFileSync(path, "utf8"));
		s.tasks = tasks;
		writeFileSync(path, JSON.stringify(s));
		return dir;
	}

	// Same defect already fixed once in `show`: a clipped name reads as the whole
	// name, and here it also ran straight into the next column.
	test("marks a name it had to clip, and keeps a gap after it", () => {
		const dir = withTasks([
			{ id: 1, name: "a ledger that works without a transcript at all", status: "todo", tier: 1, touches: ["a.ts"] },
			{ id: 2, name: "flip", status: "todo", tier: 3, flips: true, touches: ["b.ts"] },
		]);
		const line = run(dir, "ready").out.split("\n").find((l) => l.includes("T1")) ?? "";
		expect(line).toContain("…");
		expect(line).not.toContain("transcript at all");
		expect(line).toMatch(/…\s+a\.ts/);
	});

	test("leaves a short name alone", () => {
		const dir = withTasks([
			{ id: 1, name: "short", status: "todo", tier: 1, touches: ["a.ts"] },
			{ id: 2, name: "flip", status: "todo", tier: 3, flips: true, touches: ["b.ts"] },
		]);
		const line = run(dir, "ready").out.split("\n").find((l) => l.includes("T1")) ?? "";
		expect(line).not.toContain("…");
		expect(line).toMatch(/short\s+a\.ts/);
	});
});

// A wave is only safe against everything in flight, not just against its peers.
describe("ready accounts for work already running", () => {
	function withTasks(tasks: Array<Record<string, unknown>>) {
		const dir = repo();
		run(dir, "init", "--topic", "t", "--channel", "deep");
		const path = join(dir, ".sluice", "run.json");
		const s = JSON.parse(readFileSync(path, "utf8"));
		s.tasks = tasks;
		writeFileSync(path, JSON.stringify(s));
		return dir;
	}

	const contended = () =>
		withTasks([
			{ id: 1, name: "candidate", status: "todo", tier: 1, touches: ["src/shared.ts"] },
			{ id: 2, name: "in flight", status: "active", tier: 1, touches: ["src/shared.ts"] },
			{ id: 3, name: "clear", status: "todo", tier: 1, touches: ["src/other.ts"] },
			{ id: 4, name: "flip", status: "todo", tier: 3, flips: true, touches: ["src/f.ts"] },
		]);

	// Presented as "a worktree each", so an unflagged collision sends the reader
	// straight into a conflict with a task already running.
	test("warns when a ready task collides with an active one", () => {
		const out = run(contended(), "ready").out;
		expect(out).toMatch(/T1/);
		expect(out).toMatch(/src\/shared\.ts/);
		expect(out).toMatch(/T2|in flight|active/i);
	});

	test("and leaves a task with no contention unflagged", () => {
		const lines = run(contended(), "ready").out.split("\n").filter((l) => /share|collid/i.test(l));
		expect(lines.join("\n")).not.toMatch(/T3/);
	});

	test("a task in review also holds its paths", () => {
		const dir = withTasks([
			{ id: 1, name: "candidate", status: "todo", tier: 1, touches: ["src/shared.ts"] },
			{ id: 2, name: "under review", status: "review", tier: 1, touches: ["src/shared.ts"] },
			{ id: 3, name: "flip", status: "todo", tier: 3, flips: true, touches: ["src/f.ts"] },
		]);
		expect(run(dir, "ready").out).toMatch(/src\/shared\.ts/);
	});
});

/** A git repo with one commit, so `git worktree add` has something to branch from. */
function gitRepo(): string {
	const dir = repo();
	const git = (...args: string[]) =>
		Bun.spawnSync({ cmd: ["git", "-C", dir, ...args], timeout: 10000 });
	git("init", "-q");
	git("config", "user.email", "t@example.com");
	git("config", "user.name", "t");
	writeFileSync(join(dir, "README.md"), "hi\n");
	git("add", "-A");
	git("commit", "-qm", "init");
	return dir;
}

/** A linked worktree of `main`, checked out on a fresh branch. */
function worktree(main: string, branch: string): string {
	const path = join(mkdtempSync(join(tmpdir(), "sluice-wt-")), branch);
	Bun.spawnSync({
		cmd: ["git", "-C", main, "worktree", "add", "-q", path, "-b", branch],
		timeout: 10000,
	});
	return path;
}

// A deep run plans in one tree and implements in worktrees created after the
// plan. `.sluice/` is ignored, so it never comes across in the checkout: read
// per-tree, the run the plan seeded reads as absent from every implementer, and
// an `init` there lands a rival state file that dies with the worktree.
describe("a worktree set shares one run", () => {
	test("a linked worktree reads the run the main worktree started", () => {
		const main = gitRepo();
		run(main, "init", "--topic", "widget", "--channel", "deep");
		run(main, "task", "1", "--name", "first", "--status", "active");

		const wt = worktree(main, "impl");
		const r = run(wt, "show");
		expect(r.code).toBe(0);
		expect(r.out).toContain("widget");
		expect(r.out).toContain("first");
	});

	test("the statusline renders from inside a worktree", () => {
		const main = gitRepo();
		run(main, "init", "--topic", "widget", "--channel", "deep");
		run(main, "task", "1", "--name", "first", "--status", "active");

		const out = run(worktree(main, "impl"), "line").out;
		expect(out).toContain("deep");
		expect(out).toMatch(/T1/);
	});

	test("a flip made in a worktree lands in the shared state", () => {
		const main = gitRepo();
		run(main, "init", "--topic", "widget", "--channel", "deep");
		run(main, "task", "1", "--name", "first");

		const r = run(worktree(main, "impl"), "task", "1", "--status", "done", "--commit", "abc1234");
		expect(r.code).toBe(0);
		expect(state(main).tasks[0]).toMatchObject({ id: 1, status: "done", commit: "abc1234" });
	});

	// Silently starting a second run is how the plan's rows go missing: the
	// implementer writes into a file nothing else reads and the worktree takes it.
	// The set shares a run only while the worktree has none of its own. Two
	// sessions working independently, one per worktree, each start a run in
	// their tree, and neither is shown the other's.
	test("init from a worktree starts that worktree's own run", () => {
		const main = gitRepo();
		run(main, "init", "--topic", "widget", "--channel", "deep");
		const wt = worktree(main, "impl");
		const r = run(wt, "init", "--topic", "gadget", "--channel", "fast");
		expect(r.code).toBe(0);
		expect(run(wt, "show").out).toContain("gadget");
		expect(run(main, "show").out).toContain("widget");
		expect(run(main, "show").out).not.toContain("gadget");
	});

	test("a worktree with its own run flips its own rows, not the main tree's", () => {
		const main = gitRepo();
		run(main, "init", "--topic", "widget", "--channel", "deep");
		const wt = worktree(main, "impl");
		run(wt, "init", "--topic", "gadget", "--channel", "fast");
		run(wt, "task", "1", "--name", "own", "--status", "active");
		expect(state(main).tasks).toEqual([]);
		expect(run(wt, "line").out).toMatch(/fast/);
		expect(run(wt, "line").out).toMatch(/T1/);
	});

	test("close from a worktree with its own run leaves the main tree's run live", () => {
		const main = gitRepo();
		run(main, "init", "--topic", "widget", "--channel", "deep");
		const wt = worktree(main, "impl");
		run(wt, "init", "--topic", "gadget", "--channel", "fast");
		expect(run(wt, "close").code).toBe(0);
		expect(run(wt, "show").out).toContain("widget");
		expect(run(main, "show").code).toBe(0);
	});

	test("close from a worktree archives the shared run", () => {
		const main = gitRepo();
		run(main, "init", "--topic", "widget", "--channel", "deep");

		expect(run(worktree(main, "impl"), "close").code).toBe(0);
		expect(run(main, "show").code).toBe(2);
	});

	// Two implementers flipping their own task at the same moment each read the
	// whole file, edit it and write it back. Unserialised, the later write is
	// built on a snapshot taken before the earlier one landed and drops that row.
	test("concurrent flips from separate worktrees keep every row", async () => {
		const main = gitRepo();
		run(main, "init", "--topic", "widget", "--channel", "deep");
		for (let i = 1; i <= 6; i++) run(main, "task", String(i), "--name", `T${i}`);

		const trees = [main, worktree(main, "a"), worktree(main, "b")];
		await Promise.all(
			[1, 2, 3, 4, 5, 6].map((id) =>
				Bun.spawn({
					cmd: [
						"bash", SCRIPT, "task", String(id), "--status", "done",
						"--dir", trees[id % trees.length],
					],
					stdout: "ignore",
					stderr: "ignore",
				}).exited,
			),
		);

		const done = state(main).tasks.filter((t) => t.status === "done");
		expect(done).toHaveLength(6);
	});

	// A plain directory is not a work tree, and a submodule's own checkout is the
	// main worktree of its own repo, so neither is redirected anywhere.
	test("a tree that is not a git work tree keeps its own run", () => {
		const dir = repo();
		run(dir, "init", "--topic", "widget", "--channel", "deep");
		expect(state(dir).topic).toBe("widget");
	});
});

// The base is what the reviewer's diff is cut from, and it is only cheap to
// know at the moment of dispatch. Left to be recovered later it comes back as
// `HEAD~1`, so an unstated base is filled in from the tree the command ran in.
// A state that is not an object is not a run, whatever jq makes of it.
describe("write_state refuses a non-object state", () => {
	test("a task flip over a state jq parses as null leaves the file untouched", () => {
		const dir = seeded(1);
		const path = join(dir, ".sluice", "run.json");
		writeFileSync(path, "null");
		const r = run(dir, "task", "1", "--status", "active");
		expect(r.code).not.toBe(0);
		expect(readFileSync(path, "utf8")).toBe("null");
	});
});

describe("the base defaults to HEAD at dispatch", () => {
	function head(dir: string): string {
		return Bun.spawnSync({ cmd: ["git", "-C", dir, "rev-parse", "--short", "HEAD"], timeout: 10000 })
			.stdout.toString()
			.trim();
	}

	test("flipping a task active with no --base records the current HEAD", () => {
		const dir = gitRepo();
		run(dir, "init", "--topic", "widget", "--channel", "deep");
		run(dir, "task", "1", "--name", "first", "--status", "active");
		expect(state(dir).tasks[0]?.base).toBe(head(dir));
	});

	test("an explicit --base is kept over the default", () => {
		const dir = gitRepo();
		run(dir, "init", "--topic", "widget", "--channel", "deep");
		run(dir, "task", "1", "--name", "first", "--status", "active", "--base", "abc1234");
		expect(state(dir).tasks[0]?.base).toBe("abc1234");
	});

	test("a base already on the row is not overwritten by a second flip", () => {
		const dir = gitRepo();
		run(dir, "init", "--topic", "widget", "--channel", "deep");
		run(dir, "task", "1", "--name", "first", "--status", "active", "--base", "abc1234");
		run(dir, "task", "1", "--status", "active");
		expect(state(dir).tasks[0]?.base).toBe("abc1234");
	});

	// The implementer is cut from a worktree whose HEAD has moved on from the
	// main tree's, and the diff the reviewer gets is cut from the base, so the
	// base has to be the worktree's.
	test("issued from a linked worktree, the base is that worktree's HEAD", () => {
		const main = gitRepo();
		run(main, "init", "--topic", "widget", "--channel", "deep");
		const wt = worktree(main, "impl");
		writeFileSync(join(wt, "more.md"), "more\n");
		Bun.spawnSync({ cmd: ["git", "-C", wt, "add", "-A"], timeout: 10000 });
		Bun.spawnSync({ cmd: ["git", "-C", wt, "commit", "-qm", "ahead"], timeout: 10000 });
		expect(head(wt)).not.toBe(head(main));
		run(wt, "task", "1", "--name", "first", "--status", "active");
		expect(state(main).tasks[0]?.base).toBe(head(wt));
	});

	// Dispatch from the controller's own worktree into another: the run is in
	// neither the main tree nor the tree being built in, and the base still has
	// to be the one the implementer starts at.
	test("with the run moved out, --dir the implementer's tree still takes its HEAD", () => {
		const main = gitRepo();
		run(main, "init", "--topic", "widget", "--channel", "deep");
		const controller = worktree(main, "controller");
		run(main, "move", "--to", controller);
		const impl = worktree(main, "impl");
		writeFileSync(join(impl, "more.md"), "more\n");
		Bun.spawnSync({ cmd: ["git", "-C", impl, "add", "-A"], timeout: 10000 });
		Bun.spawnSync({ cmd: ["git", "-C", impl, "commit", "-qm", "ahead"], timeout: 10000 });

		run(impl, "task", "1", "--name", "first", "--status", "active");
		expect(state(controller).tasks[0]?.base).toBe(head(impl));
	});

	test("outside a git tree the row simply carries no base", () => {
		const dir = seeded(1);
		run(dir, "task", "1", "--status", "active");
		expect(state(dir).tasks[0]?.base).toBeUndefined();
	});
});

// A run nobody has touched for a day is either abandoned or forgotten, and the
// clock since `started` cannot tell a long run from a dead one. The last write
// can, so every write stamps it and the readers say when it is old.
describe("a run knows when it was last written", () => {
	function age(dir: string, hours: number) {
		const path = join(dir, ".sluice", "run.json");
		const s = JSON.parse(readFileSync(path, "utf8"));
		s.updated = new Date(Date.now() - hours * 3600 * 1000).toISOString().replace(/\.\d+Z$/, "Z");
		writeFileSync(path, JSON.stringify(s));
	}

	test("init and every task flip stamp updated", () => {
		const dir = repo();
		run(dir, "init", "--topic", "widget", "--channel", "deep");
		const first = state(dir) as Run & { updated?: string };
		expect(first.updated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		run(dir, "task", "1", "--name", "first", "--status", "active");
		const second = state(dir) as Run & { updated?: string };
		expect(second.updated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});

	test("show says how long a run has sat idle once it passes a day", () => {
		const dir = seeded(2);
		age(dir, 30);
		expect(run(dir, "show").out).toMatch(/idle\s+1d6h/);
	});

	test("a run recorded before updated existed reads idle off its start time", () => {
		const dir = seeded(1);
		const path = join(dir, ".sluice", "run.json");
		const s = JSON.parse(readFileSync(path, "utf8"));
		delete s.updated;
		s.started = new Date(Date.now() - 72 * 3600 * 1000).toISOString().replace(/\.\d+Z$/, "Z");
		writeFileSync(path, JSON.stringify(s));
		expect(run(dir, "show").out).toMatch(/idle\s+3d0h/);
	});

	test("show says nothing about idleness on a run written today", () => {
		const dir = seeded(2);
		expect(run(dir, "show").out).not.toMatch(/idle/);
	});

	test("the statusline carries the idle time in its first row", () => {
		const dir = seeded(2);
		age(dir, 49);
		const rows = run(dir, "line", "--full").out.split("\n");
		expect(rows[0]).toMatch(/idle 2d1h/);
	});

	test("and leaves it off a run written today", () => {
		const dir = seeded(2);
		expect(run(dir, "line", "--full").out.split("\n")[0]).not.toMatch(/idle/);
	});
});

// The per-task debt count says which tasks were owed a dispatch and never got
// one. It says nothing about the review that covers the plan as a whole, which
// is the one review every deep run owes whatever the tiers did.
describe("the final review is recorded", () => {
	test("show reports it pending until it is marked", () => {
		const dir = seeded(2);
		expect(run(dir, "show").out).toMatch(/final review\s+pending/);
	});

	test("final marks it and show reports it done", () => {
		const dir = seeded(2);
		const r = run(dir, "final");
		expect(r.code).toBe(0);
		expect(run(dir, "show").out).toMatch(/final review\s+done/);
	});

	test("final needs a live run", () => {
		expect(run(repo(), "final").code).toBe(2);
	});

	test("final takes no arguments", () => {
		expect(run(seeded(1), "final", "--now").code).toBe(4);
	});

	test("the mark survives a later write to a task row", () => {
		const dir = seeded(2);
		run(dir, "final");
		run(dir, "task", "1", "--name", "renamed");
		expect(run(dir, "show").out).toMatch(/final review\s+done/);
	});
});

// A run is closed once per plan, and a close that says nothing lets a run with
// six unreviewed tasks and no final review leave without the fact being read.
describe("close says what it archived", () => {
	test("names the topic, the progress, the debt and the final review", () => {
		const dir = seeded(3);
		run(dir, "task", "1", "--status", "done", "--tier", "1");
		run(dir, "task", "2", "--status", "done", "--tier", "1", "--reviewed");
		const r = run(dir, "close");
		expect(r.code).toBe(0);
		expect(r.out).toMatch(/widget/);
		expect(r.out).toMatch(/2\/3 done/);
		expect(r.out).toMatch(/1 unreviewed/);
		expect(r.out).toMatch(/final review pending/);
	});

	test("still names the archive when the state could not be summarised", () => {
		const dir = seeded(1);
		corrupt(dir);
		const r = run(dir, "close");
		expect(r.code).toBe(0);
		expect(r.out).toMatch(/closed/);
		expect(r.out).toMatch(/unreadable/);
	});

	test("reads clean when nothing is owed", () => {
		const dir = seeded(1);
		run(dir, "task", "1", "--status", "done", "--tier", "0");
		run(dir, "final");
		const out = run(dir, "close").out;
		expect(out).toMatch(/1\/1 done/);
		expect(out).not.toMatch(/unreviewed/);
		expect(out).toMatch(/final review done/);
	});
});

// "A worktree each" is only true when pre-flight bought worktrees. Under a
// shared tree the same wave runs serially, and the line has to say that or say
// nothing rather than tell the reader to dispatch four at once.
describe("ready reads the workspace answer", () => {
	function two(): string {
		const dir = repo();
		run(dir, "init", "--topic", "t", "--channel", "deep");
		const path = join(dir, ".sluice", "run.json");
		const s = JSON.parse(readFileSync(path, "utf8"));
		s.tasks = [
			{ id: 1, name: "a", status: "todo", tier: 1, touches: ["src/a.ts"] },
			{ id: 2, name: "b", status: "todo", tier: 1, touches: ["src/b.ts"] },
			{ id: 3, name: "flip", status: "todo", tier: 3, flips: true, touches: ["src/f.ts"] },
		];
		writeFileSync(path, JSON.stringify(s));
		return dir;
	}

	test("says a worktree each when pre-flight chose worktrees", () => {
		const dir = two();
		run(dir, "preflight", "--workspace", "one worktree per concurrent implementer");
		expect(run(dir, "ready").out.split("\n")[0]).toMatch(/a worktree each/);
	});

	test("says serial when pre-flight chose a shared tree", () => {
		const dir = two();
		run(dir, "preflight", "--workspace", "shared tree, agents leave it dirty");
		const first = run(dir, "ready").out.split("\n")[0];
		expect(first).toMatch(/serial/);
		expect(first).not.toMatch(/worktree each/);
	});

	test("says neither when the workspace answer is not recorded", () => {
		const first = run(two(), "ready").out.split("\n")[0];
		expect(first).toMatch(/2 ready now/);
		expect(first).not.toMatch(/worktree each|serial/);
	});
});

// The deep flow used to init in the main tree before the worktree existed, so
// the run lived where every later session's init would collide with it. move
// puts a stranded run where its controller actually works.
// Two runs in one repository is legal, two sessions in two worktrees, and it
// is also what a stranded run plus a fresh init looks like. init says when the
// set already holds one, without refusing, so the second session knows.
describe("init reports other runs in the set", () => {
	test("names a live run in a sibling tree", () => {
		const main = gitRepo();
		const wt = worktree(main, "impl");
		run(wt, "init", "--topic", "gadget", "--channel", "fast");
		const r = run(main, "init", "--topic", "widget", "--channel", "deep");
		expect(r.code).toBe(0);
		expect(r.err).toMatch(/gadget/);
		expect(r.err).toMatch(/impl/);
	});

	test("says nothing when the set holds no other run", () => {
		const main = gitRepo();
		worktree(main, "impl");
		const r = run(main, "init", "--topic", "widget", "--channel", "deep");
		expect(r.code).toBe(0);
		expect(r.err).toBe("");
	});
});

describe("move", () => {
	test("relocates the run into another tree and leaves none behind", () => {
		const main = gitRepo();
		run(main, "init", "--topic", "widget", "--channel", "deep");
		run(main, "task", "1", "--name", "first", "--status", "active");
		const wt = worktree(main, "impl");
		const r = run(main, "move", "--to", wt);
		expect(r.code).toBe(0);
		expect(state(wt).topic).toBe("widget");
		expect(state(wt).tasks[0]?.name).toBe("first");
		expect(run(wt, "show").out).toContain("widget");
		expect(existsSync(join(main, ".sluice", "run.json"))).toBe(false);
	});

	test("the destination ignores itself like any run directory", () => {
		const main = gitRepo();
		run(main, "init", "--topic", "widget", "--channel", "deep");
		const wt = worktree(main, "impl");
		run(main, "move", "--to", wt);
		expect(readFileSync(join(wt, ".sluice", ".gitignore"), "utf8")).toBe("*\n");
	});

	test("refuses when the destination already has a run of its own", () => {
		const main = gitRepo();
		run(main, "init", "--topic", "widget", "--channel", "deep");
		const wt = worktree(main, "impl");
		run(wt, "init", "--topic", "gadget", "--channel", "fast");
		const r = run(main, "move", "--to", wt);
		expect(r.code).toBe(3);
		expect(state(main).topic).toBe("widget");
		expect(state(wt).topic).toBe("gadget");
	});

	test("needs a live run", () => {
		expect(run(repo(), "move", "--to", repo()).code).toBe(2);
	});

	test("needs a --to", () => {
		expect(run(seeded(1), "move").code).toBe(4);
	});

	// A typo'd destination inside the repo would strand the run at a path no
	// command issued from the tree resolves, so the destination has to be a work
	// tree of the same set.
	test("refuses a destination that is not a work tree of the same set", () => {
		const main = gitRepo();
		run(main, "init", "--topic", "widget", "--channel", "deep");
		mkdirSync(join(main, "docs"));
		expect(run(main, "move", "--to", join(main, "docs")).code).toBe(4);
		expect(run(main, "move", "--to", join(main, ".sluice")).code).toBe(4);
		expect(run(main, "move", "--to", gitRepo()).code).toBe(4);
		expect(state(main).topic).toBe("widget");
	});

	// Once the run has moved, the main tree is free: another session can start
	// its own run there, and the moved run stays where it went.
	test("the main tree can start another run after the move", () => {
		const main = gitRepo();
		run(main, "init", "--topic", "widget", "--channel", "deep");
		const wt = worktree(main, "impl");
		run(main, "move", "--to", wt);
		expect(run(main, "init", "--topic", "other", "--channel", "fast").code).toBe(0);
		expect(run(wt, "show").out).toContain("widget");
		expect(run(main, "show").out).toContain("other");
	});

	test("refuses a destination that is not a directory", () => {
		const dir = seeded(1);
		expect(run(dir, "move", "--to", join(dir, "nowhere")).code).toBe(4);
		expect(state(dir).topic).toBe("widget");
	});

	test("init names move as a way out when a run is already live", () => {
		const dir = seeded(1);
		const r = run(dir, "init", "--topic", "other", "--channel", "fast");
		expect(r.code).toBe(3);
		expect(r.err).toMatch(/move --to/);
	});

	// The session that moves the run does not always move with it: the harness
	// holds one working directory and a `git worktree add` does not change it.
	// Resolved per tree, the run then reads as absent from the tree the
	// controller is still sitting in, which is the tree its statusline, its
	// SessionStart hook and its bare `show` all ask about.
	test("a session left in the tree the run came from still reads it", () => {
		const main = gitRepo();
		run(main, "init", "--topic", "widget", "--channel", "deep");
		run(main, "task", "1", "--name", "first", "--status", "active");
		run(main, "move", "--to", worktree(main, "impl"));

		const r = run(main, "show");
		expect(r.code).toBe(0);
		expect(r.out).toContain("widget");
		expect(r.out).toContain("first");
	});

	test("a flip issued from the tree the run came from lands in the moved run", () => {
		const main = gitRepo();
		run(main, "init", "--topic", "widget", "--channel", "deep");
		run(main, "task", "1", "--name", "first");
		const wt = worktree(main, "impl");
		run(main, "move", "--to", wt);

		expect(run(main, "task", "1", "--status", "done", "--commit", "abc1234").code).toBe(0);
		expect(state(wt).tasks[0]).toMatchObject({ id: 1, status: "done", commit: "abc1234" });
		expect(existsSync(join(main, ".sluice", "run.json"))).toBe(false);
	});

	test("a second move forwards to the tree the run is in now", () => {
		const main = gitRepo();
		run(main, "init", "--topic", "widget", "--channel", "deep");
		const first = worktree(main, "impl");
		run(main, "move", "--to", first);
		const second = worktree(main, "controller");
		run(first, "move", "--to", second);

		expect(state(second).topic).toBe("widget");
		expect(run(main, "show").out).toContain("widget");
		expect(existsSync(join(first, ".sluice", "run.json"))).toBe(false);
	});

	// A note left pointing at a tree whose run is closed does not go quiet: the
	// next run started in that tree inherits the forward and reads as this
	// tree's, though nobody here opened it.
	test("a closed run stops forwarding, even when its tree starts another", () => {
		const main = gitRepo();
		run(main, "init", "--topic", "widget", "--channel", "deep");
		const wt = worktree(main, "impl");
		run(main, "move", "--to", wt);
		expect(run(wt, "close").code).toBe(0);
		run(wt, "init", "--topic", "gadget", "--channel", "fast");

		expect(run(main, "show").code).toBe(2);
		expect(run(main, "show").out).not.toContain("gadget");
	});

	// Everything sluice writes into a tree is working state, and a tree that
	// only forwarded a run away has nothing of its own to commit.
	test("the move leaves the tree it came from clean", () => {
		const main = gitRepo();
		run(main, "init", "--topic", "widget", "--channel", "deep");
		run(main, "move", "--to", worktree(main, "impl"));

		const porcelain = Bun.spawnSync({
			cmd: ["git", "-C", main, "status", "--porcelain"],
			timeout: 10000,
		});
		expect(porcelain.stdout.toString()).toBe("");
	});

	// The move is only half done while the session is still elsewhere, and the
	// half that is missing is the one no command can do for it.
	test("the move says the session has to follow the run", () => {
		const main = gitRepo();
		run(main, "init", "--topic", "widget", "--channel", "deep");
		const wt = worktree(main, "impl");

		const r = run(main, "move", "--to", wt);
		expect(r.code).toBe(0);
		expect(r.out).toContain(wt);
		expect(r.out).toMatch(/session/);
	});
});

// A task name is model-written and routinely pasted from an issue title, and it
// is drawn straight onto a terminal by the statusline, by `show`, and by the
// SessionStart hook. A control byte in one is therefore an escape sequence the
// terminal obeys: ESC[2J clears the screen on every render, and a carriage
// return walks the cursor back over the row sluice just drew.
describe("free text cannot carry control bytes to a terminal", () => {
	const ESC = "";

	test("a name carrying an escape sequence is refused", () => {
		const dir = seeded(1);
		const r = run(dir, "task", "1", "--name", `a${ESC}[2Jb`);
		expect(r.code).toBe(4);
		expect(r.err).toContain("--name");
	});

	test("the refused name is not written", () => {
		const dir = seeded(1);
		run(dir, "task", "1", "--name", `a${ESC}[2Jb`);
		expect(state(dir).tasks[0]!.name).toBe("T1");
	});

	test("a carriage return in a name is refused", () => {
		const dir = seeded(1);
		expect(run(dir, "task", "1", "--name", `first${String.fromCharCode(13)}overwrite`).code).toBe(4);
	});

	test("a newline in a name is refused", () => {
		const dir = seeded(1);
		expect(run(dir, "task", "1", "--name", `first${String.fromCharCode(10)}second`).code).toBe(4);
	});

	test("a topic carrying an escape sequence is refused", () => {
		const r = run(repo(), "init", "--topic", `x${ESC}[2Jy`, "--channel", "deep");
		expect(r.code).toBe(4);
		expect(r.err).toContain("--topic");
	});

	test("a pause reason carrying an escape sequence is refused", () => {
		const dir = seeded(1);
		expect(run(dir, "pause", "--reason", `wait${ESC}[2J`).code).toBe(4);
	});

	// The check must not cost ordinary names the punctuation and non-ASCII they
	// legitimately carry.
	test("punctuation, quotes and non-ASCII in a name are untouched", () => {
		const dir = seeded(1);
		const name = "Rebuild the \"timeline\" band — 1 glyph/event (≤80%)";
		expect(run(dir, "task", "1", "--name", name).code).toBe(0);
		expect(state(dir).tasks[0]!.name).toBe(name);
	});
});

// State already on disk was written before the check existed, or by hand, so
// the render cannot assume its input is clean. Everything the render emits
// itself is an SGR colour sequence; strip those and nothing but newlines should
// be left, whatever the state holds.
describe("the render emits no control bytes of its own but colour", () => {
	const ESC = "";
	const LEFTOVER = /[ -	-]/;

	/** Writes a run whose free text is full of control bytes, bypassing the CLI. */
	function poisoned(dir: string) {
		const s = state(dir);
		s.topic = `topic${ESC}[2J`;
		s.tasks[0]!.name = `name${ESC}[2J
more`;
		s.paused = `why${ESC}[2J`;
		writeFileSync(join(dir, ".sluice", "run.json"), JSON.stringify(s, null, 2));
	}

	/** Output with its SGR colour sequences removed. */
	function bare(out: string): string {
		return out.replace(/\[[0-9;]*m/g, "");
	}

	test("the wide statusline render carries none through", () => {
		const dir = seeded(1);
		run(dir, "task", "1", "--status", "active");
		poisoned(dir);

		const out = run(dir, "line", "--full").out;
		expect(out).toContain("topic");
		expect(bare(out)).not.toMatch(LEFTOVER);
	});

	test("show carries none through", () => {
		const dir = seeded(1);
		poisoned(dir);

		const out = run(dir, "show").out;
		expect(out).toContain("topic");
		expect(bare(out)).not.toMatch(LEFTOVER);
	});
});

// A skip that pre-flight priced and a skip nobody noticed leave the same gap in
// the code, so both stay in the count. What separates them is the word: the
// first was spent, the second is owed. `.preflight.review` is the record of the
// stop having happened, so it is what tells the two apart.
describe("a review level chosen at pre-flight reads as coverage, not debt", () => {
	/** Two done tier 1 tasks, neither reviewed. */
	function skipped(): string {
		const dir = seeded(2);
		run(dir, "task", "1", "--tier", "1", "--status", "done");
		run(dir, "task", "2", "--tier", "1", "--status", "done");
		return dir;
	}

	test("show calls the count coverage once a review answer is on file", () => {
		const dir = skipped();
		run(dir, "preflight", "--review", "tier 3 only");
		const out = run(dir, "show").out;
		expect(out).toMatch(/coverage\s+2 done at tier 1\+, no dispatch/);
		expect(out).not.toMatch(/^unreviewed/m);
		expect(out).not.toMatch(/owed/);
	});

	// The answer is on the page either way: the pre-flight row carries it three
	// lines below, and saying it twice in a seven-line header is repetition.
	test("but does not repeat the answer the pre-flight row already carries", () => {
		const dir = skipped();
		run(dir, "preflight", "--review", "tier 3 only");
		const out = run(dir, "show").out;
		expect(out.match(/tier 3 only/g)).toHaveLength(1);
		expect(out).toMatch(/pre-flight\s+review=tier 3 only/);
	});

	test("show still calls it unreviewed when no review answer was recorded", () => {
		const out = run(skipped(), "show").out;
		expect(out).toMatch(/unreviewed\s+2 done at tier 1\+, owed a review/);
		expect(out).not.toMatch(/coverage/);
	});

	test("a pre-flight that priced only the model has not priced review", () => {
		const dir = skipped();
		run(dir, "preflight", "--model", "6 of 9 cheap");
		expect(run(dir, "show").out).toMatch(/unreviewed\s+2 done/);
	});

	test("the statusline names the chosen level rather than nagging unreviewed", () => {
		const dir = skipped();
		run(dir, "preflight", "--review", "tier 3 only");
		const detail = plain(run(dir, "line", "--full").out).split("\n")[2] ?? "";
		expect(detail).toMatch(/⟲ 2 at the chosen level/);
		expect(detail).not.toMatch(/unreviewed/);
	});

	test("and draws it dim rather than in the warning colour", () => {
		const dir = skipped();
		run(dir, "preflight", "--review", "tier 3 only");
		const detail = run(dir, "line", "--full").out.split("\n")[2] ?? "";
		expect(detail).toContain("\x1b[2m⟲ 2 at the chosen level");
	});

	test("close reports the level chosen rather than a debt", () => {
		const dir = skipped();
		run(dir, "preflight", "--review", "tier 3 only");
		const out = run(dir, "close").out;
		expect(out).toMatch(/2 at the chosen review level/);
		expect(out).not.toMatch(/unreviewed/);
	});

	test("close still reports a debt when nobody priced review", () => {
		expect(run(skipped(), "close").out).toMatch(/2 unreviewed/);
	});

	test("a reviewed task leaves the count whichever way review was priced", () => {
		const dir = skipped();
		run(dir, "preflight", "--review", "tier 3 only");
		run(dir, "task", "1", "--reviewed");
		expect(run(dir, "show").out).toMatch(/coverage\s+1 done at tier 1\+/);
	});

	test("nothing is said at all when every task that qualified was reviewed", () => {
		const dir = skipped();
		run(dir, "preflight", "--review", "every task");
		run(dir, "task", "1", "--reviewed");
		run(dir, "task", "2", "--reviewed");
		const out = run(dir, "show").out;
		expect(out).not.toMatch(/coverage/);
		expect(out).not.toMatch(/unreviewed/);
	});
});

// The call exists so the chosen channel lands in the transcript as a command
// that ran, which run-stats and the stop guard read back. A route is taken
// before any run is opened, so it must not leave a half-made one behind.
describe("route", () => {
	test("names the channel on stdout", () => {
		const r = run(repo(), "route", "fast");
		expect(r.code).toBe(0);
		expect(r.out).toBe("sluice: fast channel\n");
	});

	test("refuses bypass, the channel that runs no script", () => {
		const r = run(repo(), "route", "bypass");
		expect(r.code).toBe(4);
		expect(r.out).toBe("");
		expect(r.err).toMatch(/bypass/);
	});

	test("refuses a channel that does not exist", () => {
		const r = run(repo(), "route", "sideways");
		expect(r.code).toBe(4);
		expect(r.out).toBe("");
		expect(r.err).toMatch(/sideways/);
	});

	test("refuses a missing channel", () => {
		const r = run(repo(), "route");
		expect(r.code).toBe(4);
		expect(r.out).toBe("");
		expect(r.err).toMatch(/one of: fast main deep/);
	});

	test("leaves no run state behind", () => {
		const dir = repo();
		expect(run(dir, "route", "deep").code).toBe(0);
		expect(existsSync(join(dir, ".sluice"))).toBe(false);
	});
});
