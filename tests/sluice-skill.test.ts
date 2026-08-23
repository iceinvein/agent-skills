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
		for (const field of ["Ground Rules", "Contract", "Needs", "Offers", "Touches", "Flips", "Review", "Model"]) {
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

// The workspace answer settles where implementers run, which is not the same as
// whether any task may be dispatched. Left conflated, a controller-run answer reads
// as forbidding the one dispatch that would have paid: the task whose reading dwarfs
// its diff.
describe("sluice per-task dispatch", () => {
	/**
	 * The passage the workspace question's option text is written from: its lead
	 * paragraph through to the next bolded one, so the permission may sit in a
	 * paragraph of its own rather than be crammed into the first.
	 */
	function workspace(): string {
		const paras = section(DEEP, "Pre-flight").split("\n\n");
		const at = paras.findIndex((p) => p.startsWith("**Workspace"));
		expect(at).toBeGreaterThan(-1);
		const end = paras.findIndex((p, i) => i > at && p.startsWith("**"));
		return paras.slice(at, end === -1 ? undefined : end).join("\n\n");
	}

	test("the workspace question keeps per-task dispatch open under a shared tree", () => {
		const para = workspace();
		expect(para).toMatch(/dispatch/i);
		expect(para).toMatch(/single task|one task/i);
	});

	test("it separates where implementers run from whether dispatch is allowed", () => {
		expect(workspace()).toMatch(/not whether/i);
	});

	test("the escalation carries observable triggers rather than judgement", () => {
		const rules = section(DEEP, "Dispatch rules");
		expect(rules).toMatch(/survey/i);
		expect(rules).toMatch(/summarised/i);
	});

	test("a mid-run dispatch lands in the run record like the answers it departs from", () => {
		const rules = section(DEEP, "Dispatch rules");
		const bullet = rules.split("\n- ").find((b) => /single task/i.test(b));
		expect(bullet).toBeDefined();
		expect(bullet).toMatch(/run record/i);
	});
});

// "Stronger model" only means something against a baseline someone decided. With
// every dispatch inheriting the session's model, a tier that escalates to a stronger
// one escalates to the same one, and reads as a safeguard that is not there.
describe("sluice model routing", () => {
	test("no tier escalates to an unspecified stronger model", () => {
		expect(DEEP).not.toMatch(/stronger[ -]model/i);
	});

	test("the skeleton carries the per-task model marker", () => {
		const skeleton = fencedBlocks(DEEP).find((b) => b.startsWith("# Plan:")) ?? "";
		expect(skeleton).toContain("**Model:**");
	});

	// Triviality is fixed once the Contract and Touches are written, so the judgement
	// belongs to the plan. Left to the moment of dispatch, it is spent before the one
	// stop where the partner could have priced it.
	test("an unmarked task runs on the session's model", () => {
		const bullet = section(DEEP, "Dispatch rules")
			.split("\n- ")
			.find((b) => /`Model`/.test(b));
		expect(bullet).toBeDefined();
		expect(bullet).toMatch(/session/i);
	});

	test("review never runs below the model that built the task", () => {
		expect(section(DEEP, "Review policy")).toMatch(/never runs below|no lower than/i);
	});

	test("the tasks tier 3 catches cannot be downshifted", () => {
		const rows = section(DEEP, "Review policy")
			.split("\n")
			.filter((l) => l.startsWith("| 3 |"));
		expect(rows).toHaveLength(2);
		for (const row of rows) expect(row).toMatch(/downshift/i);
	});

	test("pre-flight ratifies the plan's marks with the count in the question", () => {
		const paras = section(DEEP, "Pre-flight").split("\n\n");
		const at = paras.findIndex((p) => p.startsWith("**Model"));
		expect(at).toBeGreaterThan(-1);
		expect(paras[at]).toMatch(/count/i);
	});

	test("the router names the model question at the same stop", () => {
		const paras = section(SKILL, "Deep channel").split("\n\n");
		const at = paras.findIndex((p) => p.startsWith("Pre-flight"));
		expect(at).toBeGreaterThan(-1);
		expect(paras[at]).toMatch(/model/i);
	});
});
