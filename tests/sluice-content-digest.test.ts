import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DIGEST = join(import.meta.dir, "..", "skills", "sluice", "scripts", "content-digest.sh");

function git(dir: string, ...args: string[]): string {
	return Bun.spawnSync({ cmd: ["git", "-C", dir, ...args], timeout: 10000 }).stdout.toString();
}

function gitRepo(): string {
	const dir = mkdtempSync(join(tmpdir(), "sluice-digest-"));
	git(dir, "init", "-q");
	git(dir, "config", "user.email", "t@example.com");
	git(dir, "config", "user.name", "t");
	writeFileSync(join(dir, "README.md"), "hi\n");
	writeFileSync(join(dir, ".gitignore"), "*.log\n");
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "init");
	return dir;
}

function digest(tree: string, env: Record<string, string> = {}) {
	const proc = Bun.spawnSync({ cmd: ["bash", DIGEST, tree], timeout: 10000, env: { ...process.env, ...env } });
	return { code: proc.exitCode, out: proc.stdout.toString(), err: proc.stderr.toString() };
}

// The Stop hook asks whether the content a check passed on is still the content
// in the tree. The expected values come from git itself: a commit's tree object
// is the content digest of exactly what that commit holds.
describe("content-digest.sh", () => {
	test("a clean tree's digest is the tree object of its HEAD", () => {
		const dir = gitRepo();
		expect(digest(dir).out).toBe(git(dir, "rev-parse", "HEAD^{tree}"));
	});

	test("an ignored file does not change the digest", () => {
		const dir = gitRepo();
		writeFileSync(join(dir, "build.log"), "noise\n");
		expect(digest(dir).out).toBe(git(dir, "rev-parse", "HEAD^{tree}"));
	});

	test("an untracked file's content changes the digest", () => {
		const dir = gitRepo();
		writeFileSync(join(dir, "new.ts"), "export const a = 1;\n");
		const before = digest(dir).out;
		writeFileSync(join(dir, "new.ts"), "export const a = 2;\n");
		expect(digest(dir).out).not.toBe(before);
	});

	test("committing the content leaves the digest unchanged", () => {
		const dir = gitRepo();
		writeFileSync(join(dir, "new.ts"), "export const a = 1;\n");
		const before = digest(dir).out;
		git(dir, "add", "-A");
		git(dir, "commit", "-qm", "new");
		expect(digest(dir).out).toBe(before);
	});

	// The digest stages everything to hash it, and doing that in the real index
	// would stage the partner's work behind their back.
	test("leaves the tree's own index as it was", () => {
		const dir = gitRepo();
		writeFileSync(join(dir, "new.ts"), "export const a = 1;\n");
		digest(dir);
		expect(git(dir, "status", "--porcelain")).toBe("?? new.ts\n");
	});

	test("a repo with no commit and no index yet still gets a digest", () => {
		const dir = mkdtempSync(join(tmpdir(), "sluice-digest-"));
		git(dir, "init", "-q");
		writeFileSync(join(dir, "first.ts"), "export const a = 1;\n");
		const r = digest(dir);
		expect(r.code).toBe(0);
		expect(r.out).toMatch(/^[0-9a-f]{40}([0-9a-f]{24})?\n$/);
	});

	// status.sh verify passes this script's stderr through, so a step that
	// fails silently leaves the session with "could not read" and no cause.
	test("a directory outside any git tree says so on stderr", () => {
		const dir = mkdtempSync(join(tmpdir(), "sluice-digest-plain-"));
		expect(digest(dir).err).toContain("not inside a git work tree");
	});

	test("leaves no scratch directory in the git dir", () => {
		const tree = gitRepo();
		writeFileSync(join(tree, "new.ts"), "export const x = 1;\n");
		expect(digest(tree).code).toBe(0);
		expect(readdirSync(join(tree, ".git")).filter((name) => name.startsWith("sluice-digest"))).toEqual([]);
	});

	test("a directory outside any git tree prints nothing and fails", () => {
		const r = digest(mkdtempSync(join(tmpdir(), "sluice-digest-")));
		expect(r.code).not.toBe(0);
		expect(r.out).toBe("");
	});
});
