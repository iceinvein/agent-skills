import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { copyDrift, pluginCopies, syncPluginCopies } from "../scripts/eval-plugins";

const repoRoot = join(import.meta.dir, "..");

function put(path: string, text: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, text);
}

/**
 * Builds <root>/skills/host, whose one case keeps a copy of skills/<name>
 * under plugins/<name>, and skills/<name> itself with the given files.
 */
function treeWithCopy(name: string, source: Record<string, string>, copy: Record<string, string>) {
	const root = mkdtempSync(join(tmpdir(), "eval-plugins-"));
	put(join(root, "skills", "host", "evals", "hunt", "case.yaml"), 'schema_version: "1.1"\n');
	for (const [path, text] of Object.entries(source)) put(join(root, "skills", name, path), text);
	const copyDir = join(root, "skills", "host", "evals", "hunt", "plugins", name);
	mkdirSync(copyDir, { recursive: true });
	for (const [path, text] of Object.entries(copy)) put(join(copyDir, path), text);
	return { root, copyDir };
}

const bundled = JSON.stringify({ name: "hunter", bundle: { include: ["references"] } });

describe("syncPluginCopies", () => {
	test("rewrites a stale copy to match its source", () => {
		const { root, copyDir } = treeWithCopy(
			"hunter",
			{ "SKILL.md": "# hunter v2\n", "skill.json": bundled, "references/catalog.md": "two scenarios\n" },
			{ "SKILL.md": "# hunter v1\n", "skill.json": bundled, "references/catalog.md": "one scenario\n" },
		);
		syncPluginCopies(root);
		expect(readFileSync(join(copyDir, "SKILL.md"), "utf8")).toBe("# hunter v2\n");
		expect(readFileSync(join(copyDir, "references", "catalog.md"), "utf8")).toBe("two scenarios\n");
	});

	test("removes a file the source no longer ships", () => {
		const { root, copyDir } = treeWithCopy(
			"hunter",
			{ "SKILL.md": "# hunter\n", "skill.json": bundled, "references/catalog.md": "scenarios\n" },
			{ "SKILL.md": "# hunter\n", "skill.json": bundled, "references/retired.md": "gone upstream\n" },
		);
		syncPluginCopies(root);
		expect(existsSync(join(copyDir, "references", "retired.md"))).toBe(false);
	});

	test("copies only SKILL.md and skill.json from a skill with no bundle.include", () => {
		const { root, copyDir } = treeWithCopy(
			"plain",
			{ "SKILL.md": "# plain\n", "skill.json": '{"name":"plain"}', "notes.md": "not shipped\n" },
			{},
		);
		syncPluginCopies(root);
		expect(copyDrift(join(root, "skills", "plain"), copyDir)).toEqual([]);
		expect(existsSync(join(copyDir, "notes.md"))).toBe(false);
		expect(readFileSync(join(copyDir, "skill.json"), "utf8")).toBe('{"name":"plain"}');
	});

	test("refuses a copy whose skill does not exist", () => {
		const { root } = treeWithCopy("ghost", {}, {});
		expect(() => syncPluginCopies(root)).toThrow("skills/ghost");
	});

	test("copies the files.supporting paths a skill installs beside its prompt", () => {
		const supporting = JSON.stringify({ name: "router", files: { supporting: ["agents/worker.md"] } });
		const { root, copyDir } = treeWithCopy(
			"router",
			{ "SKILL.md": "# router\n", "skill.json": supporting, "agents/worker.md": "# worker\n" },
			{},
		);
		syncPluginCopies(root);
		expect(readFileSync(join(copyDir, "agents", "worker.md"), "utf8")).toBe("# worker\n");
	});

	test("refuses a bundle.include path outside the skill", () => {
		const escaping = JSON.stringify({ name: "hunter", bundle: { include: ["../host"] } });
		const { root } = treeWithCopy("hunter", { "SKILL.md": "# hunter\n", "skill.json": escaping }, {});
		expect(() => syncPluginCopies(root)).toThrow("outside");
	});

	test("refuses a files.supporting path outside the skill", () => {
		const escaping = JSON.stringify({ name: "router", files: { supporting: ["../host/evals/hunt/case.yaml"] } });
		const { root } = treeWithCopy("router", { "SKILL.md": "# router\n", "skill.json": escaping }, {});
		expect(() => syncPluginCopies(root)).toThrow("outside");
	});
});

describe("copyDrift", () => {
	const source = { "SKILL.md": "# hunter\n", "skill.json": bundled, "references/catalog.md": "scenarios\n" };

	test("names a shipped file whose copy differs", () => {
		const { root, copyDir } = treeWithCopy("hunter", source, { ...source, "references/catalog.md": "stale\n" });
		expect(copyDrift(join(root, "skills", "hunter"), copyDir)).toEqual(["references/catalog.md"]);
	});

	test("names a file in the copy the source does not ship", () => {
		const { root, copyDir } = treeWithCopy("hunter", source, { ...source, "references/extra.md": "extra\n" });
		expect(copyDrift(join(root, "skills", "hunter"), copyDir)).toEqual(["references/extra.md"]);
	});

	test("names a shipped file whose copy lost its executable bit", () => {
		const scripted = JSON.stringify({ name: "router", bundle: { include: ["scripts"] } });
		const files = { "SKILL.md": "# router\n", "skill.json": scripted, "scripts/run.sh": "echo run\n" };
		const { root, copyDir } = treeWithCopy("router", files, files);
		chmodSync(join(root, "skills", "router", "scripts", "run.sh"), 0o755);
		chmodSync(join(copyDir, "scripts", "run.sh"), 0o644);
		expect(copyDrift(join(root, "skills", "router"), copyDir)).toEqual(["scripts/run.sh"]);
	});
});

describe("case-local plugin copies in this repo", () => {
	// Without a copy found, the drift test below would pass over nothing.
	test("the hunt cases carry copies of sluice and bug-hunter", () => {
		const names = pluginCopies(repoRoot).map((c) => c.copy.slice(repoRoot.length + 1));
		expect(names).toEqual(
			expect.arrayContaining([
				"skills/sluice/evals/main-hunts-a-checkable-claim/plugins/bug-hunter",
				"skills/sluice/evals/main-hunts-a-checkable-claim/plugins/sluice",
				"skills/sluice/evals/main-skips-the-hunt-without-a-claim/plugins/bug-hunter",
				"skills/sluice/evals/main-skips-the-hunt-without-a-claim/plugins/sluice",
			]),
		);
	});

	test("every copy matches its source (run `bun run eval:plugins` to refresh)", () => {
		const drifted = pluginCopies(repoRoot).flatMap(({ source, copy }) =>
			copyDrift(source, copy).map((path) => `${copy.slice(repoRoot.length + 1)}/${path}`),
		);
		expect(drifted).toEqual([]);
	});
});
