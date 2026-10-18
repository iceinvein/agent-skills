import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const SCRIPT = join(import.meta.dir, "..", "skills", "sluice", "scripts", "test-changes.sh");

function git(dir: string, ...args: string[]): string {
	return Bun.spawnSync({ cmd: ["git", "-C", dir, ...args], timeout: 10000 }).stdout.toString();
}

function write(dir: string, path: string, content: string) {
	mkdirSync(dirname(join(dir, path)), { recursive: true });
	writeFileSync(join(dir, path), content);
}

// A repo whose base commit holds the given files; returns the dir and the
// base commit's sha.
function repoWith(files: Record<string, string>): { dir: string; base: string } {
	const dir = mkdtempSync(join(tmpdir(), "sluice-test-changes-"));
	git(dir, "init", "-q");
	git(dir, "config", "user.email", "t@example.com");
	git(dir, "config", "user.name", "t");
	write(dir, "README.md", "hi\n");
	for (const [path, content] of Object.entries(files)) write(dir, path, content);
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "base");
	return { dir, base: git(dir, "rev-parse", "HEAD").trim() };
}

function run(...args: string[]) {
	const proc = Bun.spawnSync({ cmd: ["bash", SCRIPT, ...args], timeout: 10000 });
	return { code: proc.exitCode, out: proc.stdout.toString() };
}

const SUITE = 'test("adds", () => {\n\texpect(add(1, 2)).toBe(3);\n});\n';

describe("test-changes.sh", () => {
	test("a new test file passes", () => {
		const { dir, base } = repoWith({});
		write(dir, "tests/a.test.ts", SUITE);
		expect(run(dir, base)).toEqual({ code: 0, out: "" });
	});

	test("pure additions to an existing test file pass", () => {
		const { dir, base } = repoWith({ "tests/a.test.ts": SUITE });
		write(dir, "tests/a.test.ts", SUITE + 'test("subtracts", () => {});\n');
		expect(run(dir, base)).toEqual({ code: 0, out: "" });
	});

	test("an edited line in a test file is flagged", () => {
		const { dir, base } = repoWith({ "tests/a.test.ts": SUITE });
		write(dir, "tests/a.test.ts", SUITE.replace("toBe(3)", "toBe(4)"));
		expect(run(dir, base)).toEqual({ code: 0, out: "tests/a.test.ts\n" });
	});

	test("a deleted test file is flagged", () => {
		const { dir, base } = repoWith({ "src/a.test.ts": SUITE });
		rmSync(join(dir, "src/a.test.ts"));
		expect(run(dir, base)).toEqual({ code: 0, out: "src/a.test.ts\n" });
	});

	test("an added it.skip line is flagged even as a pure addition", () => {
		const { dir, base } = repoWith({ "tests/a.test.ts": SUITE });
		write(dir, "tests/a.test.ts", SUITE + 'it.skip("later", () => {});\n');
		expect(run(dir, base)).toEqual({ code: 0, out: "tests/a.test.ts\n" });
	});

	test("an added @pytest.mark.skip line is flagged even as a pure addition", () => {
		const suite = "def test_adds():\n    assert add(1, 2) == 3\n";
		const { dir, base } = repoWith({ "pkg/test_add.py": suite });
		write(dir, "pkg/test_add.py", "import pytest\n" + suite.replace("def", "@pytest.mark.skip\ndef"));
		expect(run(dir, base)).toEqual({ code: 0, out: "pkg/test_add.py\n" });
	});

	test("a new test file containing .only( is flagged", () => {
		const { dir, base } = repoWith({});
		write(dir, "lib/b.spec.js", 'describe.only("b", () => {});\n');
		expect(run(dir, base)).toEqual({ code: 0, out: "lib/b.spec.js\n" });
	});

	test("a 100% rename of a test file passes", () => {
		const { dir, base } = repoWith({ "tests/a.test.ts": SUITE });
		mkdirSync(join(dir, "tests/unit"));
		renameSync(join(dir, "tests/a.test.ts"), join(dir, "tests/unit/a.test.ts"));
		expect(run(dir, base)).toEqual({ code: 0, out: "" });
	});

	test("a changed snapshot is flagged", () => {
		const { dir, base } = repoWith({ "src/__snapshots__/x.snap": "exports[`x`] = `1`;\n" });
		write(dir, "src/__snapshots__/x.snap", "exports[`x`] = `2`;\n");
		expect(run(dir, base)).toEqual({ code: 0, out: "src/__snapshots__/x.snap\n" });
	});

	test("an edit to a non-test source file is never listed", () => {
		const { dir, base } = repoWith({ "src/add.ts": "export const add = (a, b) => a + b;\n" });
		write(dir, "src/add.ts", "export const add = (a, b) => a - b;\n");
		expect(run(dir, base)).toEqual({ code: 0, out: "" });
		expect(run("--list", dir, base)).toEqual({ code: 0, out: "" });
	});

	test("several flagged paths print sorted, one per line", () => {
		const { dir, base } = repoWith({ "tests/z.test.ts": SUITE, "tests/a.test.ts": SUITE });
		rmSync(join(dir, "tests/z.test.ts"));
		rmSync(join(dir, "tests/a.test.ts"));
		expect(run(dir, base)).toEqual({ code: 0, out: "tests/a.test.ts\ntests/z.test.ts\n" });
	});

	test("a committed .sluice-test-paths replaces the default list whole", () => {
		const { dir, base } = repoWith({
			".sluice-test-paths": "# our checks live here\n\nchecks/**\n",
			"checks/a.js": SUITE,
			"tests/a.js": SUITE,
		});
		write(dir, "checks/a.js", SUITE.replace("toBe(3)", "toBe(4)"));
		write(dir, "tests/a.js", SUITE.replace("toBe(3)", "toBe(4)"));
		expect(run(dir, base)).toEqual({ code: 0, out: "checks/a.js\n" });
	});

	// The base the gate measures from can be a commit holding the session's
	// uncommitted starting point, so work already there is not the session's.
	test("uncommitted work captured in the base commit is not flagged", () => {
		const { dir } = repoWith({ "tests/a.test.ts": SUITE });
		write(dir, "tests/a.test.ts", SUITE.replace("toBe(3)", "toBe(4)"));
		const base = git(dir, "stash", "create").trim();
		expect(base).toMatch(/^[0-9a-f]{40}/);
		expect(run(dir, base)).toEqual({ code: 0, out: "" });
	});

	test("an unreadable base exits 1 with no output", () => {
		const { dir } = repoWith({ "tests/a.test.ts": SUITE });
		rmSync(join(dir, "tests/a.test.ts"));
		expect(run(dir, "0123456789abcdef0123456789abcdef01234567")).toEqual({ code: 1, out: "" });
		expect(run("--list", dir, "no-such-ref")).toEqual({ code: 1, out: "" });
	});

	test("a tree outside any git repo exits 1 with no output", () => {
		const dir = mkdtempSync(join(tmpdir(), "sluice-test-changes-plain-"));
		expect(run(dir, "HEAD")).toEqual({ code: 1, out: "" });
	});

	test("--list prints added, modified, deleted and renamed test paths", () => {
		const { dir, base } = repoWith({
			"tests/gone.test.ts": SUITE.replace("adds", "gone"),
			"tests/grown.test.ts": SUITE.replace("adds", "grown"),
			"tests/moved.test.ts": SUITE.replace("adds", "moved"),
		});
		rmSync(join(dir, "tests/gone.test.ts"));
		write(dir, "tests/grown.test.ts", SUITE + 'test("more", () => {});\n');
		renameSync(join(dir, "tests/moved.test.ts"), join(dir, "tests/renamed.test.ts"));
		write(dir, "tests/new.test.ts", SUITE.replace("adds", "new"));
		write(dir, "src/add.ts", "export {};\n");
		expect(run("--list", dir, base)).toEqual({
			code: 0,
			out: "tests/gone.test.ts\ntests/grown.test.ts\ntests/new.test.ts\ntests/renamed.test.ts\n",
		});
	});

	// The classification stages everything to diff it, and doing that in the
	// real index would stage the partner's work behind their back.
	test("leaves the tree's index and git dir as they were", () => {
		const { dir, base } = repoWith({ "tests/a.test.ts": SUITE });
		write(dir, "tests/a.test.ts", SUITE.replace("toBe(3)", "toBe(4)"));
		write(dir, "tests/new.test.ts", SUITE);
		run(dir, base);
		expect(git(dir, "status", "--porcelain")).toBe(" M tests/a.test.ts\n?? tests/new.test.ts\n");
		expect(readdirSync(join(dir, ".git")).filter((name) => name.startsWith("sluice-"))).toEqual([]);
	});

	// A copied index with a fresh mtime makes git trust stat data for a file
	// edited in the same second it was staged, and a same-size edit then goes
	// unseen. One pass rarely hits the window, so it is tried many times.
	test("a same-size edit made right after a commit is flagged", () => {
		const { dir } = repoWith({});
		for (let i = 0; i < 20; i++) {
			write(dir, "tests/a.test.ts", `expect(${i % 10}).toBe(1);\n`);
			git(dir, "add", "-A");
			git(dir, "commit", "-qm", `round ${i}`);
			const base = git(dir, "rev-parse", "HEAD").trim();
			write(dir, "tests/a.test.ts", `expect(${i % 10}).toBe(2);\n`);
			expect(run(dir, base)).toEqual({ code: 0, out: "tests/a.test.ts\n" });
		}
	});

	test("a new binary test file passes", () => {
		const { dir, base } = repoWith({});
		mkdirSync(join(dir, "tests"));
		writeFileSync(join(dir, "tests/img.snap"), Buffer.from([0, 1, 2]));
		expect(run(dir, base)).toEqual({ code: 0, out: "" });
	});

	test("a changed binary test file is flagged", () => {
		const { dir } = repoWith({});
		mkdirSync(join(dir, "tests"));
		writeFileSync(join(dir, "tests/img.snap"), Buffer.from([0, 1, 2]));
		git(dir, "add", "-A");
		git(dir, "commit", "-qm", "img");
		const base = git(dir, "rev-parse", "HEAD").trim();
		writeFileSync(join(dir, "tests/img.snap"), Buffer.from([0, 1, 2, 3]));
		expect(run(dir, base)).toEqual({ code: 0, out: "tests/img.snap\n" });
	});

	test("an added .only( is flagged when the repo forces colour on", () => {
		const { dir, base } = repoWith({ "tests/a.test.ts": SUITE });
		git(dir, "config", "color.ui", "always");
		write(dir, "tests/a.test.ts", SUITE + "it.only(1);\n");
		expect(run(dir, base)).toEqual({ code: 0, out: "tests/a.test.ts\n" });
	});

	// Sessions commit, so HEAD is theirs to move; the base is not.
	test("a .sluice-test-paths committed after the base does not hide tests", () => {
		const { dir, base } = repoWith({ "tests/a.test.js": SUITE });
		write(dir, ".sluice-test-paths", "nothing/**\n");
		git(dir, "add", "-A");
		git(dir, "commit", "-qm", "hide");
		write(dir, "tests/a.test.js", "");
		expect(run(dir, base)).toEqual({ code: 0, out: "tests/a.test.js\n" });
	});

	test("a test path with a quote in its name prints unquoted", () => {
		const { dir, base } = repoWith({ 'tests/q"uote.test.js': SUITE });
		write(dir, 'tests/q"uote.test.js', SUITE.replace("toBe(3)", "toBe(4)"));
		expect(run(dir, base)).toEqual({ code: 0, out: 'tests/q"uote.test.js\n' });
	});

	test("an added .only( in a test path with a backslash in its name is flagged", () => {
		const { dir, base } = repoWith({ "tests/b\\ack.test.js": SUITE });
		write(dir, "tests/b\\ack.test.js", SUITE + "it.only(1);\n");
		expect(run(dir, base)).toEqual({ code: 0, out: "tests/b\\ack.test.js\n" });
	});
});
