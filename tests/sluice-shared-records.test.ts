import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPTS = join(import.meta.dir, "..", "skills", "sluice", "scripts");
const GUARD = join(SCRIPTS, "stop-guard.sh");
const STATUS = join(SCRIPTS, "status.sh");
const ORIGINAL = 'test("adds", () => {\n\texpect(add(1, 2)).toBe(3);\n});\n';
const WEAK = 'test("adds", () => {\n\texpect(add(1, 2)).toBeDefined();\n});\n';

function git(dir: string, ...args: string[]) {
	return Bun.spawnSync({ cmd: ["git", "-C", dir, ...args], timeout: 10000 });
}

function gitRepo(): string {
	const dir = mkdtempSync(join(tmpdir(), "sluice-hunt-"));
	git(dir, "init", "-q");
	git(dir, "config", "user.email", "t@example.com");
	git(dir, "config", "user.name", "t");
	writeFileSync(join(dir, "README.md"), "hi\n");
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "init");
	return dir;
}

function configDir(): string {
	return mkdtempSync(join(tmpdir(), "sluice-cfg-"));
}

function stamp(cfg: string, sid: string, cwd: string) {
	Bun.spawnSync({
		cmd: ["bash", join(SCRIPTS, "session-start.sh")],
		stdin: new TextEncoder().encode(JSON.stringify({ cwd, session_id: sid, source: "startup" })),
		cwd: tmpdir(),
		env: { ...process.env, CLAUDE_CONFIG_DIR: cfg },
		timeout: 5000,
	});
}

function entryGuard(input: Record<string, unknown>, cfg: string) {
	const proc = Bun.spawnSync({
		cmd: ["bash", GUARD],
		stdin: new TextEncoder().encode(JSON.stringify(input)),
		cwd: tmpdir(),
		env: { ...process.env, CLAUDE_CONFIG_DIR: cfg },
		timeout: 10000,
	});
	return { code: proc.exitCode, out: proc.stdout.toString(), err: proc.stderr.toString() };
}

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

function decision(out: string): string | undefined {
	if (out.trim() === "") return undefined;
	return JSON.parse(out).decision;
}

function commitTest(dir: string, rel: string) {
	mkdirSync(join(dir, rel, ".."), { recursive: true });
	writeFileSync(join(dir, rel), ORIGINAL);
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "test");
}

function session(sid: string, dir: string, cwd = dir) {
	const cfg = configDir();
	stamp(cfg, sid, cwd);
	const base = readFileSync(join(cfg, "sluice", "stamps", sid), "utf8").split("\n")[2];
	const input = { cwd, session_id: sid, transcript_path: routed("deep"), stop_hook_active: false };
	return { cfg, base, input };
}

function recordNone(dir: string, base: string, why = "add returned 3") {
	return Bun.spawnSync({
		cmd: ["bash", STATUS, "tests-changed", "--dir", dir, "--base", base, "--because", why, "--none", "the old add is gone"],
		timeout: 10000,
	});
}

describe("shared tests-changed records (hunt)", () => {
	test("a record made in a worktree with a spaced path counts in the main tree after merge", () => {
		const dir = gitRepo();
		commitTest(dir, "my tests/add one.test.ts");
		const { cfg, base, input } = session("h1", dir);
		const wt = join(mkdtempSync(join(tmpdir(), "sluice wt ")), "feat ure");
		git(dir, "worktree", "add", "-q", "-b", "feature", wt);
		writeFileSync(join(wt, "my tests/add one.test.ts"), WEAK);
		git(wt, "commit", "-qam", "weaken");
		expect(recordNone(wt, base).exitCode).toBe(0);
		git(dir, "merge", "-q", "--no-ff", "-m", "merge", "feature");
		expect(entryGuard(input, cfg).out).toBe("");
	});

	test("a record made in the main tree of a bare repo's worktree counts in a sibling worktree", () => {
		const src = gitRepo();
		commitTest(src, "tests/add.test.ts");
		const bare = join(mkdtempSync(join(tmpdir(), "sluice-bare-")), "r.git");
		Bun.spawnSync({ cmd: ["git", "clone", "-q", "--bare", src, bare], timeout: 10000 });
		const a = join(mkdtempSync(join(tmpdir(), "sluice-wa-")), "a");
		const b = join(mkdtempSync(join(tmpdir(), "sluice-wb-")), "b");
		git(bare, "worktree", "add", "-q", "-b", "a", a);
		git(bare, "worktree", "add", "-q", "-b", "b", b);
		for (const d of [a, b]) {
			git(d, "config", "user.email", "t@example.com");
			git(d, "config", "user.name", "t");
		}
		const { cfg, base, input } = session("h2", b);
		writeFileSync(join(a, "tests/add.test.ts"), WEAK);
		git(a, "commit", "-qam", "weaken");
		expect(recordNone(a, base).exitCode).toBe(0);
		git(b, "merge", "-q", "--ff-only", "a");
		expect(entryGuard(input, cfg).out).toBe("");
	});

	test("a session whose cwd is a subdirectory sees a record made from a subdirectory of a worktree", () => {
		const dir = gitRepo();
		commitTest(dir, "pkg/tests/add.test.ts");
		const { cfg, base, input } = session("h3", dir, join(dir, "pkg"));
		const wt = join(mkdtempSync(join(tmpdir(), "sluice-wt-")), "feature");
		git(dir, "worktree", "add", "-q", "-b", "feature", wt);
		writeFileSync(join(wt, "pkg/tests/add.test.ts"), WEAK);
		git(wt, "commit", "-qam", "weaken");
		expect(recordNone(join(wt, "pkg"), base).exitCode).toBe(0);
		git(dir, "merge", "-q", "--no-ff", "-m", "merge", "feature");
		expect(entryGuard(input, cfg).out).toBe("");
	});

	test("a test edited after its record in a worktree is refused in the main tree", () => {
		const dir = gitRepo();
		commitTest(dir, "tests/add.test.ts");
		const { cfg, base, input } = session("h4", dir);
		const wt = join(mkdtempSync(join(tmpdir(), "sluice-wt-")), "feature");
		git(dir, "worktree", "add", "-q", "-b", "feature", wt);
		writeFileSync(join(wt, "tests/add.test.ts"), WEAK);
		expect(recordNone(wt, base).exitCode).toBe(0);
		writeFileSync(join(wt, "tests/add.test.ts"), 'test("adds", () => {});\n');
		git(wt, "commit", "-qam", "weaken");
		git(dir, "merge", "-q", "--no-ff", "-m", "merge", "feature");
		expect(decision(entryGuard(input, cfg).out)).toBe("block");
	});

	test("recording leaves both the worktree and the main tree clean", () => {
		const dir = gitRepo();
		commitTest(dir, "tests/add.test.ts");
		const { base } = session("h5", dir);
		const wt = join(mkdtempSync(join(tmpdir(), "sluice-wt-")), "feature");
		git(dir, "worktree", "add", "-q", "-b", "feature", wt);
		writeFileSync(join(wt, "tests/add.test.ts"), WEAK);
		git(wt, "commit", "-qam", "weaken");
		expect(recordNone(wt, base).exitCode).toBe(0);
		expect(git(wt, "status", "--porcelain", "--ignored").stdout.toString()).toBe("");
		expect(git(dir, "status", "--porcelain", "--ignored").stdout.toString()).toBe("");
		writeFileSync(join(dir, "tests/add.test.ts"), WEAK);
		expect(recordNone(dir, base).exitCode).toBe(0);
		expect(git(dir, "status", "--porcelain", "--ignored").stdout.toString()).toBe(" M tests/add.test.ts\n");
	});

	// Each worktree used to append to its own file; now every worktree of the
	// repo appends to one. A record of 20 tests with a long reason is ~20KB,
	// which bash's printf writes in several write(2) calls, so concurrent
	// appends interleave mid-line and tear records.
	test("records appended at once from several worktrees each still let their own worktree hand back", async () => {
		const dir = gitRepo();
		const files = Array.from({ length: 20 }, (_, i) => `tests/t${i}.test.ts`);
		for (const f of files) commitTest(dir, f);
		const trees = Array.from({ length: 6 }, (_, i) => {
			const wt = join(mkdtempSync(join(tmpdir(), "sluice-wt-")), `w${i}`);
			git(dir, "worktree", "add", "-q", "-b", `w${i}`, wt);
			const s = session(`h6-${i}`, wt);
			for (const f of files) writeFileSync(join(wt, f), `test("adds", () => {\n\texpect(add(1, 2)).toBeDefined(); // ${i}\n});\n`);
			return { wt, ...s };
		});
		const why = "x".repeat(800) + "add(1, 2) returned 3 under the old integer path; the new decimal path returns a Decimal, so the exact assertion no longer holds and the test now checks only that a value comes back from the call";
		const procs = trees.map(({ wt, base }) =>
			Bun.spawn({
				cmd: ["bash", STATUS, "tests-changed", "--dir", wt, "--base", base, "--because", why, "--none", "the old integer add is gone"],
			}),
		);
		expect(await Promise.all(procs.map((p) => p.exited))).toEqual([0, 0, 0, 0, 0, 0]);
		const refused = trees.filter(({ cfg, input }) => entryGuard(input, cfg).out !== "").map(({ wt }) => wt);
		expect(refused).toEqual([]);
	}, 60000);

	test("recording in the main tree creates no .sluice dir in it", () => {
		const dir = gitRepo();
		commitTest(dir, "tests/add.test.ts");
		const { base } = session("h7", dir);
		writeFileSync(join(dir, "tests/add.test.ts"), WEAK);
		expect(recordNone(dir, base).exitCode).toBe(0);
		expect(existsSync(join(dir, ".sluice"))).toBe(false);
	});
});
