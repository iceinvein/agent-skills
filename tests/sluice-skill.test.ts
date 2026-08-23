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

	// The answers land in run.json and the reasons in the record, so the gate names
	// both. Named as one file, whichever half a reader pictures is the half that
	// gets written, and the other is the one nobody notices is missing.
	test("the gate names the command that records the answers", () => {
		expect(section(DEEP, "Pre-flight")).toContain("status.sh preflight");
	});
});

// A run visible only to the session running it cannot be redirected, which is the
// same argument the channel announcement makes. run.json is what carries it past
// the announcement, so status has to have exactly one home.
describe("sluice run state", () => {
	const STATUS = readFileSync(join(dir, "references", "status.md"), "utf8");

	test("the router points at the state file and its reference", () => {
		const deep = section(SKILL, "Deep channel");
		expect(deep).toContain(".sluice/run.json");
		expect(deep).toContain("references/status.md");
	});

	test("the record section hands status to run.json and keeps the reasons", () => {
		const record = section(DEEP, "The run record");
		expect(record).toContain(".sluice/run.json");
		expect(record).toMatch(/no longer carries task rows/i);
		expect(record).toMatch(/reason/i);
	});

	test("the reference says status has one home, so the two cannot drift", () => {
		expect(STATUS).toMatch(/owns status/i);
		expect(STATUS).toMatch(/drift/i);
	});

	test("the statusline segment is carried literally, not described", () => {
		const fenced = fencedBlocks(STATUS).find((b) => b.includes("statusline") || b.includes("sluice_line"));
		expect(fenced).toBeDefined();
		expect(fenced).toContain("run.json");
		expect(fenced).toContain("status.sh");
	});

	// A status bar renders on every keystroke and has nowhere to put an error, so
	// the silent-and-zero contract is the one property the caller depends on.
	test("the reference states the silent contract the statusline relies on", () => {
		expect(STATUS).toMatch(/silen(t|ce)/i);
		expect(STATUS).toMatch(/exits? 0/i);
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

// The design stop exists because a plan written against the wrong design wastes a
// plan's worth of work. Sluice enforced it with prose, which is the weakest gate
// available in a harness that has an enforced one.
describe("sluice design stop and plan mode", () => {
	test("the router sends the design stop through plan mode", () => {
		const deep = section(SKILL, "Deep channel");
		expect(deep).toMatch(/plan mode/i);
	});

	function planMode(): string {
		const headings = [...DEEP.matchAll(/^## (.+)$/gm)].map((m) => m[1] as string);
		const found = headings.find((h) => /plan mode/i.test(h));
		expect(found).toBeDefined();
		return section(DEEP, found as string);
	}

	test("the reference names the gate rather than describing one", () => {
		expect(planMode()).toContain("ExitPlanMode");
	});

	// One gate, two stops. Pre-flight wants three answers, and an approval is not
	// an answer, so collapsing them loses the questions entirely.
	test("it says pre-flight is not the stop plan mode replaces", () => {
		const s = planMode();
		expect(s).toMatch(/pre-flight/i);
		expect(s).toMatch(/answers?/i);
	});

	// Plan mode's file is harness-managed. Treated as the artifact, the design is
	// gone by the time anyone resumes.
	test("it keeps the durable artifact out of the harness's own file", () => {
		const s = planMode();
		expect(s).toContain("docs/specs/");
		expect(s).toMatch(/not the artifact|is not the artifact|durable/i);
	});

	test("it covers the harness that has no plan mode", () => {
		expect(planMode()).toMatch(/unavailable|no plan mode|without it/i);
	});
});

// A dispatched agent shows in the harness's task panel under whatever label the
// dispatch gave it. Labelled by task, the panel reads as the plan; labelled
// anything else, it reads as a row of anonymous agents.
describe("sluice dispatch labels", () => {
	test("the dispatch rules fix the label to the task", () => {
		const rules = section(DEEP, "Dispatch rules");
		expect(rules).toMatch(/label/i);
		expect(rules).toMatch(/T<n>|T\d/);
	});
});

// The validator carries the checkable half of this file, so the file has to say
// so where the plan gets written rather than in a footnote nobody reaches.
describe("sluice plan validation", () => {
	test("the plan format section points at the validator", () => {
		expect(section(DEEP, "Plan format")).toContain("plan.sh validate");
	});

	test("the run record section points at the importer that seeds it", () => {
		expect(section(DEEP, "The run record")).toContain("plan.sh import");
	});
});

// The two references have to agree on how task rows get seeded. A model reading
// only the one SKILL.md points at for run state would never learn the importer
// exists, and would type a command per task.
describe("sluice references agree on seeding", () => {
	const STATUS = readFileSync(join(dir, "references", "status.md"), "utf8");

	test("status.md points at the importer rather than a command per task", () => {
		expect(STATUS).toContain("plan.sh import");
	});

	test("it says what re-importing does to a row already recorded", () => {
		expect(STATUS).toMatch(/re-?import/i);
	});

	// A bare reference path is idiomatic at the end of the sentence it belongs to,
	// including where that sentence wraps and leaves the path indented under its
	// own bullet. At column zero it is not a wrap: it reads as a truncated edit
	// and gives no instruction, which is the shape being ruled out here.
	test("no reference path stands alone at paragraph level", () => {
		for (const [name, body] of [["SKILL.md", SKILL], ["status.md", STATUS], ["deep-channel.md", DEEP]] as const) {
			const dangling = body.split("\n").filter((l) => /^`references\/[a-z-]+\.md`\s*$/.test(l));
			expect(dangling, `${name} has a reference path alone at column zero`).toEqual([]);
		}
	});
});

// deep-channel.md is the file SKILL.md mandates before a plan is written, so a
// mechanism it does not mention is a mechanism the plan author never uses.
describe("sluice review debt is reachable from the plan author's file", () => {
	test("the record section says import seeds the tiers too", () => {
		expect(section(DEEP, "The run record")).toMatch(/tier/i);
	});

	test("the review policy names how a completed review gets marked", () => {
		expect(section(DEEP, "Review policy")).toContain("--reviewed");
	});

	// The counter only means something if the marking happens; unmarked, it sits
	// permanently non-zero and stops being a signal at all.
	test("it says what the debt count is for", () => {
		expect(section(DEEP, "Review policy")).toMatch(/outstanding|debt|unreviewed/i);
	});

	// As a statusline's last command, `[ -n "$x" ] && printf ...` exits 1 on every
	// render with no run, which is the common case.
	test("the statusline snippet does not end on a bare && test", () => {
		const STATUS = readFileSync(join(dir, "references", "status.md"), "utf8");
		const fenced = fencedBlocks(STATUS).filter((b) => b.includes("sluice_line"));
		expect(fenced.length).toBeGreaterThan(0);
		for (const block of fenced) {
			expect(block).not.toMatch(/^\[\s*-n\s*"\$sluice_line"\s*\]\s*&&/m);
		}
	});
});
