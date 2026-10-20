import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
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

/** Rewrites fields of a run's state file directly, as a hand edit would. */
function editRun(dir: string, patch: Record<string, unknown>) {
	const path = join(dir, ".sluice", "run.json");
	writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, "utf8")), ...patch }, null, 2));
}

/** A tree whose state file holds `contents` verbatim, its pointer added to the index. */
function rawRun(root: string, contents: string, prefix = "sluice-board-raw-"): string {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
	mkdirSync(join(dir, ".sluice"));
	writeFileSync(join(dir, ".sluice", "run.json"), contents);
	index(root, "run-add", dir);
	return dir;
}

/** Writes a session entry by hand, fresh unless the fields say otherwise. */
function rawSession(root: string, id: string, fields: Record<string, unknown>) {
	const stamp = new Date().toISOString().replace(/\.\d+Z$/, "Z");
	mkdirSync(join(root, "sessions"), { recursive: true });
	const entry = { session: id, channel: "fast", tree: "/work/x", routed: stamp, state: "working", updated: stamp, ...fields };
	writeFileSync(join(root, "sessions", `${id}.json`), JSON.stringify(entry, null, 2));
}

function header(out: string): string {
	return out.split("\n")[0].replace(CLOCK, "");
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

	test("a main run counts as main working, not as deep", () => {
		const root = boardDir();
		rawRun(root, JSON.stringify({ schema: 1, topic: "t", channel: "main", started: "2026-01-01T00:00:00Z", tasks: [] }));
		expect(header(board(root).out)).toBe("sluice · 1 main working");
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

	test("a run tree named with a backslash draws the backslash once in its header", () => {
		const root = boardDir();
		const dir = join(realpathSync(mkdtempSync(join(tmpdir(), "sluice-board-run-"))), "a\\b");
		mkdirSync(dir);
		Bun.spawnSync({ cmd: ["git", "init", "-q", dir] });
		status(dir, "init", "--topic", "widget", "--channel", "deep");
		index(root, "run-add", dir);
		expect(board(root).out.split("\n")[2]).toBe(`a\\b  ${dir}`);
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

	test("a handed-back deep session is counted as deep handed back, not as deep", () => {
		const root = boardDir();
		index(root, "session", "d1", "deep", "/work/shop");
		index(root, "handback", "d1");
		expect(header(board(root).out)).toBe("sluice · 1 deep handed back");
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

	test("a main session whose id is a drawn run's session is not listed or counted again", () => {
		const root = boardDir();
		rawRun(root, JSON.stringify({ schema: 1, topic: "t", channel: "main", session: "m", started: "2026-01-01T00:00:00Z", tasks: [] }));
		index(root, "session", "m", "main", "/work/shop");
		const out = board(root).out;
		expect(header(out)).toBe("sluice · 1 main working");
		expect(out).not.toContain("shop");
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

	test("rows for trees of different lengths line up their age column", () => {
		const root = boardDir();
		index(root, "session", "f1", "fast", "/work/a");
		index(root, "session", "m1", "main", "/work/longer-name");
		const rows = board(root).out.split("\n").slice(2, 4).sort();
		expect(rows).toEqual(["fast  a            working  ◷ 0m", "main  longer-name  working  ◷ 0m"]);
	});

	test("a tree named with a multi-byte character lines up with an ASCII one", () => {
		const root = boardDir();
		index(root, "session", "f1", "fast", "/work/café");
		index(root, "session", "f2", "fast", "/work/shops");
		const rows = board(root).out.split("\n").slice(2, 4).sort();
		expect(rows).toEqual(["fast  café   working  ◷ 0m", "fast  shops  working  ◷ 0m"]);
	});

	test("a tree named with a multi-byte character lines up under the C locale", () => {
		const root = boardDir();
		index(root, "session", "f1", "fast", "/work/café");
		index(root, "session", "f2", "fast", "/work/shops");
		const proc = Bun.spawnSync({ cmd: ["bash", BOARD], env: { ...env(root), LC_ALL: "C", LANG: "C" }, timeout: 5000 });
		const rows = proc.stdout.toString().split("\n").slice(2, 4).sort();
		expect(rows).toEqual(["fast  café   working  ◷ 0m", "fast  shops  working  ◷ 0m"]);
	});

	test("a session tree named with a backslash draws the backslash once", () => {
		const root = boardDir();
		index(root, "session", "b1", "fast", "/work/a\\b");
		expect(board(root).out.split("\n")[2]).toStartWith("fast  a\\b  working");
	});
});

describe("board.sh ordering", () => {
	test("within a group the newest update is drawn first and runs with nothing active come last", () => {
		const root = boardDir();
		const idle = liveRun(root);
		const older = liveRun(root, { task: "active" });
		const newer = liveRun(root, { task: "review" });
		editRun(idle, { updated: "2026-01-03T00:00:00Z" });
		editRun(older, { updated: "2026-01-01T00:00:00Z" });
		editRun(newer, { updated: "2026-01-02T00:00:00Z" });
		const out = board(root).out;
		const at = [newer, older, idle].map((d) => out.indexOf(`${basename(d)}  `));
		expect(at[0]).toBeGreaterThan(-1);
		expect(at[0]).toBeLessThan(at[1]);
		expect(at[1]).toBeLessThan(at[2]);
	});
});

describe("board.sh entries it cannot read", () => {
	test("an empty pointer file is skipped", () => {
		const root = boardDir();
		const good = liveRun(root);
		writeFileSync(join(root, "runs", "empty"), "");
		const r = board(root);
		expect(r.code).toBe(0);
		expect(header(r.out)).toBe("sluice · 1 deep");
		expect(r.out).toContain(`${basename(good)}  `);
	});

	test("a pointer to a run that does not parse is skipped", () => {
		const root = boardDir();
		const good = liveRun(root);
		const bad = rawRun(root, "{ truncated");
		const r = board(root);
		expect(r.code).toBe(0);
		expect(header(r.out)).toBe("sluice · 1 deep");
		expect(r.out).toContain(`${basename(good)}  `);
		expect(r.out).not.toContain(basename(bad));
	});

	test("a run whose tasks are not objects is skipped", () => {
		const root = boardDir();
		const good = liveRun(root);
		const bad = liveRun(root);
		editRun(bad, { tasks: ["oops"] });
		const r = board(root);
		expect(r.code).toBe(0);
		expect(header(r.out)).toBe("sluice · 1 deep");
		expect(r.out).toContain(`${basename(good)}  `);
		expect(r.out).not.toContain(basename(bad));
	});

	test("--json leaves out a run whose tasks are not objects", () => {
		const root = boardDir();
		const good = liveRun(root);
		editRun(liveRun(root), { tasks: ["oops"] });
		const r = board(root, "--json");
		expect(r.code).toBe(0);
		expect(JSON.parse(r.out).runs.map((x: { tree: string }) => x.tree)).toEqual([good]);
	});

	test("a session file that does not parse is skipped", () => {
		const root = boardDir();
		index(root, "session", "f1", "fast", "/work/shop");
		writeFileSync(join(root, "sessions", "bad.json"), "{");
		const r = board(root);
		expect(r.code).toBe(0);
		expect(header(r.out)).toBe("sluice · 1 fast working");
		expect(r.out).toContain("fast  shop  working");
	});

	test("a session whose tree is not a string is skipped", () => {
		const root = boardDir();
		index(root, "session", "f1", "fast", "/work/shop");
		rawSession(root, "odd", { tree: 5 });
		const r = board(root);
		expect(r.code).toBe(0);
		expect(header(r.out)).toBe("sluice · 1 fast working");
		expect(r.out).toContain("fast  shop  working");
	});

	test("a session with no tree is skipped", () => {
		const root = boardDir();
		index(root, "session", "f1", "fast", "/work/shop");
		rawSession(root, "odd", { tree: undefined });
		const r = board(root);
		expect(header(r.out)).toBe("sluice · 1 fast working");
	});

	test("a session whose routed stamp does not parse is skipped", () => {
		const root = boardDir();
		index(root, "session", "f1", "fast", "/work/shop");
		rawSession(root, "odd", { routed: "garbage", tree: "/work/odd" });
		const r = board(root);
		expect(r.code).toBe(0);
		expect(header(r.out)).toBe("sluice · 1 fast working");
		expect(r.out).toContain("fast  shop  working");
		expect(r.out).not.toContain("odd");
	});

	test("a session in a state other than working or handed back is skipped", () => {
		const root = boardDir();
		index(root, "session", "f1", "fast", "/work/shop");
		rawSession(root, "odd", { state: "paused", tree: "/work/odd" });
		const r = board(root);
		expect(header(r.out)).toBe("sluice · 1 fast working");
		expect(r.out).not.toContain("odd");
	});

	test("a tree path carrying an escape draws without the escape byte", () => {
		const root = boardDir();
		const dir = rawRun(root, JSON.stringify({ schema: 1, topic: "t", channel: "deep", started: "2026-01-01T00:00:00Z", tasks: [] }), "evil\u001b[31m-");
		const r = board(root);
		expect(header(r.out)).toBe("sluice · 1 deep");
		expect(r.out).not.toContain("\u001b");
		expect(r.out).toContain(basename(dir).replace("\u001b", ""));
	});

	test("a run file past the argument size limit draws beside a normal run", () => {
		const root = boardDir();
		const normal = liveRun(root);
		const big = liveRun(root);
		// Past macOS's 1 MB argv total, so contents handed over as arguments fail.
		editRun(big, { padding: "x".repeat(1_200_000) });
		const r = board(root);
		expect(r.code).toBe(0);
		expect(header(r.out)).toBe("sluice · 2 deep");
		expect(r.out).toContain(`${basename(normal)}  `);
		expect(r.out).toContain(`${basename(big)}  `);
	});

	test("a board root that cannot be read exits 6", () => {
		const root = boardDir();
		index(root, "session", "f1", "fast", "/work/x");
		chmodSync(root, 0o000);
		const r = board(root);
		chmodSync(root, 0o755);
		expect(r).toEqual({ code: 6, out: "", err: "board.sh: could not read the board\n" });
	});

	test("a sessions directory that cannot be read exits 6", () => {
		const root = boardDir();
		index(root, "session", "f1", "fast", "/work/x");
		chmodSync(join(root, "sessions"), 0o000);
		const r = board(root);
		chmodSync(join(root, "sessions"), 0o755);
		expect(r).toEqual({ code: 6, out: "", err: "board.sh: could not read the board\n" });
	});

	test("a runs directory that cannot be read exits 6 for --json too", () => {
		const root = boardDir();
		liveRun(root);
		chmodSync(join(root, "runs"), 0o000);
		const r = board(root, "--json");
		chmodSync(join(root, "runs"), 0o755);
		expect(r).toEqual({ code: 6, out: "", err: "board.sh: could not read the board\n" });
	});

	test("a board root that is a regular file exits 6", () => {
		const root = join(boardDir(), "board");
		writeFileSync(root, "");
		expect(board(root)).toEqual({ code: 6, out: "", err: "board.sh: could not read the board\n" });
	});

	test("a board root that does not exist yet draws nothing running", () => {
		const r = board(join(boardDir(), "never-written"));
		expect(r.code).toBe(0);
		expect(header(r.out)).toBe("sluice · nothing running");
	});

	test("a tree path holding a newline is read whole", () => {
		const root = boardDir();
		const dir = rawRun(root, JSON.stringify({ schema: 1, topic: "t", channel: "deep", started: "2026-01-01T00:00:00Z", tasks: [] }), "two\nlines-");
		const r = board(root, "--json");
		expect(JSON.parse(r.out).runs.map((x: { tree: string }) => x.tree)).toEqual([dir]);
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
			working: { fast: 1, main: 0, deep: 2 },
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

	test("--watch 00 exits 4", () => {
		expect(board(boardDir(), "--watch", "00").code).toBe(4);
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
		// A newline before the clear scrolls a frame taller than the terminal.
		expect(out).not.toContain("\n\u001b[J");
	});

	test("an interval with a leading zero is read as decimal seconds", async () => {
		const proc = Bun.spawn({ cmd: ["bash", BOARD, "--watch", "08"], env: env(boardDir()), timeout: 1500, stdout: "pipe" });
		const out = await new Response(proc.stdout).text();
		await proc.exited;
		expect(out).toContain("sluice · nothing running");
	});
});
