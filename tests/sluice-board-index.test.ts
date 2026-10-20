import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "..", "skills", "sluice", "scripts", "board-index.sh");

function board(): string {
	return mkdtempSync(join(tmpdir(), "sluice-board-index-"));
}

function run(root: string, ...args: string[]) {
	const { CLAUDE_CODE_SESSION_ID: _, ...env } = process.env;
	const proc = Bun.spawnSync({ cmd: ["bash", SCRIPT, ...args], env: { ...env, SLUICE_BOARD_DIR: root }, timeout: 5000 });
	return { code: proc.exitCode, out: proc.stdout.toString(), err: proc.stderr.toString() };
}

function session(root: string, id: string) {
	return JSON.parse(readFileSync(join(root, "sessions", `${id}.json`), "utf8"));
}

const STAMP = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/;

describe("run-add and run-drop", () => {
	test("run-add writes the tree under its encoded key", () => {
		const root = board();
		expect(run(root, "run-add", "/a/b%c").code).toBe(0);
		expect(readFileSync(join(root, "runs", "%2Fa%2Fb%25c"), "utf8")).toBe("/a/b%c\n");
	});

	test("run-drop removes the pointer", () => {
		const root = board();
		run(root, "run-add", "/a/b");
		expect(run(root, "run-drop", "/a/b").code).toBe(0);
		expect(existsSync(join(root, "runs", "%2Fa%2Fb"))).toBe(false);
	});

	test("run-drop exits 0 when the pointer is already gone", () => {
		expect(run(board(), "run-drop", "/nowhere").code).toBe(0);
	});
});

describe("session", () => {
	test("writes a working entry for the session", () => {
		const root = board();
		expect(run(root, "session", "s1", "fast", "/t").code).toBe(0);
		const s = session(root, "s1");
		expect([s.session, s.channel, s.tree, s.state]).toEqual(["s1", "fast", "/t", "working"]);
		expect(s.routed).toMatch(STAMP);
		expect(s.updated).toMatch(STAMP);
	});

	test("a second call with another channel replaces the channel", () => {
		const root = board();
		run(root, "session", "s1", "fast", "/t");
		run(root, "session", "s1", "deep", "/t");
		expect(session(root, "s1").channel).toBe("deep");
	});

	test("rejects an id that climbs out of the directory", () => {
		const root = board();
		expect(run(root, "session", "../x", "fast", "/t").code).toBe(4);
		expect(existsSync(join(root, "x.json"))).toBe(false);
	});

	test("rejects an unknown channel", () => {
		const root = board();
		expect(run(root, "session", "s1", "bypass", "/t").code).toBe(4);
		expect(existsSync(join(root, "sessions", "s1.json"))).toBe(false);
	});
});

describe("handback", () => {
	test("flips a fast entry to handed back", () => {
		const root = board();
		run(root, "session", "s1", "fast", "/t");
		expect(run(root, "handback", "s1").code).toBe(0);
		expect(session(root, "s1").state).toBe("handed back");
	});

	test("leaves a deep entry unchanged", () => {
		const root = board();
		run(root, "session", "s1", "deep", "/t");
		const before = readFileSync(join(root, "sessions", "s1.json"), "utf8");
		expect(run(root, "handback", "s1").code).toBe(0);
		expect(readFileSync(join(root, "sessions", "s1.json"), "utf8")).toBe(before);
	});

	test("exits 0 for an unknown id and writes nothing", () => {
		const root = board();
		expect(run(root, "handback", "ghost").code).toBe(0);
		expect(existsSync(join(root, "sessions", "ghost.json"))).toBe(false);
	});
});

describe("prune", () => {
	test("removes a pointer to a tree with no run", () => {
		const root = board();
		const tree = mkdtempSync(join(tmpdir(), "sluice-tree-"));
		run(root, "run-add", tree);
		run(root, "prune");
		expect(readdirSync(join(root, "runs"))).toEqual([]);
	});

	test("keeps a pointer to a tree with a run", () => {
		const root = board();
		const tree = mkdtempSync(join(tmpdir(), "sluice-tree-"));
		mkdirSync(join(tree, ".sluice"));
		writeFileSync(join(tree, ".sluice", "run.json"), "{}");
		run(root, "run-add", tree);
		run(root, "prune");
		expect(readdirSync(join(root, "runs")).length).toBe(1);
	});

	test("removes a session last updated two days ago", () => {
		const root = board();
		mkdirSync(join(root, "sessions"));
		writeFileSync(join(root, "sessions", "old.json"), JSON.stringify({
			session: "old", channel: "fast", tree: "/t", routed: "2026-01-01T00:00:00Z", state: "working",
			updated: new Date(Date.now() - 2 * 86400 * 1000).toISOString().replace(/\.\d+Z$/, "Z"),
		}));
		expect(run(root, "prune").code).toBe(0);
		expect(existsSync(join(root, "sessions", "old.json"))).toBe(false);
	});

	test("keeps a session updated just now", () => {
		const root = board();
		run(root, "session", "s1", "fast", "/t");
		run(root, "prune");
		expect(existsSync(join(root, "sessions", "s1.json"))).toBe(true);
	});
});

describe("failed writes", () => {
	test("run-add exits 1 with only the contract message when runs cannot be created", () => {
		const root = board();
		writeFileSync(join(root, "runs"), "");
		const r = run(root, "run-add", "/x");
		expect(r.code).toBe(1);
		expect(r.err).toBe(`board-index.sh: could not write ${join(root, "runs", "%2Fx")}\n`);
	});

	test("session exits 1 with only the contract message when sessions cannot be created", () => {
		const root = board();
		writeFileSync(join(root, "sessions"), "");
		const r = run(root, "session", "s1", "fast", "/t");
		expect(r.code).toBe(1);
		expect(r.err).toBe(`board-index.sh: could not write ${join(root, "sessions", "s1.json")}\n`);
	});

	test("run-add exits 1 when the runs directory is read only", () => {
		const root = board();
		mkdirSync(join(root, "runs"), { mode: 0o555 });
		const r = run(root, "run-add", "/x");
		chmodSync(join(root, "runs"), 0o755);
		expect(r.code).toBe(1);
		expect(r.err).toBe(`board-index.sh: could not write ${join(root, "runs", "%2Fx")}\n`);
	});

	test("handback exits 1 when the sessions directory is read only", () => {
		const root = board();
		run(root, "session", "s2", "fast", "/t");
		chmodSync(join(root, "sessions"), 0o555);
		const r = run(root, "handback", "s2");
		chmodSync(join(root, "sessions"), 0o755);
		expect(r.code).toBe(1);
		expect(r.err).toBe(`board-index.sh: could not write ${join(root, "sessions", "s2.json")}\n`);
	});
});

test("run-add leaves exactly one entry visible in runs", () => {
	const root = board();
	run(root, "run-add", "/a");
	expect(readdirSync(join(root, "runs"))).toEqual(["%2Fa"]);
});

test("session leaves exactly one entry visible in sessions", () => {
	const root = board();
	run(root, "session", "s1", "fast", "/t");
	expect(readdirSync(join(root, "sessions"))).toEqual(["s1.json"]);
});

test("with no board dir, config dir or home, no verb writes anywhere", () => {
	const cwd = mkdtempSync(join(tmpdir(), "sluice-nohome-"));
	const unique = `nohome-${process.pid}-${Date.now()}`;
	const { CLAUDE_CODE_SESSION_ID: _, HOME: __, ...env } = process.env;
	const calls = [["run-add", `/${unique}`], ["session", unique, "fast", "/t"], ["handback", unique], ["prune"]];
	for (const args of calls) {
		const proc = Bun.spawnSync({
			cmd: ["env", "-u", "HOME", "bash", SCRIPT, ...args],
			env: { ...env, SLUICE_BOARD_DIR: "", CLAUDE_CONFIG_DIR: "" }, cwd, timeout: 5000,
		});
		expect(proc.exitCode).toBe(0);
	}
	expect(readdirSync(cwd)).toEqual([]);
	expect(existsSync(join("/.claude/sluice/board/runs", `%2F${unique}`))).toBe(false);
	expect(existsSync(join("/.claude/sluice/board/sessions", `${unique}.json`))).toBe(false);
});
