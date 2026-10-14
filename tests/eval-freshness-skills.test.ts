import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { caseNames, checkManifest } from "../scripts/eval-freshness/manifest";

const skillsRoot = join(import.meta.dir, "..", "skills");

const skillsWithCases = readdirSync(skillsRoot, { withFileTypes: true })
	.filter((entry) => entry.isDirectory() && existsSync(join(skillsRoot, entry.name, "evals")))
	.filter((entry) => caseNames(join(skillsRoot, entry.name)).length > 0)
	.map((entry) => entry.name)
	.sort();

const skillsWithManifest = readdirSync(skillsRoot, { withFileTypes: true })
	.filter((entry) => entry.isDirectory() && existsSync(join(skillsRoot, entry.name, "evals", "rules.json")))
	.map((entry) => entry.name)
	.sort();

describe("skill eval manifests", () => {
	// A broken discovery glob would find nothing and pass every generated test vacuously.
	test("discovery finds the sluice and bug-hunter manifests", () => {
		expect(skillsWithManifest).toEqual(expect.arrayContaining(["sluice", "bug-hunter"]));
	});

	// eval:fresh refuses a suite with no manifest, so without this a skill that
	// ships cases unmapped is found only when someone pays for a run.
	test("every skill with eval cases ships a rules manifest", () => {
		expect(skillsWithManifest).toEqual(skillsWithCases);
	});

	for (const skill of skillsWithManifest) {
		test(`${skill} rules.json agrees with its eval cases`, () => {
			expect(checkManifest(join(skillsRoot, skill))).toEqual([]);
		});
	}
});
