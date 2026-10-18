import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPTS = join(import.meta.dir, "..", "skills", "sluice", "scripts");
const GUARD = join(SCRIPTS, "stop-guard.sh");
const STATUS = join(SCRIPTS, "status.sh");

function repo(): string {
	return mkdtempSync(join(tmpdir(), "sluice-guard-"));
}

function status(dir: string, ...args: string[]) {
	return Bun.spawnSync({ cmd: ["bash", STATUS, ...args, "--dir", dir], timeout: 5000 });
}

/** Runs the guard the way the harness does: the stop JSON on stdin. */
function guard(input: Record<string, unknown>) {
	const proc = Bun.spawnSync({
		cmd: ["bash", GUARD],
		stdin: new TextEncoder().encode(JSON.stringify(input)),
		cwd: tmpdir(),
		timeout: 5000,
	});
	return { code: proc.exitCode, out: proc.stdout.toString(), err: proc.stderr.toString() };
}

/** A deep run past pre-flight with `n` tasks, `done` of them done. */
function midRun(n: number, done: number): string {
	const dir = repo();
	status(dir, "init", "--topic", "widget", "--channel", "deep");
	for (let i = 1; i <= n; i++) status(dir, "task", String(i), "--name", `T${i}`, "--tier", "1");
	for (let i = 1; i <= done; i++) status(dir, "task", String(i), "--status", "done");
	status(dir, "preflight", "--review", "tier 3", "--effort", "all session", "--workspace", "shared tree");
	return dir;
}

function decision(out: string): string | undefined {
	if (out.trim() === "") return undefined;
	return JSON.parse(out).decision;
}

// A turn that ends with a live run and nothing for the partner to decide is
// the overnight failure: the run sits half done until morning. The guard
// refuses that stop and says what to do instead.
describe("stop-guard.sh", () => {
	test("parses under bash -n", () => {
		const proc = Bun.spawnSync(["bash", "-n", GUARD]);
		expect(proc.stderr.toString()).toBe("");
		expect(proc.exitCode).toBe(0);
	});

	test("blocks a stop in the middle of a deep run", () => {
		const r = guard({ cwd: midRun(5, 3), stop_hook_active: false });
		expect(r.code).toBe(0);
		expect(decision(r.out)).toBe("block");
		const reason = JSON.parse(r.out).reason as string;
		expect(reason).toMatch(/3\/5/);
		expect(reason).toMatch(/ready/);
		expect(reason).toMatch(/blocked/);
		expect(reason).toMatch(/pause/);
	});

	test("lets a tree with no run stop", () => {
		const r = guard({ cwd: repo(), stop_hook_active: false });
		expect(r.code).toBe(0);
		expect(r.out).toBe("");
	});

	test("lets the pre-flight stop happen: no answers recorded yet", () => {
		const dir = repo();
		status(dir, "init", "--topic", "widget", "--channel", "deep");
		status(dir, "task", "1", "--name", "T1");
		expect(guard({ cwd: dir, stop_hook_active: false }).out).toBe("");
	});

	test("lets a run with a blocked task stop", () => {
		const dir = midRun(5, 3);
		status(dir, "task", "4", "--status", "blocked");
		expect(guard({ cwd: dir, stop_hook_active: false }).out).toBe("");
	});

	test("lets a finished run stop for the handback", () => {
		expect(guard({ cwd: midRun(3, 3), stop_hook_active: false }).out).toBe("");
	});

	test("lets a paused run stop", () => {
		const dir = midRun(5, 3);
		status(dir, "pause", "--reason", "waiting on a credential");
		expect(guard({ cwd: dir, stop_hook_active: false }).out).toBe("");
	});

	test("blocks again once the run is resumed", () => {
		const dir = midRun(5, 3);
		status(dir, "pause", "--reason", "waiting on a credential");
		status(dir, "resume");
		expect(decision(guard({ cwd: dir, stop_hook_active: false }).out)).toBe("block");
	});

	test("never blocks twice in a row: the harness flag is honoured", () => {
		expect(guard({ cwd: midRun(5, 3), stop_hook_active: true }).out).toBe("");
	});

	test("leaves fast and main runs alone", () => {
		const dir = repo();
		status(dir, "init", "--topic", "widget", "--channel", "fast");
		status(dir, "task", "1", "--name", "T1");
		status(dir, "preflight", "--review", "x");
		expect(guard({ cwd: dir, stop_hook_active: false }).out).toBe("");
	});

	test("stays silent and exits 0 on unreadable state", () => {
		const dir = midRun(2, 1);
		writeFileSync(join(dir, ".sluice", "run.json"), "{ truncated");
		const r = guard({ cwd: dir, stop_hook_active: false });
		expect(r.code).toBe(0);
		expect(r.out).toBe("");
	});

	// `active` is set at dispatch and `review` when the reviewer goes out, so
	// either one means an agent is running that the harness will report back
	// on, and waiting for it is a stop the run wants.
	test("lets a run stop while a dispatched task is active", () => {
		const dir = midRun(3, 1);
		status(dir, "task", "2", "--status", "active");
		const r = guard({ cwd: dir, stop_hook_active: false });
		expect(r.code).toBe(0);
		expect(r.out).toBe("");
	});

	test("lets a run stop while a task is out for review", () => {
		const dir = midRun(3, 1);
		status(dir, "task", "2", "--status", "review");
		const r = guard({ cwd: dir, stop_hook_active: false });
		expect(r.code).toBe(0);
		expect(r.out).toBe("");
	});

	test("blocks a stop when the open tasks are all todo and nothing is in flight", () => {
		expect(decision(guard({ cwd: midRun(3, 1), stop_hook_active: false }).out)).toBe("block");
	});

	// The refusal reason is printed by the harness, so a control byte in the
	// topic it carries reaches a terminal exactly as the statusline's would.
	test("a topic with a control byte does not reach the refusal reason", () => {
		const dir = midRun(5, 3);
		const run = JSON.parse(readFileSync(join(dir, ".sluice", "run.json"), "utf8"));
		run.topic = `top${String.fromCharCode(27)}[2J`;
		writeFileSync(join(dir, ".sluice", "run.json"), JSON.stringify(run, null, 2));

		const r = guard({ cwd: dir, stop_hook_active: false });
		const reason = JSON.parse(r.out).reason as string;
		expect(reason).toContain("top[2J");
		expect(reason).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f]/);
	});
});

// The guard reads the session's own tree and nothing else. The fallback that
// lets a runless worktree read the main tree's run is for controllers who
// moved after init; a Stop in that worktree may be another session entirely,
// and the remedy the guard prints must never reach into somebody else's run.
describe("stop-guard.sh reads only the session's own tree", () => {
	function gitRepo(): string {
		const dir = repo();
		const git = (...args: string[]) => Bun.spawnSync({ cmd: ["git", "-C", dir, ...args], timeout: 10000 });
		git("init", "-q");
		git("config", "user.email", "t@example.com");
		git("config", "user.name", "t");
		writeFileSync(join(dir, "README.md"), "hi\n");
		git("add", "-A");
		git("commit", "-qm", "init");
		return dir;
	}
	function worktree(main: string, branch = "impl"): string {
		const path = join(mkdtempSync(join(tmpdir(), "sluice-wt-")), branch);
		Bun.spawnSync({ cmd: ["git", "-C", main, "worktree", "add", "-q", path, "-b", branch], timeout: 10000 });
		return path;
	}
	function midRunIn(dir: string) {
		status(dir, "init", "--topic", "widget", "--channel", "deep");
		for (let i = 1; i <= 3; i++) status(dir, "task", String(i), "--name", `T${i}`, "--tier", "1");
		status(dir, "task", "1", "--status", "done");
		status(dir, "preflight", "--review", "x", "--effort", "y", "--workspace", "z");
	}

	test("a linked worktree with no run of its own is let stop, whatever the main tree holds", () => {
		const main = gitRepo();
		midRunIn(main);
		expect(guard({ cwd: worktree(main), stop_hook_active: false }).out).toBe("");
	});

	test("a linked worktree holding its own run is guarded", () => {
		const main = gitRepo();
		const wt = worktree(main);
		midRunIn(wt);
		expect(decision(guard({ cwd: wt, stop_hook_active: false }).out)).toBe("block");
		expect(guard({ cwd: main, stop_hook_active: false }).out).toBe("");
	});

	test("a session in a subdirectory of the tree holding the run is still guarded", () => {
		const main = gitRepo();
		midRunIn(main);
		mkdirSync(join(main, "src", "deep"), { recursive: true });
		expect(decision(guard({ cwd: join(main, "src", "deep"), stop_hook_active: false }).out)).toBe("block");
	});

	// `move` relocates the run and not the session, so the controller goes on
	// sitting in the tree the run left. Read as the tree's own state and nothing
	// else, that session stopped being guarded at the moment it moved its run,
	// which is the middle of the run it is guarded for.
	test("the tree the run moved out of is still guarded", () => {
		const main = gitRepo();
		midRunIn(main);
		status(main, "move", "--to", worktree(main));

		expect(decision(guard({ cwd: main, stop_hook_active: false }).out)).toBe("block");
	});

	test("the refusal names the tree the run moved to", () => {
		const main = gitRepo();
		midRunIn(main);
		const wt = worktree(main);
		status(main, "move", "--to", wt);

		const reason = JSON.parse(guard({ cwd: main, stop_hook_active: false }).out).reason as string;
		expect(reason).toContain(realpathSync(wt));
		expect(reason).toMatch(/move this session/);
	});

	// Closing is the remedy for a run left open in the tree you are in. Here the
	// run is live in another tree and may be another session's, and archiving it
	// from this one would take the run out from under whoever is running it.
	test("the refusal does not offer close from the tree the run left", () => {
		const main = gitRepo();
		midRunIn(main);
		status(main, "move", "--to", worktree(main));

		const reason = JSON.parse(guard({ cwd: main, stop_hook_active: false }).out).reason as string;
		expect(reason).not.toMatch(/status\.sh close/);
	});

	test("a worktree is let stop though the main tree forwards a run to another", () => {
		const main = gitRepo();
		midRunIn(main);
		status(main, "move", "--to", worktree(main, "controller"));

		expect(guard({ cwd: worktree(main, "other"), stop_hook_active: false }).out).toBe("");
	});

	// The forward is followed only while the run it names is really there. A
	// note that outlived its run is stale, not a run to refuse a stop over.
	test("a forward to a tree with no run is let stop", () => {
		const main = gitRepo();
		midRunIn(main);
		const wt = worktree(main);
		status(main, "move", "--to", wt);
		status(wt, "close");

		mkdirSync(join(main, ".sluice"), { recursive: true });
		writeFileSync(join(main, ".sluice", "run.at"), `${wt}\n`);
		expect(guard({ cwd: main, stop_hook_active: false }).out).toBe("");
	});

	test("a run idle for more than a day is a stale run, not a live one, and is let stop", () => {
		const dir = midRun(5, 3);
		const path = join(dir, ".sluice", "run.json");
		const s = JSON.parse(readFileSync(path, "utf8"));
		s.updated = new Date(Date.now() - 30 * 3600 * 1000).toISOString().replace(/\.\d+Z$/, "Z");
		writeFileSync(path, JSON.stringify(s));
		expect(guard({ cwd: dir, stop_hook_active: false }).out).toBe("");
	});
});

describe("stop-guard.sh reason text", () => {
	test("carries the whole topic, spaces and shell metacharacters included", () => {
		const dir = repo();
		status(dir, "init", "--topic", "rewrite the * exporter", "--channel", "deep");
		status(dir, "task", "1", "--name", "T1", "--tier", "1");
		status(dir, "preflight", "--review", "x");
		const r = guard({ cwd: dir, stop_hook_active: false });
		expect(r.err).toBe("");
		expect(JSON.parse(r.out).reason).toContain("rewrite the * exporter");
	});

	test("names every open task by id and name", () => {
		const dir = repo();
		status(dir, "init", "--topic", "widget", "--channel", "deep");
		status(dir, "task", "1", "--name", "installer copy", "--tier", "1");
		status(dir, "task", "2", "--name", "quiet flag parsing", "--tier", "1");
		status(dir, "task", "3", "--name", "route progress", "--tier", "1");
		status(dir, "task", "1", "--status", "done");
		status(dir, "preflight", "--review", "x");
		const reason = JSON.parse(guard({ cwd: dir, stop_hook_active: false }).out).reason as string;
		expect(reason).toContain("open: T2 quiet flag parsing, T3 route progress");
	});

	test("says how to mark a blocked task once, by the command", () => {
		const reason = JSON.parse(guard({ cwd: midRun(3, 1), stop_hook_active: false }).out).reason as string;
		expect(reason.split("status.sh task <id> --status blocked").length - 1).toBe(1);
		expect(reason).not.toContain("If one is blocked, mark it and say what is blocking it.");
	});

	// Task names are user text written into run.json, and the reason is printed
	// by the harness, so they get the same treatment as the topic.
	test("a task name with a control byte reaches the reason with the byte removed", () => {
		const dir = midRun(3, 1);
		const run = JSON.parse(readFileSync(join(dir, ".sluice", "run.json"), "utf8"));
		run.tasks[1].name = `wipe${String.fromCharCode(27)}[2J`;
		writeFileSync(join(dir, ".sluice", "run.json"), JSON.stringify(run, null, 2));

		const reason = JSON.parse(guard({ cwd: dir, stop_hook_active: false }).out).reason as string;
		expect(reason).toContain("open: T2 wipe[2J, T3 T3");
		expect(reason).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f]/);
	});

	test("offers close for a run that is not this session's work", () => {
		const reason = JSON.parse(guard({ cwd: midRun(5, 3), stop_hook_active: false }).out).reason as string;
		expect(reason).toMatch(/status\.sh close/);
	});

	test("a stop JSON with no stop_hook_active field is treated as a first stop", () => {
		expect(decision(guard({ cwd: midRun(5, 3) }).out)).toBe("block");
	});

	test("non-JSON stdin falls back to the working directory and stays quiet there", () => {
		const proc = Bun.spawnSync({
			cmd: ["bash", GUARD],
			stdin: new TextEncoder().encode("not json"),
			cwd: repo(),
			timeout: 5000,
		});
		expect(proc.exitCode).toBe(0);
		expect(proc.stdout.toString()).toBe("");
	});
});

describe("pause and resume", () => {
	test("pause records the reason and show prints it", () => {
		const dir = midRun(2, 1);
		const r = status(dir, "pause", "--reason", "waiting on a credential");
		expect(r.exitCode).toBe(0);
		const s = JSON.parse(readFileSync(join(dir, ".sluice", "run.json"), "utf8"));
		expect(s.paused).toBe("waiting on a credential");
		expect(status(dir, "show").stdout.toString()).toMatch(/paused\s+waiting on a credential/);
	});

	test("pause needs a reason", () => {
		expect(status(midRun(1, 0), "pause").exitCode).toBe(4);
	});

	test("resume clears it", () => {
		const dir = midRun(2, 1);
		status(dir, "pause", "--reason", "x");
		expect(status(dir, "resume").exitCode).toBe(0);
		const s = JSON.parse(readFileSync(join(dir, ".sluice", "run.json"), "utf8"));
		expect(s.paused).toBeUndefined();
		expect(status(dir, "show").stdout.toString()).not.toMatch(/paused/);
	});

	test("the statusline first row says paused", () => {
		const dir = midRun(2, 1);
		status(dir, "pause", "--reason", "x");
		const rows = status(dir, "line", "--full").stdout.toString().split("\n");
		expect(rows[0]).toMatch(/paused/);
	});

	test("so does the compact statusline", () => {
		const dir = midRun(2, 1);
		status(dir, "pause", "--reason", "x");
		expect(status(dir, "line").stdout.toString()).toMatch(/paused/);
	});
});

// The deep guard above only arms once a run exists, and a run only exists once
// the skill has been invoked. A session that never routed at all therefore
// passes it in silence, which is how a whole session's worth of code changes
// reaches the handback with no channel behind it. This check is the entry
// side: the tree moved while this session held it, and nothing was announced.
describe("stop-guard.sh entry check", () => {
	function gitRepo(): string {
		const dir = mkdtempSync(join(tmpdir(), "sluice-entry-"));
		const git = (...args: string[]) => Bun.spawnSync({ cmd: ["git", "-C", dir, ...args], timeout: 10000 });
		git("init", "-q");
		git("config", "user.email", "t@example.com");
		git("config", "user.name", "t");
		writeFileSync(join(dir, "README.md"), "hi\n");
		git("add", "-A");
		git("commit", "-qm", "init");
		return dir;
	}

	/** A config dir standing in for ~/.claude, so stamps land somewhere disposable. */
	function configDir(): string {
		return mkdtempSync(join(tmpdir(), "sluice-cfg-"));
	}

	/** The baseline, taken by the hook that really takes it: the two scripts
	 * agreeing on the stamp's format is half of what this guard rests on. */
	function stamp(cfg: string, sid: string, tree: string) {
		Bun.spawnSync({
			cmd: ["bash", join(SCRIPTS, "session-start.sh")],
			stdin: new TextEncoder().encode(JSON.stringify({ cwd: tree, session_id: sid, source: "startup" })),
			cwd: tmpdir(),
			env: { ...process.env, CLAUDE_CONFIG_DIR: cfg },
			timeout: 5000,
		});
	}

	/** A transcript holding one assistant message with the given text. */
	function transcript(text: string): string {
		const path = join(mkdtempSync(join(tmpdir(), "sluice-tx-")), "s.jsonl");
		writeFileSync(path, `${JSON.stringify({
			type: "assistant",
			message: { role: "assistant", content: [{ type: "text", text }] },
		})}\n`);
		return path;
	}

	function entryGuard(input: Record<string, unknown>, cfg: string) {
		const proc = Bun.spawnSync({
			cmd: ["bash", GUARD],
			stdin: new TextEncoder().encode(JSON.stringify(input)),
			cwd: tmpdir(),
			env: { ...process.env, CLAUDE_CONFIG_DIR: cfg },
			timeout: 5000,
		});
		return { code: proc.exitCode, out: proc.stdout.toString(), err: proc.stderr.toString() };
	}

	test("nudges when the tree moved this session and no channel was announced", () => {
		const cfg = configDir();
		const dir = gitRepo();
		stamp(cfg, "s1", dir);
		writeFileSync(join(dir, "feature.ts"), "export const x = 1;\n");

		const r = entryGuard(
			{ cwd: dir, session_id: "s1", transcript_path: transcript("Done, that works."), stop_hook_active: false },
			cfg,
		);
		expect(r.code).toBe(0);
		expect(decision(r.out)).toBe("block");
		expect(JSON.parse(r.out).reason as string).toMatch(/sluice/i);
	});

	test("stays silent when the session announced a channel", () => {
		const cfg = configDir();
		const dir = gitRepo();
		stamp(cfg, "s2", dir);
		writeFileSync(join(dir, "feature.ts"), "export const x = 1;\n");

		const r = entryGuard(
			{
				cwd: dir,
				session_id: "s2",
				transcript_path: transcript("Fast channel, existing interfaces. Test first."),
				stop_hook_active: false,
			},
			cfg,
		);
		expect(r.out).toBe("");
	});

	// A session that opens on an already-dirty tree and only answers questions
	// must not be nudged for changes it never made.
	test("stays silent when the tree has not moved since the session opened", () => {
		const cfg = configDir();
		const dir = gitRepo();
		writeFileSync(join(dir, "pre-existing.ts"), "export const y = 2;\n");
		stamp(cfg, "s3", dir);

		const r = entryGuard(
			{ cwd: dir, session_id: "s3", transcript_path: transcript("Here is why that fails."), stop_hook_active: false },
			cfg,
		);
		expect(r.out).toBe("");
	});

	test("nudges only once per session", () => {
		const cfg = configDir();
		const dir = gitRepo();
		stamp(cfg, "s4", dir);
		writeFileSync(join(dir, "feature.ts"), "export const x = 1;\n");
		const input = {
			cwd: dir,
			session_id: "s4",
			transcript_path: transcript("Done."),
			stop_hook_active: false,
		};

		expect(decision(entryGuard(input, cfg).out)).toBe("block");
		expect(entryGuard(input, cfg).out).toBe("");
	});

	test("stays silent when the session left no stamp", () => {
		const cfg = configDir();
		const dir = gitRepo();
		writeFileSync(join(dir, "feature.ts"), "export const x = 1;\n");

		const r = entryGuard(
			{ cwd: dir, session_id: "nope", transcript_path: transcript("Done."), stop_hook_active: false },
			cfg,
		);
		expect(r.out).toBe("");
	});

	// The stamp names the tree it was taken in. A session that moved to another
	// tree must not have that tree's changes read against its own baseline.
	test("stays silent when the stamp belongs to another tree", () => {
		const cfg = configDir();
		const mine = gitRepo();
		const other = gitRepo();
		stamp(cfg, "s5", other);
		writeFileSync(join(mine, "feature.ts"), "export const x = 1;\n");

		const r = entryGuard(
			{ cwd: mine, session_id: "s5", transcript_path: transcript("Done."), stop_hook_active: false },
			cfg,
		);
		expect(r.out).toBe("");
	});

	// The gate reads announcements the way the meter does, from a copy of its
	// two patterns. These are the wordings that decide whether a session counts
	// as routed, and they are the reason the copy has to stay in step.
	test.each([
		["Fast channel, existing interfaces. Test first.", true],
		["Deep channel, several subsystems. Design before code.", true],
		["Sluice: **deep channel**", true],
		["Tier 2 (new contract surface) = **deep channel**", true],
		// The skill's own wording rule: this one reports as `not announced` to
		// the meter, so the gate must not accept it either.
		["**Channel: deep**", false],
		["I could take this through the deep channel if you want.", false],
		["Done, that works.", false],
	])("announcement %p counts as routed: %p", (text, routed) => {
		const cfg = configDir();
		const dir = gitRepo();
		stamp(cfg, "w", dir);
		writeFileSync(join(dir, "feature.ts"), "export const x = 1;\n");

		const r = entryGuard(
			{ cwd: dir, session_id: "w", transcript_path: transcript(text as string), stop_hook_active: false },
			cfg,
		);
		expect(r.out === "").toBe(routed as boolean);
	});

	// Work that got committed leaves the tree as clean as it started, so a
	// baseline made only of `git status --porcelain` reads a whole session's
	// worth of commits as "nothing happened".
	test("nudges when the session committed its work and announced nothing", () => {
		const cfg = configDir();
		const dir = gitRepo();
		stamp(cfg, "c1", dir);
		writeFileSync(join(dir, "feature.ts"), "export const x = 1;\n");
		Bun.spawnSync({ cmd: ["git", "-C", dir, "add", "-A"], timeout: 10000 });
		Bun.spawnSync({ cmd: ["git", "-C", dir, "commit", "-qm", "feature"], timeout: 10000 });

		const r = entryGuard(
			{ cwd: dir, session_id: "c1", transcript_path: transcript("Done."), stop_hook_active: false },
			cfg,
		);
		expect(decision(r.out)).toBe("block");
	});

	// The accepted limit, pinned so it is a decision rather than a surprise.
	// A git tree records no author, so a branch that moved under the session
	// is indistinguishable from a session that wrote code. Recall was chosen
	// over precision; the cost is this, bounded to one nudge per session.
	test("a branch switch onto a different commit is read as a change", () => {
		const cfg = configDir();
		const dir = gitRepo();
		const base = Bun.spawnSync({ cmd: ["git", "-C", dir, "symbolic-ref", "--short", "HEAD"] })
			.stdout.toString().trim();
		Bun.spawnSync({ cmd: ["git", "-C", dir, "checkout", "-q", "-b", "feature"], timeout: 10000 });
		writeFileSync(join(dir, "other.ts"), "export const z = 3;\n");
		Bun.spawnSync({ cmd: ["git", "-C", dir, "add", "-A"], timeout: 10000 });
		Bun.spawnSync({ cmd: ["git", "-C", dir, "commit", "-qm", "other"], timeout: 10000 });
		Bun.spawnSync({ cmd: ["git", "-C", dir, "checkout", "-q", base], timeout: 10000 });
		stamp(cfg, "c2", dir);
		Bun.spawnSync({ cmd: ["git", "-C", dir, "checkout", "-q", "feature"], timeout: 10000 });

		const r = entryGuard(
			{ cwd: dir, session_id: "c2", transcript_path: transcript("Switched branches for you."), stop_hook_active: false },
			cfg,
		);
		expect(decision(r.out)).toBe("block");
	});

	test("returning to the commit the session opened on is not a change", () => {
		const cfg = configDir();
		const dir = gitRepo();
		stamp(cfg, "c3", dir);
		Bun.spawnSync({ cmd: ["git", "-C", dir, "checkout", "-q", "-b", "scratch"], timeout: 10000 });
		Bun.spawnSync({ cmd: ["git", "-C", dir, "checkout", "-q", "-"], timeout: 10000 });

		const r = entryGuard(
			{ cwd: dir, session_id: "c3", transcript_path: transcript("Looked around."), stop_hook_active: false },
			cfg,
		);
		expect(r.out).toBe("");
	});

	// The stamp and the already-nudged marker used to share a namespace, so a
	// session id ending in `.nudged` disarmed the session named by its prefix.
	test("a session id ending in .nudged does not disarm its prefix", () => {
		const cfg = configDir();
		const dir = gitRepo();
		stamp(cfg, "zz.nudged", dir);
		stamp(cfg, "zz", dir);
		writeFileSync(join(dir, "feature.ts"), "export const x = 1;\n");

		const r = entryGuard(
			{ cwd: dir, session_id: "zz", transcript_path: transcript("Done."), stop_hook_active: false },
			cfg,
		);
		expect(decision(r.out)).toBe("block");
	});

	function git(dir: string, ...args: string[]) {
		return Bun.spawnSync({ cmd: ["git", "-C", dir, ...args], timeout: 10000 });
	}

	// A baseline made of the porcelain's shape alone says "` M wip.ts`" both
	// before and after the file is rewritten, so the commonest unrouted
	// session of all — one that edits work already in progress — is missed.
	test("nudges when the session rewrote a file that was already modified", () => {
		const cfg = configDir();
		const dir = gitRepo();
		writeFileSync(join(dir, "README.md"), "hi\nwip\n");
		stamp(cfg, "d1", dir);
		writeFileSync(join(dir, "README.md"), "completely different\n");

		const r = entryGuard(
			{ cwd: dir, session_id: "d1", transcript_path: transcript("Done."), stop_hook_active: false },
			cfg,
		);
		expect(decision(r.out)).toBe("block");
	});

	test("nudges when the session filled a directory that was already untracked", () => {
		const cfg = configDir();
		const dir = gitRepo();
		mkdirSync(join(dir, "build"), { recursive: true });
		writeFileSync(join(dir, "build", "one.js"), "1\n");
		stamp(cfg, "d2", dir);
		for (let i = 0; i < 10; i++) writeFileSync(join(dir, "build", `gen${i}.js`), `${i}\n`);

		const r = entryGuard(
			{ cwd: dir, session_id: "d2", transcript_path: transcript("Done."), stop_hook_active: false },
			cfg,
		);
		expect(decision(r.out)).toBe("block");
	});

	// SessionStart fires again on compact, and a long session is exactly the
	// one that compacts. Re-stamping there would rebaseline onto the work in
	// progress and disarm the check for the sessions it most exists for.
	test("a compact partway through does not rebaseline the session", () => {
		const cfg = configDir();
		const dir = gitRepo();
		stamp(cfg, "d3", dir);
		writeFileSync(join(dir, "feature.ts"), "export const x = 1;\n");
		Bun.spawnSync({
			cmd: ["bash", join(SCRIPTS, "session-start.sh")],
			stdin: new TextEncoder().encode(JSON.stringify({ cwd: dir, session_id: "d3", source: "compact" })),
			cwd: tmpdir(),
			env: { ...process.env, CLAUDE_CONFIG_DIR: cfg },
			timeout: 5000,
		});

		const r = entryGuard(
			{ cwd: dir, session_id: "d3", transcript_path: transcript("Done."), stop_hook_active: false },
			cfg,
		);
		expect(decision(r.out)).toBe("block");
	});

	// Reading the tree can fail for reasons that are not a change: an
	// interrupted index, a lock held by another git, a rebase in flight.
	// A guard that reads failure as movement blocks a turn over nothing.
	test("stays silent when the tree cannot be read at stop time", () => {
		const cfg = configDir();
		const dir = gitRepo();
		writeFileSync(join(dir, "wip.ts"), "export const y = 2;\n");
		stamp(cfg, "d4", dir);
		writeFileSync(join(dir, ".git", "index"), "corrupt");

		const r = entryGuard(
			{ cwd: dir, session_id: "d4", transcript_path: transcript("Done."), stop_hook_active: false },
			cfg,
		);
		expect(r.code).toBe(0);
		expect(r.out).toBe("");
	});

	// The harness appends to the transcript while the hook reads it, so the
	// last line can be half written. Treating that as "never announced"
	// blocks a session that did route.
	test("a half-written last line does not hide an announcement", () => {
		const cfg = configDir();
		const dir = gitRepo();
		stamp(cfg, "d5", dir);
		writeFileSync(join(dir, "feature.ts"), "export const x = 1;\n");

		const path = join(mkdtempSync(join(tmpdir(), "sluice-tx-")), "s.jsonl");
		writeFileSync(
			path,
			`${JSON.stringify({
				type: "assistant",
				message: { role: "assistant", content: [{ type: "text", text: "Fast channel, existing interfaces." }] },
			})}\n{"type":"assis`,
		);

		const r = entryGuard(
			{ cwd: dir, session_id: "d5", transcript_path: path, stop_hook_active: false },
			cfg,
		);
		expect(r.out).toBe("");
	});

	// The meter counts a session as routed when it invoked the skill, whatever
	// the announcement then said. A gate that disagreed would refuse turns the
	// ledger reports as a run.
	test("invoking the skill counts as routed even when the wording does not", () => {
		const cfg = configDir();
		const dir = gitRepo();
		stamp(cfg, "d6", dir);
		writeFileSync(join(dir, "feature.ts"), "export const x = 1;\n");

		const path = join(mkdtempSync(join(tmpdir(), "sluice-tx-")), "s.jsonl");
		writeFileSync(
			path,
			`${JSON.stringify({
				type: "assistant",
				message: {
					role: "assistant",
					content: [
						{ type: "tool_use", name: "Skill", input: { skill: "sluice" } },
						{ type: "text", text: "**Channel: deep**" },
					],
				},
			})}\n`,
		);

		const r = entryGuard(
			{ cwd: dir, session_id: "d6", transcript_path: path, stop_hook_active: false },
			cfg,
		);
		expect(r.out).toBe("");
	});

	// A model that routes in its thinking writes no announcing text, and the
	// route call is then the only announcement the meter sees. The gate has to
	// read it the same way or it refuses a run the ledger counts.
	test("a route call counts as routed with no announcing text and no skill call", () => {
		const cfg = configDir();
		const dir = gitRepo();
		stamp(cfg, "d7", dir);
		writeFileSync(join(dir, "feature.ts"), "export const x = 1;\n");

		const path = join(mkdtempSync(join(tmpdir(), "sluice-tx-")), "s.jsonl");
		writeFileSync(
			path,
			`${JSON.stringify({
				type: "assistant",
				message: {
					role: "assistant",
					content: [
						{
							type: "tool_use",
							name: "Bash",
							// Deep: a fast or main route on a moved, unverified tree is refused by the verification gate, and this is about the entry check reading the route call.
							input: { command: "bash ~/.claude/skills/sluice/scripts/status.sh route deep" },
						},
					],
				},
			})}\n`,
		);

		const r = entryGuard(
			{ cwd: dir, session_id: "d7", transcript_path: path, stop_hook_active: false },
			cfg,
		);
		expect(r.code).toBe(0);
		expect(r.out).toBe("");
	});

	// The same marker run-stats reads, so a quoted script path, the form a path
	// with a space needs, has to count here too or the gate and the meter disagree.
	test("a route call through a quoted script path counts as routed", () => {
		const cfg = configDir();
		const dir = gitRepo();
		stamp(cfg, "d8", dir);
		writeFileSync(join(dir, "feature.ts"), "export const x = 1;\n");

		const path = join(mkdtempSync(join(tmpdir(), "sluice-tx-")), "s.jsonl");
		writeFileSync(
			path,
			`${JSON.stringify({
				type: "assistant",
				message: {
					role: "assistant",
					content: [
						{
							type: "tool_use",
							name: "Bash",
							// Deep: a fast or main route on a moved, unverified tree is refused by the verification gate, and this is about the entry check reading the route call.
							input: { command: 'bash "/Users/a b/.claude/skills/sluice/scripts/status.sh" route deep; ls' },
						},
					],
				},
			})}\n`,
		);

		const r = entryGuard(
			{ cwd: dir, session_id: "d8", transcript_path: path, stop_hook_active: false },
			cfg,
		);
		expect(r.code).toBe(0);
		expect(r.out).toBe("");
	});

	// A search for the documented call is not a call, and reading it as one would
	// wave through exactly the unrouted session this check exists to catch.
	test("a search for the route call by its path is not routing", () => {
		const cfg = configDir();
		const dir = gitRepo();
		stamp(cfg, "d9", dir);
		writeFileSync(join(dir, "feature.ts"), "export const x = 1;\n");

		const path = join(mkdtempSync(join(tmpdir(), "sluice-tx-")), "s.jsonl");
		writeFileSync(
			path,
			`${JSON.stringify({
				type: "assistant",
				message: {
					role: "assistant",
					content: [
						{
							type: "tool_use",
							name: "Bash",
							input: { command: 'grep -rn "scripts/status.sh route deep" skills' },
						},
					],
				},
			})}\n`,
		);

		const r = entryGuard(
			{ cwd: dir, session_id: "d9", transcript_path: path, stop_hook_active: false },
			cfg,
		);
		expect(decision(r.out)).toBe("block");
	});

	test("a route call named inside a command's argument is not routing", () => {
		const cfg = configDir();
		const dir = gitRepo();
		stamp(cfg, "d10", dir);
		writeFileSync(join(dir, "feature.ts"), "export const x = 1;\n");

		const path = join(mkdtempSync(join(tmpdir(), "sluice-tx-")), "s.jsonl");
		writeFileSync(
			path,
			`${JSON.stringify({
				type: "assistant",
				message: {
					role: "assistant",
					content: [
						{
							type: "tool_use",
							name: "Bash",
							input: { command: 'git commit -qm "the grader now requires status.sh route main before any write"' },
						},
					],
				},
			})}\n`,
		);

		const r = entryGuard(
			{ cwd: dir, session_id: "d10", transcript_path: path, stop_hook_active: false },
			cfg,
		);
		expect(decision(r.out)).toBe("block");
	});

	// Both hooks must survive an environment with no HOME: they run wherever
	// the harness was launched from, and exiting non-zero breaks the contract
	// that a stop hook always exits 0.
	test("survives an environment with no HOME", () => {
		for (const script of ["stop-guard.sh", "session-start.sh"]) {
			const proc = Bun.spawnSync({
				cmd: ["env", "-u", "HOME", "-u", "CLAUDE_CONFIG_DIR", "bash", join(SCRIPTS, script)],
				stdin: new TextEncoder().encode(JSON.stringify({ cwd: tmpdir(), session_id: "h1" })),
				cwd: tmpdir(),
				timeout: 5000,
			});
			expect({ script, code: proc.exitCode, err: proc.stderr.toString() }).toEqual({
				script,
				code: 0,
				err: "",
			});
		}
	});

	test("honours the harness flag so the two guards cannot loop", () => {
		const cfg = configDir();
		const dir = gitRepo();
		stamp(cfg, "s6", dir);
		writeFileSync(join(dir, "feature.ts"), "export const x = 1;\n");

		const r = entryGuard(
			{ cwd: dir, session_id: "s6", transcript_path: transcript("Done."), stop_hook_active: true },
			cfg,
		);
		expect(r.out).toBe("");
	});

	// A fast or main handback used to rest on a prose rule to run the check.
	// The gate makes it a record: a passing check written against the tree as
	// it stands, or the handback is refused once and told how to make one.
	describe("verification gate", () => {
		/** A transcript whose assistant messages each make one route call, in order. */
		function routedTranscript(...channels: string[]): string {
			const path = join(mkdtempSync(join(tmpdir(), "sluice-tx-")), "s.jsonl");
			const lines = channels.map((channel) =>
				JSON.stringify({
					type: "assistant",
					message: {
						role: "assistant",
						content: [
							{
								type: "tool_use",
								name: "Bash",
								input: { command: `bash ~/.claude/skills/sluice/scripts/status.sh route ${channel}` },
							},
						],
					},
				}),
			);
			writeFileSync(path, `${lines.join("\n")}\n`);
			return path;
		}

		function verify(dir: string) {
			return Bun.spawnSync({ cmd: ["bash", STATUS, "verify", "--dir", dir, "--", "true"], timeout: 5000 });
		}

		/** A session routed through `channels` whose tree gained a file after it opened. */
		function movedSession(sid: string, ...channels: string[]) {
			const cfg = configDir();
			const dir = gitRepo();
			stamp(cfg, sid, dir);
			writeFileSync(join(dir, "feature.ts"), "export const x = 1;\n");
			const input = { cwd: dir, session_id: sid, transcript_path: routedTranscript(...channels), stop_hook_active: false };
			return { cfg, dir, input };
		}

		test("refuses a fast session's handback when the moved tree has no recorded check", () => {
			const { cfg, input } = movedSession("v1", "fast");

			const r = entryGuard(input, cfg);
			expect(r.code).toBe(0);
			expect(decision(r.out)).toBe("block");
		});

		test("the refusal names the recorded check and the no-check escape", () => {
			const { cfg, input } = movedSession("v2", "fast");

			const reason = JSON.parse(entryGuard(input, cfg).out).reason as string;
			expect(reason).toContain("status.sh verify --");
			expect(reason).toContain("--none");
		});

		test("refuses a main session's handback when the moved tree has no recorded check", () => {
			const { cfg, input } = movedSession("v3", "main");

			expect(decision(entryGuard(input, cfg).out)).toBe("block");
		});

		test("lets a verified tree hand back", () => {
			const { cfg, dir, input } = movedSession("v4", "fast");
			expect(verify(dir).exitCode).toBe(0);

			expect(entryGuard(input, cfg).out).toBe("");
		});

		test("refuses a tree edited after its check was recorded", () => {
			const { cfg, dir, input } = movedSession("v5", "main");
			expect(verify(dir).exitCode).toBe(0);
			// A tracked file: tree-snapshot.sh lists untracked paths without hashing them.
			writeFileSync(join(dir, "README.md"), "edited after the check\n");

			expect(decision(entryGuard(input, cfg).out)).toBe("block");
		});

		// fast and main's common shape is a new module plus its test, so the file
		// edited after the check is as often untracked as not.
		test("refuses a file the session created and edited after its check was recorded", () => {
			const { cfg, dir, input } = movedSession("v10", "fast");
			expect(verify(dir).exitCode).toBe(0);
			writeFileSync(join(dir, "feature.ts"), "export const x = 2;\n");

			expect(decision(entryGuard(input, cfg).out)).toBe("block");
		});

		// Test, commit, hand back is the ordinary end of a fast turn, and the
		// commit changes where HEAD sits, not what was checked.
		test("lets a commit of the verified content hand back", () => {
			const { cfg, dir, input } = movedSession("v11", "main");
			expect(verify(dir).exitCode).toBe(0);
			Bun.spawnSync({ cmd: ["git", "-C", dir, "add", "-A"], timeout: 10000 });
			Bun.spawnSync({ cmd: ["git", "-C", dir, "commit", "-qm", "feature"], timeout: 10000 });

			expect(entryGuard(input, cfg).out).toBe("");
		});

		test("leaves a deep session to the run guard", () => {
			const { cfg, input } = movedSession("v6", "deep");

			expect(entryGuard(input, cfg).out).toBe("");
		});

		test("reads the last route: a fast session rerouted to deep is not refused", () => {
			const { cfg, input } = movedSession("v7", "fast", "deep");

			expect(entryGuard(input, cfg).out).toBe("");
		});

		test("does not refuse a session whose tree did not move", () => {
			const cfg = configDir();
			const dir = gitRepo();
			writeFileSync(join(dir, "pre-existing.ts"), "export const y = 2;\n");
			stamp(cfg, "v8", dir);

			const r = entryGuard(
				{ cwd: dir, session_id: "v8", transcript_path: routedTranscript("fast"), stop_hook_active: false },
				cfg,
			);
			expect(r.out).toBe("");
		});

		test("lets the stop through once a stop hook already fired this turn", () => {
			const { cfg, input } = movedSession("v9", "fast");

			expect(entryGuard({ ...input, stop_hook_active: true }, cfg).out).toBe("");
		});
	});

	// A test edited to agree with new code proves nothing about it. The gate
	// refuses a handback carrying such an edit until each changed test has a
	// record at its current content, made by status.sh tests-changed.
	describe("test gate", () => {
		const ORIGINAL = 'test("adds", () => {\n\texpect(add(1, 2)).toBe(3);\n});\n';

		/** A transcript with one route call. Deep keeps the verify gate out of
		 * the way, and with no run.json the run guard stays out too. */
		function routed(channel: string): string {
			const path = join(mkdtempSync(join(tmpdir(), "sluice-tx-")), "s.jsonl");
			writeFileSync(
				path,
				`${JSON.stringify({
					type: "assistant",
					message: {
						role: "assistant",
						content: [{ type: "tool_use", name: "Bash", input: { command: `bash status.sh route ${channel}` } }],
					},
				})}\n`,
			);
			return path;
		}

		function repoWithTest(): string {
			const dir = gitRepo();
			mkdirSync(join(dir, "tests"));
			writeFileSync(join(dir, "tests", "add.test.ts"), ORIGINAL);
			Bun.spawnSync({ cmd: ["git", "-C", dir, "add", "-A"], timeout: 10000 });
			Bun.spawnSync({ cmd: ["git", "-C", dir, "commit", "-qm", "test"], timeout: 10000 });
			return dir;
		}

		/** A repo with one committed test file, stamped at session start. */
		function session(sid: string) {
			const cfg = configDir();
			const dir = repoWithTest();
			stamp(cfg, sid, dir);
			const stampPath = join(cfg, "sluice", "stamps", sid);
			const base = readFileSync(stampPath, "utf8").split("\n")[2];
			const input = { cwd: dir, session_id: sid, transcript_path: routed("deep"), stop_hook_active: false };
			return { cfg, dir, base, stampPath, input };
		}

		function weaken(dir: string) {
			writeFileSync(join(dir, "tests", "add.test.ts"), 'test("adds", () => {\n\texpect(add(1, 2)).toBeDefined();\n});\n');
		}

		function recordNone(dir: string, base: string) {
			return Bun.spawnSync({
				cmd: [
					"bash", STATUS, "tests-changed", "--dir", dir, "--base", base,
					"--because", "add returned 3", "--none", "the old add is gone",
				],
				timeout: 10000,
			});
		}

		test("refuses an edited existing test with no record", () => {
			const { cfg, dir, input } = session("t1");
			weaken(dir);

			const r = entryGuard(input, cfg);
			expect(r.code).toBe(0);
			expect(decision(r.out)).toBe("block");
		});

		test("the refusal names the path, the base and both record forms", () => {
			const { cfg, dir, base, input } = session("t2");
			weaken(dir);

			const reason = JSON.parse(entryGuard(input, cfg).out).reason as string;
			expect(base).toMatch(/^[0-9a-f]{40}$/);
			expect(reason).toContain("tests/add.test.ts");
			expect(reason).toContain(base);
			expect(reason).toContain('status.sh tests-changed --because "');
			expect(reason).toMatch(/tests-changed --because "[^"]*" -- /);
			expect(reason).toMatch(/tests-changed --because "[^"]*" --none /);
		});

		test("lets a test recorded at its current content hand back", () => {
			const { cfg, dir, base, input } = session("t3");
			weaken(dir);
			expect(recordNone(dir, base).exitCode).toBe(0);

			expect(entryGuard(input, cfg).out).toBe("");
		});

		test("refuses a test edited again after its record", () => {
			const { cfg, dir, base, input } = session("t4");
			weaken(dir);
			expect(recordNone(dir, base).exitCode).toBe(0);
			writeFileSync(join(dir, "tests", "add.test.ts"), 'test("adds", () => {\n\texpect(1).toBe(1);\n});\n');

			expect(decision(entryGuard(input, cfg).out)).toBe("block");
		});

		test("lets a deleted test recorded as gone hand back", () => {
			const { cfg, dir, base, input } = session("t5");
			rmSync(join(dir, "tests", "add.test.ts"));
			expect(recordNone(dir, base).exitCode).toBe(0);

			expect(entryGuard(input, cfg).out).toBe("");
		});

		test("refuses a deleted test with no record", () => {
			const { cfg, dir, input } = session("t6");
			rmSync(join(dir, "tests", "add.test.ts"));

			expect(decision(entryGuard(input, cfg).out)).toBe("block");
		});

		test("lets an edit proved and a deletion recorded with --none hand back", () => {
			const cfg = configDir();
			const dir = repoWithTest();
			writeFileSync(join(dir, "tests", "old.test.ts"), 'test("old", () => {});\n');
			Bun.spawnSync({ cmd: ["git", "-C", dir, "add", "-A"], timeout: 10000 });
			Bun.spawnSync({ cmd: ["git", "-C", dir, "commit", "-qm", "old"], timeout: 10000 });
			stamp(cfg, "t15", dir);
			const base = readFileSync(join(cfg, "sluice", "stamps", "t15"), "utf8").split("\n")[2];
			weaken(dir);
			rmSync(join(dir, "tests", "old.test.ts"));

			// Red on the base, where the assertion was still exact.
			const proof = Bun.spawnSync({
				cmd: [
					"bash", STATUS, "tests-changed", "--dir", dir, "--base", base, "--because", "add returned 3",
					"--", "sh", "-c", "! grep -q toBeDefined tests/add.test.ts",
				],
				timeout: 10000,
			});
			expect(proof.exitCode).toBe(0);
			expect(recordNone(dir, base).exitCode).toBe(0);

			const input = { cwd: dir, session_id: "t15", transcript_path: routed("deep"), stop_hook_active: false };
			expect(entryGuard(input, cfg).out).toBe("");
		});

		/** A session over a tracked tests/fixture file, replaced by a directory, beside a weakened test. */
		function fixtureSplitSession(sid: string) {
			const cfg = configDir();
			const dir = repoWithTest();
			writeFileSync(join(dir, "tests", "fixture"), "{}\n");
			Bun.spawnSync({ cmd: ["git", "-C", dir, "add", "-A"], timeout: 10000 });
			Bun.spawnSync({ cmd: ["git", "-C", dir, "commit", "-qm", "fixture"], timeout: 10000 });
			stamp(cfg, sid, dir);
			const base = readFileSync(join(cfg, "sluice", "stamps", sid), "utf8").split("\n")[2];
			weaken(dir);
			rmSync(join(dir, "tests", "fixture"));
			mkdirSync(join(dir, "tests", "fixture"));
			writeFileSync(join(dir, "tests", "fixture", "one.json"), '{"split": 1}\n');
			const input = { cwd: dir, session_id: sid, transcript_path: routed("deep"), stop_hook_active: false };
			return { cfg, dir, base, input };
		}

		test("a test path replaced by a directory does not silence the gate for a weakened test", () => {
			const { cfg, input } = fixtureSplitSession("t17");

			const out = entryGuard(input, cfg).out;
			expect(decision(out)).toBe("block");
			expect(JSON.parse(out).reason).toContain("tests/add.test.ts");
		});

		test("a proved edit beside a test path replaced by a directory and recorded with --none hands back", () => {
			const { cfg, dir, base, input } = fixtureSplitSession("t18");
			const proof = Bun.spawnSync({
				cmd: [
					"bash", STATUS, "tests-changed", "--dir", dir, "--base", base, "--because", "add returned 3",
					"--", "sh", "-c", "! grep -q toBeDefined tests/add.test.ts",
				],
				timeout: 10000,
			});
			expect(proof.exitCode).toBe(0);
			expect(recordNone(dir, base).exitCode).toBe(0);

			expect(entryGuard(input, cfg).out).toBe("");
		});

		// Root reads a mode-000 file anyway, so there is no unreadable file to make
		// as root. A plain unreadable file stops the classifier too, and the gate
		// rightly stays silent on a tree it cannot read; the hash is reached only
		// when git trusts the index entry and never rereads the file. A staged
		// edit with core.trustctime off is that case: the chmod leaves the stat
		// data git compares untouched. The mtime is set back before staging so
		// the entry is not racily clean, which git would reread regardless.
		test.skipIf(process.getuid?.() === 0)("an unreadable flagged test does not silence the gate for the others", () => {
			const cfg = configDir();
			const dir = repoWithTest();
			writeFileSync(join(dir, "tests", "locked.test.ts"), ORIGINAL);
			Bun.spawnSync({ cmd: ["git", "-C", dir, "add", "-A"], timeout: 10000 });
			Bun.spawnSync({ cmd: ["git", "-C", dir, "commit", "-qm", "locked"], timeout: 10000 });
			Bun.spawnSync({ cmd: ["git", "-C", dir, "config", "core.trustctime", "false"], timeout: 10000 });
			stamp(cfg, "t19", dir);
			weaken(dir);
			writeFileSync(join(dir, "tests", "locked.test.ts"), 'test("adds", () => {});\n');
			utimesSync(join(dir, "tests", "locked.test.ts"), new Date(2020, 0, 1), new Date(2020, 0, 1));
			Bun.spawnSync({ cmd: ["git", "-C", dir, "add", "tests/locked.test.ts"], timeout: 10000 });
			chmodSync(join(dir, "tests", "locked.test.ts"), 0o000);

			const input = { cwd: dir, session_id: "t19", transcript_path: routed("deep"), stop_hook_active: false };
			const out = entryGuard(input, cfg).out;
			chmodSync(join(dir, "tests", "locked.test.ts"), 0o644);
			expect(decision(out)).toBe("block");
			const reason = JSON.parse(out).reason as string;
			expect(reason).toContain("tests/add.test.ts");
			expect(reason).toContain("tests/locked.test.ts (cannot be read)");
		});

		test("the refusal says a node suite usually needs --with node_modules", () => {
			const { cfg, dir, input } = session("t16");
			weaken(dir);

			const reason = JSON.parse(entryGuard(input, cfg).out).reason as string;
			expect(reason).toContain("--with node_modules");
		});

		test("lets a new test file hand back with no record", () => {
			const { cfg, dir, input } = session("t7");
			writeFileSync(join(dir, "tests", "sub.test.ts"), 'test("subs", () => {\n\texpect(sub(3, 2)).toBe(1);\n});\n');

			expect(entryGuard(input, cfg).out).toBe("");
		});

		test("stays silent when the stamp holds no base", () => {
			const { cfg, dir, stampPath, input } = session("t8");
			const lines = readFileSync(stampPath, "utf8").split("\n");
			writeFileSync(stampPath, `${lines[0]}\n${lines[1]}\n`);
			weaken(dir);

			expect(entryGuard(input, cfg).out).toBe("");
		});

		// gc can prune the unreachable base commit out from under the stamp.
		test("stays silent when the stamp's base no longer resolves", () => {
			const { cfg, dir, stampPath, input } = session("t9");
			const lines = readFileSync(stampPath, "utf8").split("\n");
			writeFileSync(stampPath, `${lines[0]}\n${lines[1]}\n${"0123456789".repeat(4)}\n`);
			weaken(dir);

			expect(entryGuard(input, cfg).out).toBe("");
		});

		test("lets the stop through once a stop hook already fired this turn", () => {
			const { cfg, dir, input } = session("t10");
			weaken(dir);

			expect(entryGuard({ ...input, stop_hook_active: true }, cfg).out).toBe("");
		});

		// A session opened on a tree already holding the edit made none of it.
		test("stays silent when the tree has not moved this session", () => {
			const cfg = configDir();
			const dir = repoWithTest();
			weaken(dir);
			stamp(cfg, "t11", dir);

			const r = entryGuard(
				{ cwd: dir, session_id: "t11", transcript_path: routed("deep"), stop_hook_active: false },
				cfg,
			);
			expect(r.out).toBe("");
		});

		// One refusal per attempt: the verify gate speaks first, and the test
		// gate waits for the next attempt rather than piling on a second reason.
		test("says nothing while the verify gate is refusing", () => {
			const { cfg, dir, input } = session("t12");
			weaken(dir);

			const reason = JSON.parse(entryGuard({ ...input, transcript_path: routed("fast") }, cfg).out).reason as string;
			expect(reason).toContain("status.sh verify");
			expect(reason).not.toContain("tests-changed");
		});

		test("refuses a verified fast handback that carries an unrecorded test edit", () => {
			const { cfg, dir, input } = session("t13");
			weaken(dir);
			expect(Bun.spawnSync({ cmd: ["bash", STATUS, "verify", "--dir", dir, "--", "true"], timeout: 5000 }).exitCode).toBe(0);

			const reason = JSON.parse(entryGuard({ ...input, transcript_path: routed("fast") }, cfg).out).reason as string;
			expect(reason).toContain("tests-changed");
		});

		// The reason is printed by the harness, so a control byte in a path name
		// would reach a terminal as an instruction rather than as text.
		test("a test path with a control byte does not reach the refusal reason", () => {
			const { cfg, dir, input } = session("t14");
			writeFileSync(join(dir, "tests", `ev${String.fromCharCode(27)}il.test.ts`), 'test.skip("x", () => {});\n');

			const reason = JSON.parse(entryGuard(input, cfg).out).reason as string;
			expect(reason).toContain("evil.test.ts");
			expect(reason).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f]/);
		});
	});
});
