import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dir, "..", "skills", "sluice");
const SKILL = readFileSync(join(dir, "SKILL.md"), "utf8");
const DEEP = readFileSync(join(dir, "references", "deep-channel.md"), "utf8");

/**
 * The body of a `## <heading>` section, up to the next `## ` heading. Headings
 * inside a fenced block are content, not boundaries: the plan skeleton carries a
 * literal `## Ground Rules` line.
 */
function section(md: string, heading: string): string {
	const lines = md.split("\n");
	const out: string[] = [];
	let fenced = false;
	let inside = false;
	for (const line of lines) {
		if (line.startsWith("```")) fenced = !fenced;
		if (!fenced && line.startsWith("## ")) {
			if (inside) break;
			inside = line.slice(3).trim() === heading;
			if (inside) continue;
		}
		if (inside) out.push(line);
	}
	if (!inside && out.length === 0) throw new Error(`no "## ${heading}" section`);
	return out.join("\n");
}

function fencedBlocks(md: string): string[] {
	return [...md.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => (m[1] ?? "").trim());
}

describe("sluice deep channel", () => {
	const deep = section(SKILL, "Deep channel");

	// A run reaches the plan days and a context window after routing. The pointer to
	// the reference has to precede the instructions that assume it was followed, or a
	// plan gets written from this page alone.
	test("points at references/deep-channel.md before instructing on plan contents", () => {
		const pointer = deep.indexOf("references/deep-channel.md");
		expect(pointer).toBeGreaterThan(-1);

		for (const later of ["Order the plan", "Pre-flight"]) {
			const at = deep.indexOf(later);
			expect(at).toBeGreaterThan(-1);
			expect(pointer).toBeLessThan(at);
		}
	});

	// Carrying the skeleton here means a plan written without the reference still
	// comes out as a plan rather than as prose with a sequencing paragraph.
	test("carries the plan skeleton, identical to the reference's", () => {
		const canonical = fencedBlocks(DEEP).find((b) => b.startsWith("# Plan:"));
		expect(canonical).toBeDefined();
		expect(fencedBlocks(deep)).toContain(canonical as string);
	});

	test("the skeleton names every field dispatch derives from", () => {
		const skeleton = fencedBlocks(deep).find((b) => b.startsWith("# Plan:")) ?? "";
		for (const field of ["Ground Rules", "Contract", "Needs", "Offers", "Touches", "Flips", "Review"]) {
			expect(skeleton).toContain(field);
		}
	});
});

// Pre-flight shares the plan's stop, so a bare "yes" is indistinguishable from an
// answer to questions never asked. What separates them is whether the answers got
// written down, which makes the run record the thing that discharges pre-flight.
describe("sluice pre-flight", () => {
	test("the router says where pre-flight's answers land", () => {
		// The passage from the pre-flight paragraph to the end of the section, so the
		// gate may sit in its own paragraph rather than be crammed into that one.
		const paras = section(SKILL, "Deep channel").split("\n\n");
		const at = paras.findIndex((p) => p.startsWith("Pre-flight"));
		expect(at).toBeGreaterThan(-1);
		expect(paras.slice(at).join("\n\n")).toContain("run record");
	});

	test("the reference gates Task 1 on the record, not on approval", () => {
		const preflight = section(DEEP, "Pre-flight");
		expect(preflight).toContain("run record");
		expect(preflight).toContain("Task 1");
	});

	test("the run record claims pre-flight's answers as its own first rows", () => {
		expect(section(DEEP, "The run record")).toContain("pre-flight");
	});
});
