import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPTS = join(import.meta.dir, "..", "skills", "sluice", "scripts");
const BOARD = join(SCRIPTS, "board.sh");
const STATUS = join(SCRIPTS, "status.sh");
const INDEX = join(SCRIPTS, "board-index.sh");

// No session id: the suite may itself run inside a session, and status.sh
// would record that session to the board.
function env(root: string): Record<string, string | undefined> {
	const { CLAUDE_CODE_SESSION_ID: _, ...rest } = process.env;
	return { ...rest, SLUICE_BOARD_DIR: root };
}

function status(root: string, dir: string, ...args: string[]) {
	const proc = Bun.spawnSync({ cmd: ["bash", STATUS, ...args, "--dir", dir], env: env(root), timeout: 5000 });
	return { code: proc.exitCode, out: proc.stdout.toString(), err: proc.stderr.toString() };
}

function ok(root: string, dir: string, ...args: string[]) {
	const r = status(root, dir, ...args);
	if (r.code !== 0) throw new Error(`status.sh ${args.join(" ")}: ${r.err}`);
	return r;
}

type Board = {
	runs: { tree: string; run: { topic: string } }[];
	sessions: { session: string; channel: string; tree: string; state: string }[];
};

function board(root: string): Board {
	const proc = Bun.spawnSync({ cmd: ["bash", BOARD, "--json"], env: env(root), timeout: 5000 });
	if (proc.exitCode !== 0) throw new Error(`board.sh --json: ${proc.stderr.toString()}`);
	return JSON.parse(proc.stdout.toString());
}

function boardDir(): string {
	return mkdtempSync(join(tmpdir(), "sluice-wiring-board-"));
}

function repo(): string {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "sluice-wiring-repo-")));
	const git = (...args: string[]) => Bun.spawnSync({ cmd: ["git", "-C", dir, ...args], timeout: 10000 });
	git("init", "-q");
	git("config", "user.email", "t@example.com");
	git("config", "user.name", "t");
	writeFileSync(join(dir, "README.md"), "hi\n");
	git("add", "-A");
	git("commit", "-qm", "init");
	return dir;
}

test("init puts the run on the board", () => {
	const root = boardDir();
	const dir = repo();
	ok(root, dir, "init", "--topic", "widget", "--channel", "deep");
	const b = board(root);
	expect(b.runs.map((r) => [r.tree, r.run.topic])).toEqual([[dir, "widget"]]);
});

// The board skips a pointer whose tree holds no run, so the pointer file itself
// is what shows close dropped it. Added by hand so the test does not lean on init.
test("close takes the run off the board and drops its pointer", () => {
	const root = boardDir();
	const dir = repo();
	Bun.spawnSync({ cmd: ["bash", INDEX, "run-add", dir], env: env(root), timeout: 5000 });
	ok(root, dir, "init", "--topic", "widget", "--channel", "deep");
	ok(root, dir, "close");
	expect(board(root).runs).toEqual([]);
	expect(readdirSync(join(root, "runs"))).toEqual([]);
});

test("a moved run shows once, at the worktree it moved to", () => {
	const root = boardDir();
	const main = repo();
	const wt = join(realpathSync(mkdtempSync(join(tmpdir(), "sluice-wiring-wt-"))), "impl");
	Bun.spawnSync({ cmd: ["git", "-C", main, "worktree", "add", "-q", wt, "-b", "impl"], timeout: 10000 });
	ok(root, main, "init", "--topic", "widget", "--channel", "deep");
	ok(root, main, "move", "--to", wt);
	expect(board(root).runs.map((r) => r.tree)).toEqual([wt]);
});

test("a run whose pointer was lost reappears on its next write", () => {
	const root = boardDir();
	const dir = repo();
	ok(root, dir, "init", "--topic", "widget", "--channel", "deep");
	rmSync(join(root, "runs"), { recursive: true });
	expect(board(root).runs).toEqual([]);
	ok(root, dir, "task", "1", "--name", "T1", "--status", "active");
	expect(board(root).runs.map((r) => r.tree)).toEqual([dir]);
});

test("route with a session shows that session working at the repo's top level", () => {
	const root = boardDir();
	const dir = repo();
	const sub = join(dir, "pkg");
	mkdirSync(sub);
	const r = ok(root, sub, "route", "fast", "--session", "s1");
	expect(r.out).toBe("sluice: fast channel\n");
	expect(board(root).sessions.map((s) => [s.session, s.channel, s.tree, s.state])).toEqual([
		["s1", "fast", dir, "working"],
	]);
});

test("a second route for the same session replaces the first", () => {
	const root = boardDir();
	const dir = repo();
	ok(root, dir, "route", "fast", "--session", "s1");
	ok(root, dir, "route", "main", "--session", "s1");
	expect(board(root).sessions.map((s) => [s.session, s.channel])).toEqual([["s1", "main"]]);
});

test("route with no session id prints its line and records no session", () => {
	const root = boardDir();
	const dir = repo();
	const r = status(root, dir, "route", "fast");
	expect(r.code).toBe(0);
	expect(r.out).toBe("sluice: fast channel\n");
	const sessions = join(root, "sessions");
	expect(existsSync(sessions) ? readdirSync(sessions) : []).toEqual([]);
});

test("route still succeeds with its line when the board cannot be written", () => {
	const root = join(boardDir(), "not-a-dir");
	writeFileSync(root, "");
	const dir = repo();
	const r = status(root, dir, "route", "fast", "--session", "s1");
	expect(r.code).toBe(0);
	expect(r.out).toBe("sluice: fast channel\n");
	expect(r.err).toContain("status.sh: note:");
});

function oneNote(err: string) {
	const lines = err.split("\n").filter((l) => l !== "");
	expect(lines.length).toBe(1);
	expect(lines[0]).toStartWith("status.sh: note: board not updated: ");
}

test("a board that cannot be written costs route exactly one note line", () => {
	const root = join(boardDir(), "not-a-dir");
	writeFileSync(root, "");
	oneNote(status(root, repo(), "route", "fast", "--session", "s1").err);
});

test("a board that cannot be written costs close exactly one note line", () => {
	const root = join(boardDir(), "not-a-dir");
	writeFileSync(root, "");
	const dir = repo();
	status(root, dir, "init", "--topic", "widget", "--channel", "deep");
	const r = status(root, dir, "close");
	expect(r.code).toBe(0);
	oneNote(r.err);
});
