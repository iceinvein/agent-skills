import { expect, test } from "bun:test";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const skillsDir = join(import.meta.dir, "..", "skills");
const skills = readdirSync(skillsDir).filter((name) =>
	existsSync(join(skillsDir, name, "SKILL.md")),
);

function frontmatter(name: string): Record<string, unknown> {
	const text = readFileSync(join(skillsDir, name, "SKILL.md"), "utf8");
	const m = text.match(/^---\n([\s\S]*?)\n---\n/);
	if (!m) throw new Error(`${name}/SKILL.md has no frontmatter`);
	return Bun.YAML.parse(m[1] ?? "") as Record<string, unknown>;
}

// An argument hint is written in brackets, and an unquoted leading `[` makes YAML
// read a list: Claude Code then shows no hint at all, with no error anywhere.
test.each(skills)("%s frontmatter parses with string name, description and hint", (name) => {
	const fm = frontmatter(name);
	expect(typeof fm.name).toBe("string");
	expect(typeof fm.description).toBe("string");
	if ("argument-hint" in fm) expect(typeof fm["argument-hint"]).toBe("string");
});

test.each([
	["magpie", "[<pr#>|<pr-url>|local (default)] [--base <ref>] [--intent-file <path>]"],
	["bug-hunter", "[<commit>|<base>..<head>|<path>...]"],
	["sluice", "[fast|main|deep] [<what to change>]"],
])("%s shows its argument hint when typed as a slash command", (name, hint) => {
	expect(frontmatter(name)["argument-hint"]).toBe(hint);
});
