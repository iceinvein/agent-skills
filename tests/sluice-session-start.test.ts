import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPTS = join(import.meta.dir, "..", "skills", "sluice", "scripts");
const HOOK = join(SCRIPTS, "session-start.sh");
const STATUS = join(SCRIPTS, "status.sh");

function repo(): string {
	return mkdtempSync(join(tmpdir(), "sluice-hook-"));
}

function status(dir: string, ...args: string[]) {
	return Bun.spawnSync({ cmd: ["bash", STATUS, ...args, "--dir", dir], timeout: 5000 });
}

/** Runs the hook the way the harness does: the session JSON on stdin. */
function hook(input: Record<string, unknown>, cwd?: string) {
	const proc = Bun.spawnSync({
		cmd: ["bash", HOOK],
		stdin: new TextEncoder().encode(JSON.stringify(input)),
		cwd: cwd ?? tmpdir(),
		timeout: 5000,
	});
	return { code: proc.exitCode, out: proc.stdout.toString(), err: proc.stderr.toString() };
}

// The hook fires on every session start, so its common case is a tree with no
// run at all, and there it has to cost nothing and print nothing.
describe("session-start.sh", () => {
	test("parses under bash -n", () => {
		const proc = Bun.spawnSync(["bash", "-n", HOOK]);
		expect(proc.stderr.toString()).toBe("");
		expect(proc.exitCode).toBe(0);
	});

	test("prints nothing when the tree has no run", () => {
		const r = hook({ cwd: repo(), source: "startup" });
		expect(r.code).toBe(0);
		expect(r.out).toBe("");
	});

	test("shows the live run in the tree the session opened in", () => {
		const dir = repo();
		status(dir, "init", "--topic", "widget", "--channel", "deep");
		status(dir, "task", "1", "--name", "first", "--status", "active");
		const r = hook({ cwd: dir, source: "startup" });
		expect(r.code).toBe(0);
		expect(r.out).toContain("widget");
		expect(r.out).toContain("first");
		expect(r.out).toMatch(/live/i);
	});

	test("after a compaction it also says to read the record before dispatching", () => {
		const dir = repo();
		status(dir, "init", "--topic", "widget", "--channel", "deep");
		const r = hook({ cwd: dir, source: "compact" });
		expect(r.out).toMatch(/read the run record/i);
	});

	test("on a fresh start it says the run may be stale rather than assuming it is yours", () => {
		const dir = repo();
		status(dir, "init", "--topic", "widget", "--channel", "deep");
		const r = hook({ cwd: dir, source: "startup" });
		expect(r.out).toMatch(/close/i);
	});

	// status.sh finds the run by anchoring on the git main worktree, so a
	// session opened in a package directory of a repo still sees it.
	test("a session opened in a subdirectory of the tree is shown the run", () => {
		const dir = repo();
		Bun.spawnSync({ cmd: ["git", "-C", dir, "init", "-q"], timeout: 10000 });
		status(dir, "init", "--topic", "widget", "--channel", "deep");
		mkdirSync(join(dir, "packages", "app"), { recursive: true });
		const r = hook({ cwd: join(dir, "packages", "app"), source: "startup" });
		expect(r.out).toContain("widget");
	});

	test("after a clear the context is gone too, so it says to read the record", () => {
		const dir = repo();
		status(dir, "init", "--topic", "widget", "--channel", "deep");
		expect(hook({ cwd: dir, source: "clear" }).out).toMatch(/read the run record/i);
	});

	test("returns when stdin is held open with nothing on it", async () => {
		const dir = repo();
		status(dir, "init", "--topic", "widget", "--channel", "deep");
		const proc = Bun.spawn({ cmd: ["bash", HOOK], stdin: "pipe", stdout: "pipe", cwd: dir });
		const timer = new Promise<string>((resolve) => setTimeout(() => resolve("timeout"), 8000));
		const result = await Promise.race([proc.exited.then(() => "exited"), timer]);
		proc.kill();
		expect(result).toBe("exited");
	});

	test("keeps the JSON when stdin is held open after it, on any bash", async () => {
		const dir = repo();
		status(dir, "init", "--topic", "widget", "--channel", "deep");
		const proc = Bun.spawn({ cmd: ["bash", HOOK], stdin: "pipe", stdout: "pipe", cwd: tmpdir() });
		proc.stdin.write(JSON.stringify({ cwd: dir, source: "startup" }));
		proc.stdin.flush();
		const timer = new Promise<string>((resolve) => setTimeout(() => resolve("timeout"), 8000));
		const result = await Promise.race([proc.exited.then(() => "exited"), timer]);
		const out = await new Response(proc.stdout).text();
		proc.kill();
		expect(result).toBe("exited");
		expect(out).toContain("widget");
	});

	test("a worktree with its own run is shown that run, not the main tree's", () => {
		const main = repo();
		const git = (...args: string[]) => Bun.spawnSync({ cmd: ["git", "-C", main, ...args], timeout: 10000 });
		git("init", "-q");
		git("config", "user.email", "t@example.com");
		git("config", "user.name", "t");
		writeFileSync(join(main, "README.md"), "hi\n");
		git("add", "-A");
		git("commit", "-qm", "init");
		const wt = join(mkdtempSync(join(tmpdir(), "sluice-wt-")), "impl");
		git("worktree", "add", "-q", wt, "-b", "impl");
		status(main, "init", "--topic", "widget", "--channel", "deep");
		status(wt, "init", "--topic", "gadget", "--channel", "fast");
		const out = hook({ cwd: wt, source: "startup" }).out;
		expect(out).toContain("gadget");
		expect(out).not.toContain("widget");
	});

	test("falls back to the working directory when stdin carries no cwd", () => {
		const dir = repo();
		status(dir, "init", "--topic", "widget", "--channel", "deep");
		const r = hook({}, dir);
		expect(r.out).toContain("widget");
	});

	test("stays silent and exits 0 on unreadable state", () => {
		const dir = repo();
		status(dir, "init", "--topic", "widget", "--channel", "deep");
		writeFileSync(join(dir, ".sluice", "run.json"), "{ truncated");
		const r = hook({ cwd: dir, source: "startup" });
		expect(r.code).toBe(0);
		expect(r.out).toBe("");
	});
});

// The stop guard's entry check compares the tree against where it stood when
// the session opened. Only this hook runs at that moment, so the baseline is
// taken here or not at all.
describe("session-start.sh baseline stamp", () => {
	function gitRepo(): string {
		const dir = mkdtempSync(join(tmpdir(), "sluice-stamp-"));
		const git = (...args: string[]) => Bun.spawnSync({ cmd: ["git", "-C", dir, ...args], timeout: 10000 });
		git("init", "-q");
		git("config", "user.email", "t@example.com");
		git("config", "user.name", "t");
		writeFileSync(join(dir, "README.md"), "hi\n");
		git("add", "-A");
		git("commit", "-qm", "init");
		return dir;
	}

	function stampedHook(input: Record<string, unknown>, cfg: string) {
		const proc = Bun.spawnSync({
			cmd: ["bash", HOOK],
			stdin: new TextEncoder().encode(JSON.stringify(input)),
			cwd: tmpdir(),
			env: { ...process.env, CLAUDE_CONFIG_DIR: cfg },
			timeout: 5000,
		});
		return { code: proc.exitCode, out: proc.stdout.toString() };
	}

	function stampPath(cfg: string, sid: string) {
		return join(cfg, "sluice", "stamps", sid);
	}

	test("records the tree and a digest for the session that opened", () => {
		const cfg = mkdtempSync(join(tmpdir(), "sluice-cfg-"));
		const dir = gitRepo();
		const r = stampedHook({ cwd: dir, session_id: "abc", source: "startup" }, cfg);

		expect(r.code).toBe(0);
		expect(existsSync(stampPath(cfg, "abc"))).toBe(true);
		const [tree, digest] = readFileSync(stampPath(cfg, "abc"), "utf8").trim().split("\n");
		// git resolves symlinks, and on macOS the temp dir is one.
		const top = Bun.spawnSync({ cmd: ["git", "-C", dir, "rev-parse", "--show-toplevel"] })
			.stdout.toString().trim();
		expect(tree).toBe(top);
		expect(digest).not.toBe("");
	});

	test("a tree that is already dirty is what the baseline records", () => {
		const cfg = mkdtempSync(join(tmpdir(), "sluice-cfg-"));
		const dir = gitRepo();
		writeFileSync(join(dir, "wip.ts"), "export const y = 2;\n");
		stampedHook({ cwd: dir, session_id: "def", source: "startup" }, cfg);

		const clean = mkdtempSync(join(tmpdir(), "sluice-cfg-"));
		const other = gitRepo();
		stampedHook({ cwd: other, session_id: "ghi", source: "startup" }, clean);

		const dirty = readFileSync(stampPath(cfg, "def"), "utf8").trim().split("\n")[1];
		const pristine = readFileSync(stampPath(clean, "ghi"), "utf8").trim().split("\n")[1];
		expect(dirty).not.toBe(pristine);
	});

	test("writes no stamp outside a git tree", () => {
		const cfg = mkdtempSync(join(tmpdir(), "sluice-cfg-"));
		const r = stampedHook({ cwd: repo(), session_id: "jkl", source: "startup" }, cfg);
		expect(r.code).toBe(0);
		expect(existsSync(stampPath(cfg, "jkl"))).toBe(false);
	});

	test("writes no stamp when the harness names no session", () => {
		const cfg = mkdtempSync(join(tmpdir(), "sluice-cfg-"));
		const r = stampedHook({ cwd: gitRepo(), source: "startup" }, cfg);
		expect(r.code).toBe(0);
		expect(existsSync(join(cfg, "sluice", "stamps"))).toBe(false);
	});

	// `compact` and `resume` both re-fire with the session's own id, and they
	// are not the same event. A compact happens inside a session that never
	// stopped holding the tree; a resume reopens one that was closed, and
	// whatever happened to the tree in between belongs to nobody.
	test("a resume takes a fresh baseline, a compact keeps the first", () => {
		const cfg = mkdtempSync(join(tmpdir(), "sluice-cfg-"));
		const dir = gitRepo();
		stampedHook({ cwd: dir, session_id: "res", source: "startup" }, cfg);
		const first = readFileSync(stampPath(cfg, "res"), "utf8");

		writeFileSync(join(dir, "changed.ts"), "export const x = 1;\n");
		stampedHook({ cwd: dir, session_id: "res", source: "compact" }, cfg);
		expect(readFileSync(stampPath(cfg, "res"), "utf8")).toBe(first);

		stampedHook({ cwd: dir, session_id: "res", source: "resume" }, cfg);
		expect(readFileSync(stampPath(cfg, "res"), "utf8")).not.toBe(first);
	});

	test("a resume clears the nudge the previous sitting already spent", () => {
		const cfg = mkdtempSync(join(tmpdir(), "sluice-cfg-"));
		const dir = gitRepo();
		stampedHook({ cwd: dir, session_id: "res2", source: "startup" }, cfg);
		mkdirSync(join(cfg, "sluice", "nudged"), { recursive: true });
		writeFileSync(join(cfg, "sluice", "nudged", "res2"), "");

		stampedHook({ cwd: dir, session_id: "res2", source: "resume" }, cfg);
		expect(existsSync(join(cfg, "sluice", "nudged", "res2"))).toBe(false);
	});

	// The hook still has its own job, and stamping must not disturb it.
	test("still prints a live run alongside the stamp", () => {
		const cfg = mkdtempSync(join(tmpdir(), "sluice-cfg-"));
		const dir = gitRepo();
		status(dir, "init", "--topic", "widget", "--channel", "deep");
		const r = stampedHook({ cwd: dir, session_id: "mno", source: "startup" }, cfg);

		expect(r.out).toMatch(/widget/);
		expect(existsSync(stampPath(cfg, "mno"))).toBe(true);
	});
});
