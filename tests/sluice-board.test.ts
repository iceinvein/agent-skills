import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const SCRIPTS = join(import.meta.dir, "..", "skills", "sluice", "scripts");
const BOARD = join(SCRIPTS, "board.sh");
const INDEX = join(SCRIPTS, "board-index.sh");
const STATUS = join(SCRIPTS, "status.sh");

// No session id: the suite may itself run inside a session, and status.sh
// follows that session to the runs it opened.
function env(root: string): Record<string, string | undefined> {
	const { CLAUDE_CODE_SESSION_ID: _, ...rest } = process.env;
	return { ...rest, SLUICE_BOARD_DIR: root };
}

function sh(root: string, script: string, args: string[]) {
	const proc = Bun.spawnSync({ cmd: ["bash", script, ...args], env: env(root), timeout: 5000 });
	return { code: proc.exitCode, out: proc.stdout.toString(), err: proc.stderr.toString() };
}

function board(root: string, ...args: string[]) {
	return sh(root, BOARD, args);
}

function index(root: string, ...args: string[]) {
	const r = sh(root, INDEX, args);
	if (r.code !== 0) throw new Error(`board-index.sh ${args.join(" ")}: ${r.err}`);
}

function status(dir: string, ...args: string[]) {
	const r = sh(dir, STATUS, [...args, "--dir", dir]);
	if (r.code !== 0) throw new Error(`status.sh ${args.join(" ")}: ${r.err}`);
}

function boardDir(): string {
	return mkdtempSync(join(tmpdir(), "sluice-board-"));
}

/** A git repo holding a live run, its pointer added to the index. */
function liveRun(root: string, opts: { session?: string; task?: string } = {}): string {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "sluice-board-run-")));
	Bun.spawnSync({ cmd: ["git", "init", "-q", dir] });
	const init = ["init", "--topic", "widget", "--channel", "deep"];
	if (opts.session) init.push("--session", opts.session);
	status(dir, ...init);
	if (opts.task) status(dir, "task", "1", "--name", "T1", "--status", opts.task);
	index(root, "run-add", dir);
	return dir;
}

function backdate(root: string, id: string, stamp: string) {
	const path = join(root, "sessions", `${id}.json`);
	const entry = JSON.parse(readFileSync(path, "utf8"));
	entry.updated = stamp;
	entry.routed = stamp;
	writeFileSync(path, JSON.stringify(entry, null, 2));
}

const CLOCK = / {2}\d\d:\d\d:\d\d$/;

describe("board.sh header", () => {
	test("an empty index prints nothing running", () => {
		const r = board(boardDir());
		expect(r.code).toBe(0);
		expect(r.out.split("\n")[0]).toMatch(/^sluice · nothing running {2}\d\d:\d\d:\d\d$/);
	});

	test("two runs and a fast working session are counted", () => {
		const root = boardDir();
		liveRun(root);
		liveRun(root);
		index(root, "session", "f1", "fast", "/somewhere/app");
		const head = board(root).out.split("\n")[0];
		expect(head.replace(CLOCK, "")).toBe("sluice · 2 deep · 1 fast working");
	});
});

describe("board.sh runs", () => {
	test("a pointer to a tree whose run was closed is not drawn", () => {
		const root = boardDir();
		const dir = liveRun(root);
		status(dir, "close");
		const r = board(root);
		expect(r.out).not.toContain(basename(dir));
		expect(r.out.split("\n")[0].replace(CLOCK, "")).toBe("sluice · nothing running");
	});

	test("two pointers to one tree draw it once", () => {
		const root = boardDir();
		const dir = liveRun(root);
		writeFileSync(join(root, "runs", "duplicate"), `${dir}\n`);
		const r = board(root);
		expect(r.out.split(`${basename(dir)}  `).length - 1).toBe(1);
		expect(r.out.split("\n")[0].replace(CLOCK, "")).toBe("sluice · 1 deep");
	});

	test("a run with a blocked task is drawn before one with an active task", () => {
		const root = boardDir();
		const blocked = liveRun(root, { task: "blocked" });
		const active = liveRun(root, { task: "active" });
		const out = board(root).out;
		expect(out.indexOf(basename(blocked))).toBeGreaterThan(-1);
		expect(out.indexOf(basename(blocked))).toBeLessThan(out.indexOf(basename(active)));
	});

	test("a run draws its name, its path and its status line", () => {
		const root = boardDir();
		const dir = liveRun(root, { task: "active" });
		const lines = board(root).out.split("\n");
		const at = lines.indexOf(`${basename(dir)}  ${dir}`);
		expect(at).toBe(2);
		expect(lines[1]).toBe("");
		expect(lines[at + 1]).toContain("deep · widget");
	});
});

describe("board.sh sessions", () => {
	test("a handed-back main session shows handed back", () => {
		const root = boardDir();
		index(root, "session", "m1", "main", "/work/shop");
		index(root, "handback", "m1");
		const out = board(root).out;
		expect(out).toContain("main  shop  handed back  0m ago");
		expect(out.split("\n")[0].replace(CLOCK, "")).toBe("sluice · 1 main handed back");
	});

	test("a working session shows its age with a clock", () => {
		const root = boardDir();
		index(root, "session", "f1", "fast", "/work/shop");
		expect(board(root).out).toContain("fast  shop  working  ◷ 0m");
	});

	test("an age past an hour shows hours and minutes", () => {
		const root = boardDir();
		index(root, "session", "f1", "fast", "/work/shop");
		const stamp = new Date(Date.now() - (2 * 3600 + 5 * 60 + 10) * 1000).toISOString().replace(/\.\d+Z$/, "Z");
		backdate(root, "f1", stamp);
		expect(board(root).out).toContain("fast  shop  working  ◷ 2h5m");
	});

	test("a deep session whose id is a drawn run's session is not listed", () => {
		const root = boardDir();
		const dir = liveRun(root, { session: "d1" });
		index(root, "session", "d1", "deep", dir);
		const out = board(root).out;
		expect(out).not.toContain("working");
		expect(out.split("\n")[0].replace(CLOCK, "")).toBe("sluice · 1 deep");
	});

	test("a session entry updated two days ago is not listed", () => {
		const root = boardDir();
		index(root, "session", "old", "fast", "/work/stale");
		backdate(root, "old", new Date(Date.now() - 2 * 86400 * 1000).toISOString().replace(/\.\d+Z$/, "Z"));
		const out = board(root).out;
		expect(out).not.toContain("stale");
		expect(out.split("\n")[0].replace(CLOCK, "")).toBe("sluice · nothing running");
	});

	test("a session tree path carrying an escape draws without the escape byte", () => {
		const root = boardDir();
		index(root, "session", "e1", "fast", "/work/evil\u001b[2Jname");
		const out = board(root).out;
		expect(out).not.toContain("\u001b");
		expect(out).toContain("fast  evil[2Jname  working");
	});
});

describe("board.sh output", () => {
	test("--json counts match the seeded index", () => {
		const root = boardDir();
		const dir = liveRun(root, { session: "d1" });
		index(root, "session", "d1", "deep", dir);
		index(root, "session", "d2", "deep", "/work/other");
		index(root, "session", "f1", "fast", "/work/a");
		index(root, "session", "f2", "fast", "/work/b");
		index(root, "handback", "f2");
		index(root, "session", "m1", "main", "/work/c");
		index(root, "handback", "m1");
		const r = board(root, "--json");
		expect(r.code).toBe(0);
		const state = JSON.parse(r.out);
		expect(state.counts).toEqual({
			runs: 1,
			working: { fast: 1, main: 0, deep: 1 },
			handed_back: { fast: 1, main: 1, deep: 0 },
		});
		expect(state.runs.map((x: { tree: string }) => x.tree)).toEqual([dir]);
		expect(state.runs[0].run.topic).toBe("widget");
		expect(state.sessions.map((s: { session: string }) => s.session).sort()).toEqual(["d2", "f1", "f2", "m1"]);
	});

	test("output piped to a caller carries no escape sequence", () => {
		const root = boardDir();
		liveRun(root, { task: "blocked" });
		index(root, "session", "f1", "fast", "/work/a");
		const r = board(root);
		expect(r.out).toContain("widget");
		expect(r.out).not.toContain("\u001b[");
	});

	test("--watch 0 exits 4", () => {
		expect(board(boardDir(), "--watch", "0").code).toBe(4);
	});

	test("--watch with --json exits 4", () => {
		expect(board(boardDir(), "--watch", "--json").code).toBe(4);
	});
});

describe("board.sh --watch", () => {
	test("redraws from home, clears the screen only once and restores the cursor", async () => {
		// Ended by the timeout's SIGTERM, which is how a watcher is always stopped.
		// Spawned async because spawnSync discards what is written after its
		// timeout fires, which is exactly the cursor restore under test.
		const proc = Bun.spawn({ cmd: ["bash", BOARD, "--watch", "1"], env: env(boardDir()), timeout: 2500, stdout: "pipe" });
		const out = await new Response(proc.stdout).text();
		await proc.exited;
		expect(out.split("\u001b[H").length - 1).toBeGreaterThanOrEqual(2);
		expect(out.indexOf("\u001b[2J")).toBeLessThan(out.indexOf("\u001b[H"));
		expect(out.split("\u001b[2J").length - 1).toBe(1);
		expect(out.endsWith("\u001b[?25h")).toBe(true);
	});
});
