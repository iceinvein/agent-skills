import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
	status(dir, "preflight", "--review", "tier 3", "--model", "all session", "--workspace", "shared tree");
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

	test("a run with an active task still in flight is blocked too", () => {
		const dir = midRun(5, 3);
		status(dir, "task", "4", "--status", "active");
		expect(decision(guard({ cwd: dir, stop_hook_active: false }).out)).toBe("block");
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
	function worktree(main: string): string {
		const path = join(mkdtempSync(join(tmpdir(), "sluice-wt-")), "impl");
		Bun.spawnSync({ cmd: ["git", "-C", main, "worktree", "add", "-q", path, "-b", "impl"], timeout: 10000 });
		return path;
	}
	function midRunIn(dir: string) {
		status(dir, "init", "--topic", "widget", "--channel", "deep");
		for (let i = 1; i <= 3; i++) status(dir, "task", String(i), "--name", `T${i}`, "--tier", "1");
		status(dir, "task", "1", "--status", "done");
		status(dir, "preflight", "--review", "x", "--model", "y", "--workspace", "z");
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
