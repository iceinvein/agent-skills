import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { checkManifest } from "../scripts/eval-freshness/manifest";

const skillsRoot = join(import.meta.dir, "..", "skills");

const skillsWithManifest = readdirSync(skillsRoot, { withFileTypes: true })
	.filter((entry) => entry.isDirectory() && existsSync(join(skillsRoot, entry.name, "evals", "rules.json")))
	.map((entry) => entry.name)
	.sort();

describe("skill eval manifests", () => {
	// A broken discovery glob would find nothing and pass every generated test vacuously.
	test("discovery finds the sluice and bug-hunter manifests", () => {
		expect(skillsWithManifest).toEqual(expect.arrayContaining(["sluice", "bug-hunter"]));
	});

	for (const skill of skillsWithManifest) {
		test(`${skill} rules.json agrees with its eval cases`, () => {
			expect(checkManifest(join(skillsRoot, skill))).toEqual([]);
		});
	}
});
