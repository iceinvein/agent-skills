import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "..", "skills", "sluice", "scripts", "plan.sh");

function planFile(body: string): string {
	const dir = mkdtempSync(join(tmpdir(), "sluice-plan-"));
	const path = join(dir, "plan.md");
	writeFileSync(path, body);
	return path;
}

function validate(body: string) {
	const proc = Bun.spawnSync({ cmd: ["bash", SCRIPT, "validate", planFile(body)], timeout: 5000 });
	return {
		code: proc.exitCode,
		signal: proc.signalCode,
		out: proc.stdout.toString(),
		err: proc.stderr.toString(),
	};
}

/**
 * A plan that passes every check, as the baseline each case below breaks in one
 * place. Task 1 is inert and offers what task 2 needs; task 2 carries the flip.
 */
const GOOD = `# Plan: widget

## Goal
Ship the widget.

## Architecture
One module.

## Ground Rules
- Commit convention: \`feat(widget): <subject>\`
- No \`git add -A\`

### Task 1: render helper
**Contract:** Needs: none | Offers: \`renderWidget(spec, width)\` -> string
**Touches:** src/widget.ts (new) | tests/widget.test.ts (test)
- [ ] write the failing test -> it fails on the missing export
- [ ] implement renderWidget -> the test passes

### Task 2: wire it up
**Contract:** Needs: \`renderWidget(spec, width)\` | Offers: none
**Touches:** src/cli.ts (edit)
**Flips:** the CLI renders widgets, from printing nothing
- [ ] call renderWidget from the command -> the CLI prints a widget
`;

/** GOOD with one line replaced, so each case differs from clean by one thing. */
function broken(from: string, to: string): string {
	if (!GOOD.includes(from)) throw new Error(`GOOD has no ${JSON.stringify(from)}`);
	return GOOD.replace(from, to);
}

describe("plan.sh syntax", () => {
	test("parses under bash -n", () => {
		const proc = Bun.spawnSync(["bash", "-n", SCRIPT]);
		expect(proc.stderr.toString()).toBe("");
		expect(proc.exitCode).toBe(0);
	});
});

describe("a plan that satisfies the format", () => {
	test("passes, and says so rather than printing nothing", () => {
		const r = validate(GOOD);
		expect(r.code).toBe(0);
		expect(r.out).toMatch(/2 tasks/);
		expect(r.out).toMatch(/no errors|clean/i);
	});

	test("reports the task count and the flip it found", () => {
		const out = validate(GOOD).out;
		expect(out).toMatch(/task 2/i);
	});
});

describe("structure the plan cannot be dispatched without", () => {
	test("a plan with no tasks is not a plan", () => {
		const r = validate("# Plan: widget\n\n## Ground Rules\n- none\n");
		expect(r.code).toBe(2);
		expect(r.out).toMatch(/no tasks/i);
	});

	test("ground rules are what every task answers to, so they are required", () => {
		const r = validate(GOOD.replace("## Ground Rules\n- Commit convention: `feat(widget): <subject>`\n- No `git add -A`\n", ""));
		expect(r.code).toBe(2);
		expect(r.out).toMatch(/ground rules/i);
	});

	test("a Ground Rules heading with nothing under it is not ground rules", () => {
		const r = validate(broken("- Commit convention: `feat(widget): <subject>`\n- No `git add -A`\n", ""));
		expect(r.code).toBe(2);
		expect(r.out).toMatch(/ground rules/i);
	});

	// Contracts are what make a task buildable blind. A task without one hands its
	// implementer a name and nothing to build against.
	test("a task with no Contract is rejected", () => {
		const r = validate(broken("**Contract:** Needs: none | Offers: `renderWidget(spec, width)` -> string\n", ""));
		expect(r.code).toBe(2);
		expect(r.out).toMatch(/contract/i);
		expect(r.out).toMatch(/task 1/i);
	});

	test("a task with no Touches is rejected, since concurrency is derived from it", () => {
		const r = validate(broken("**Touches:** src/cli.ts (edit)\n", ""));
		expect(r.code).toBe(2);
		expect(r.out).toMatch(/touches/i);
		expect(r.out).toMatch(/task 2/i);
	});

	test("a task with no steps is rejected", () => {
		const r = validate(broken("- [ ] call renderWidget from the command -> the CLI prints a widget\n", ""));
		expect(r.code).toBe(2);
		expect(r.out).toMatch(/step/i);
	});

	test("task numbers have to run 1..N without a gap", () => {
		const r = validate(broken("### Task 2: wire it up", "### Task 3: wire it up"));
		expect(r.code).toBe(2);
		expect(r.out).toMatch(/numbered|sequence|gap/i);
	});

	test("a repeated task number is rejected", () => {
		const r = validate(broken("### Task 2: wire it up", "### Task 1: wire it up"));
		expect(r.code).toBe(2);
		expect(r.out).toMatch(/twice|duplicate|repeated/i);
	});
});

describe("the flip", () => {
	test("a plan with no Flips does nothing, so it is rejected", () => {
		const r = validate(broken("**Flips:** the CLI renders widgets, from printing nothing\n", ""));
		expect(r.code).toBe(2);
		expect(r.out).toMatch(/flips/i);
	});

	test("two Flips means two branches of work, so it is rejected", () => {
		const r = validate(
			broken(
				"**Touches:** src/widget.ts (new) | tests/widget.test.ts (test)\n",
				"**Touches:** src/widget.ts (new) | tests/widget.test.ts (test)\n**Flips:** something else, from nothing\n",
			),
		);
		expect(r.code).toBe(2);
		expect(r.out).toMatch(/two|2 tasks carry|both/i);
	});
});

describe("contracts as a dependency graph", () => {
	// The standing failure in a written plan: a task built blind against a symbol
	// no task in the plan ever creates.
	test("a Needs no task Offers is an error naming the symbol", () => {
		const r = validate(broken("Needs: `renderWidget(spec, width)`", "Needs: `renderGadget(spec)`"));
		expect(r.code).toBe(2);
		expect(r.out).toContain("renderGadget");
	});

	test("`none` is an empty Needs, not a symbol to hunt for", () => {
		expect(validate(GOOD).code).toBe(0);
	});

	// Offered later is still offered, so the graph resolves; it is the ordering
	// that is wrong, and reordering is the plan author's call.
	test("a Needs offered only by a later task warns rather than errors", () => {
		const swapped = GOOD.replace(
			"**Contract:** Needs: none | Offers: `renderWidget(spec, width)` -> string",
			"**Contract:** Needs: `finish()` | Offers: `renderWidget(spec, width)` -> string",
		).replace("Offers: none", "Offers: `finish()`");
		const r = validate(swapped);
		expect(r.code).toBe(0);
		expect(r.out).toMatch(/warn/i);
		expect(r.out).toContain("finish");
	});
});

describe("steps a stranger could not carry out", () => {
	test("TBD is rejected wherever it appears", () => {
		const r = validate(broken("implement renderWidget -> the test passes", "TBD -> the test passes"));
		expect(r.code).toBe(2);
		expect(r.out).toMatch(/TBD/);
	});

	test("a step deferring to another task is rejected, since tasks are read alone", () => {
		const r = validate(broken("implement renderWidget -> the test passes", "same as Task 2 -> it passes"));
		expect(r.code).toBe(2);
		expect(r.out).toMatch(/same as/i);
	});

	test("a step with no proof warns without blocking", () => {
		const r = validate(broken("implement renderWidget -> the test passes", "implement renderWidget"));
		expect(r.code).toBe(0);
		expect(r.out).toMatch(/warn/i);
		expect(r.out).toMatch(/proof/i);
	});
});

describe("the model mark against the tier table", () => {
	// The flip is where being wrong is expensive, so the saving is not on offer.
	test("Model on the task carrying Flips is rejected", () => {
		const r = validate(
			broken(
				"**Flips:** the CLI renders widgets, from printing nothing\n",
				"**Flips:** the CLI renders widgets, from printing nothing\n**Model:** cheaper, the contract is exact\n",
			),
		);
		expect(r.code).toBe(2);
		expect(r.out).toMatch(/model/i);
		expect(r.out).toMatch(/flips|tier 3/i);
	});

	test("Model on a task the plan flagged for review is rejected", () => {
		const r = validate(
			broken(
				"**Touches:** src/widget.ts (new) | tests/widget.test.ts (test)\n",
				"**Touches:** src/widget.ts (new) | tests/widget.test.ts (test)\n**Review:** auth\n**Model:** cheaper, mechanical\n",
			),
		);
		expect(r.code).toBe(2);
		expect(r.out).toMatch(/model/i);
	});

	test("Model on an ordinary task is fine", () => {
		const r = validate(
			broken(
				"**Touches:** src/widget.ts (new) | tests/widget.test.ts (test)\n",
				"**Touches:** src/widget.ts (new) | tests/widget.test.ts (test)\n**Model:** cheaper, the contract is exact and the tests exist\n",
			),
		);
		expect(r.code).toBe(0);
	});
});

describe("concurrency the Touches lines rule out", () => {
	test("two tasks sharing a path warn, since it decides what can overlap", () => {
		const r = validate(broken("**Touches:** src/cli.ts (edit)", "**Touches:** src/widget.ts (edit)"));
		expect(r.code).toBe(0);
		expect(r.out).toMatch(/warn/i);
		expect(r.out).toContain("src/widget.ts");
	});
});

describe("argument handling", () => {
	test("a missing file exits 4 and names it", () => {
		const proc = Bun.spawnSync({ cmd: ["bash", SCRIPT, "validate", "/nope/plan.md"], timeout: 5000 });
		expect(proc.exitCode).toBe(4);
		expect(proc.stderr.toString()).toContain("/nope/plan.md");
	});

	test("no path exits 4", () => {
		const proc = Bun.spawnSync({ cmd: ["bash", SCRIPT, "validate"], timeout: 5000 });
		expect(proc.exitCode).toBe(4);
	});

	test("an unknown subcommand exits 4 and names it", () => {
		const proc = Bun.spawnSync({ cmd: ["bash", SCRIPT, "frobnicate"], timeout: 5000 });
		expect(proc.exitCode).toBe(4);
		expect(proc.stderr.toString()).toMatch(/frobnicate/);
	});

	test("no subcommand prints usage", () => {
		const proc = Bun.spawnSync({ cmd: ["bash", SCRIPT], timeout: 5000 });
		expect(proc.exitCode).toBe(4);
		expect(proc.stderr.toString()).toMatch(/usage/i);
	});
});

// The gap the run state left open: nothing populated it. A task row per hand-typed
// command is the same compliance-by-memory problem the validator exists to remove,
// and the ids, names, model marks and the flip are all already in the plan.
describe("import", () => {
	const STATUS = join(import.meta.dir, "..", "skills", "sluice", "scripts", "status.sh");

	function repoWithRun(): string {
		const dir = mkdtempSync(join(tmpdir(), "sluice-import-"));
		Bun.spawnSync({ cmd: ["bash", STATUS, "init", "--topic", "widget", "--channel", "deep", "--dir", dir] });
		return dir;
	}

	function imp(dir: string, body: string, ...flags: string[]) {
		const proc = Bun.spawnSync({
			cmd: ["bash", SCRIPT, "import", planFile(body), "--dir", dir, ...flags],
			timeout: 10000,
		});
		return { code: proc.exitCode, out: proc.stdout.toString(), err: proc.stderr.toString() };
	}

	function tasks(dir: string) {
		return JSON.parse(readFileSync(join(dir, ".sluice", "run.json"), "utf8")).tasks;
	}

	test("seeds a row per task, with the plan's ids and names", () => {
		const dir = repoWithRun();
		const r = imp(dir, GOOD);
		expect(r.code).toBe(0);
		expect(r.out).toMatch(/2 tasks/);

		expect(tasks(dir)).toMatchObject([
			{ id: 1, name: "render helper", status: "todo" },
			{ id: 2, name: "wire it up", status: "todo" },
		]);
	});

	test("carries the flip across, so the run state knows which task runs alone", () => {
		const dir = repoWithRun();
		imp(dir, GOOD);
		expect(tasks(dir)[1]).toMatchObject({ id: 2, flips: true });
		expect(tasks(dir)[0]).not.toHaveProperty("flips");
	});

	test("carries a Model mark across as the cheaper model", () => {
		const dir = repoWithRun();
		imp(
			dir,
			broken(
				"**Touches:** src/widget.ts (new) | tests/widget.test.ts (test)\n",
				"**Touches:** src/widget.ts (new) | tests/widget.test.ts (test)\n**Model:** cheaper, the contract is exact\n",
			),
		);
		expect(tasks(dir)[0]).toMatchObject({ id: 1, model: "cheap" });
		expect(tasks(dir)[1]).not.toHaveProperty("model");
	});

	// Seeding a run from a plan that still has to change points every task row at
	// work that is about to be renumbered.
	test("refuses a plan with errors, and says how to see them", () => {
		const dir = repoWithRun();
		const r = imp(dir, broken("**Flips:** the CLI renders widgets, from printing nothing\n", ""));
		expect(r.code).toBe(2);
		expect(r.err).toMatch(/validate/);
		expect(tasks(dir)).toEqual([]);
	});

	test("--force imports over errors, for a plan being fixed in place", () => {
		const dir = repoWithRun();
		const r = imp(dir, broken("**Flips:** the CLI renders widgets, from printing nothing\n", ""), "--force");
		expect(r.code).toBe(0);
		expect(tasks(dir)).toHaveLength(2);
	});

	test("fails legibly with no run to import into", () => {
		const dir = mkdtempSync(join(tmpdir(), "sluice-import-"));
		const r = imp(dir, GOOD);
		expect(r.code).not.toBe(0);
		expect(r.err).toMatch(/no run is live/i);
	});

	test("is repeatable: a second import updates rather than duplicating", () => {
		const dir = repoWithRun();
		imp(dir, GOOD);
		imp(dir, GOOD);
		expect(tasks(dir)).toHaveLength(2);
	});

	// A row already flipped to done must not be reset by re-importing the plan it
	// came from, or resuming after a compaction silently rewinds the run.
	test("does not reset progress already recorded against a task", () => {
		const dir = repoWithRun();
		imp(dir, GOOD);
		Bun.spawnSync({ cmd: ["bash", STATUS, "task", "1", "--status", "done", "--commit", "abc1234", "--dir", dir] });

		imp(dir, GOOD);
		expect(tasks(dir)[0]).toMatchObject({ id: 1, status: "done", commit: "abc1234" });
	});

	test("an unknown flag exits 4", () => {
		expect(imp(repoWithRun(), GOOD, "--turbo").code).toBe(4);
	});

	test("a missing plan exits 4 and names it", () => {
		const proc = Bun.spawnSync({ cmd: ["bash", SCRIPT, "import", "/nope/plan.md"], timeout: 5000 });
		expect(proc.exitCode).toBe(4);
		expect(proc.stderr.toString()).toContain("/nope/plan.md");
	});
});

// Found by running the validator on a real plan predating the current format: 41
// identical per-step warnings buried 17 errors. A finding repeated once per step
// is noise, and noise is what stops the next person running it at all.
describe("findings a reader can actually act on", () => {
	const NO_PROOF = `# Plan: widget

## Ground Rules
- Commit convention: \`feat(widget): <subject>\`

### Task 1: render helper
**Contract:** Needs: none | Offers: \`renderWidget(spec)\` -> string
**Touches:** src/widget.ts (new)
- [ ] step one
- [ ] step two
- [ ] step three

### Task 2: wire it up
**Contract:** Needs: \`renderWidget(spec)\` | Offers: none
**Touches:** src/cli.ts (edit)
**Flips:** the CLI renders widgets, from printing nothing
- [ ] step one
- [ ] step two
`;

	test("collapses the missing-proof warning to one line per task", () => {
		const out = validate(NO_PROOF).out;
		const lines = out.split("\n").filter((l) => /proof/.test(l));
		expect(lines).toHaveLength(2);
	});

	test("that line carries how many steps of how many are affected", () => {
		const out = validate(NO_PROOF).out;
		expect(out).toMatch(/task 1.*3 of 3/);
		expect(out).toMatch(/task 2.*2 of 2/);
	});

	test("a task where only some steps lack proof says so", () => {
		const out = validate(NO_PROOF.replace("- [ ] step two\n- [ ] step three", "- [ ] step two -> it works\n- [ ] step three")).out;
		expect(out).toMatch(/task 1.*2 of 3/);
	});

	// Errors are what block. Printed after 41 warnings they are found by scrolling.
	test("prints every error before any warning", () => {
		const lines = validate(NO_PROOF.replace("**Contract:** Needs: none | Offers: `renderWidget(spec)` -> string\n", ""))
			.out.split("\n")
			.filter((l) => /^\s+(error|warn)\b/.test(l));
		const lastError = lines.map((l) => l.trim().startsWith("error")).lastIndexOf(true);
		const firstWarn = lines.findIndex((l) => l.trim().startsWith("warn"));
		expect(lastError).toBeGreaterThan(-1);
		expect(firstWarn).toBeGreaterThan(-1);
		expect(lastError).toBeLessThan(firstWarn);
	});
});

// Round two of review. Each case below is a plan the format explicitly endorses
// that the first cut of the validator rejected, or a real defect it missed.
describe("contract sides read as supply and demand", () => {
	function plan(offers1: string, needs2: string, offers2 = "none"): string {
		return `# Plan: x

## Ground Rules
- Commit: \`feat(x): <s>\`

### Task 1: produce
**Contract:** Needs: none | Offers: ${offers1}
**Touches:** src/a.ts (new)
- [ ] do it -> proof

### Task 2: consume
**Contract:** Needs: ${needs2} | Offers: ${offers2}
**Touches:** src/b.ts (edit)
**Flips:** on, from off
- [ ] do it -> proof
`;
	}

	// deep-channel requires both sides "spelled out whole, argument lists and
	// return shapes". The return shape is a symbol on offer, not decoration.
	test("a return shape is on offer, so needing that type is satisfied", () => {
		const r = validate(plan("`parsePlan(path)` -> `PlanDoc`", "`PlanDoc`"));
		expect(r.out).not.toMatch(/^\s+error\b/m);
		expect(r.code).toBe(0);
	});

	test("a return shape spelled with a colon is on offer too", () => {
		expect(validate(plan("`parsePlan(path): PlanDoc`", "`PlanDoc`")).code).toBe(0);
	});

	test("every offered type counts, not only the first", () => {
		expect(validate(plan("`RunState`, `TaskRow`", "`TaskRow`")).code).toBe(0);
	});

	// The demand side stays strict: this is the defect the check exists for.
	test("every needed type is checked, not only the first", () => {
		const r = validate(plan("`RunState`", "`RunState`, `TaskRow`"));
		expect(r.code).toBe(2);
		expect(r.out).toContain("TaskRow");
	});

	test("a needed function no task offers is still caught", () => {
		const r = validate(plan("`parsePlan(path)` -> `PlanDoc`", "`renderPlan(doc)`"));
		expect(r.code).toBe(2);
		expect(r.out).toContain("renderPlan");
	});

	test("a symbol named on both sides of one contract is reported once", () => {
		const r = validate(plan("`f()`", "`missing(x)`, `missing(x)`"));
		expect(r.out.split("\n").filter((l) => l.includes("missing")).length).toBe(1);
	});
});

describe("what counts as part of a task", () => {
	const TAIL = `# Plan: x

## Ground Rules
- Commit: \`feat(x): <s>\`

### Task 1: only task
**Contract:** Needs: none | Offers: \`f()\`
**Touches:** src/a.ts (new)
**Flips:** on, from off
- [ ] do it -> proof

## Open questions
- whether to keep the legacy path: TBD
- [ ] not a step, this section has none
`;

	// A section after the last task belongs to the plan, not to that task, so its
	// prose must not block the plan or inflate a step count.
	test("a section after the last task is not attributed to it", () => {
		const r = validate(TAIL);
		expect(r.out).not.toMatch(/TBD/);
		expect(r.code).toBe(0);
	});

	test("nor are its checkboxes counted as that task's steps", () => {
		expect(validate(TAIL).out).not.toMatch(/of 2 steps/);
	});

	// Nesting a code block under a step indents its fence, which is the ordinary
	// markdown form rather than an edge case.
	test("an indented fenced block is skipped like a flush one", () => {
		const r = validate(`# Plan: x

## Ground Rules
- Commit: \`feat(x): <s>\`

### Task 1: only task
**Contract:** Needs: none | Offers: \`f()\`
**Touches:** src/a.ts (new)
**Flips:** on, from off
- [ ] do it -> proof
  \`\`\`ts
  // - [ ] TBD, an example rather than a step
  \`\`\`
`);
		expect(r.out).not.toMatch(/TBD/);
		expect(r.code).toBe(0);
	});
});

describe("overlapping Touches", () => {
	// Serialising the one pair reported still leaves the other two overlapping,
	// which is the corrupted concurrent run Touches exists to prevent.
	test("names every task sharing a path, not one pair of them", () => {
		const out = validate(`# Plan: x

## Ground Rules
- Commit: \`feat(x): <s>\`

### Task 1: a
**Contract:** Needs: none | Offers: \`f()\`
**Touches:** src/shared.ts (edit)
- [ ] do -> p

### Task 2: b
**Contract:** Needs: none | Offers: none
**Touches:** src/shared.ts (edit)
- [ ] do -> p

### Task 3: c
**Contract:** Needs: none | Offers: none
**Touches:** src/shared.ts (edit)
**Flips:** on, from off
- [ ] do -> p
`).out;
		const line = out.split("\n").find((l) => l.includes("src/shared.ts")) ?? "";
		for (const id of ["1", "2", "3"]) expect(line).toContain(id);
	});
});

describe("import round two", () => {
	const STATUS = join(import.meta.dir, "..", "skills", "sluice", "scripts", "status.sh");

	function repoWithRun(): string {
		const dir = mkdtempSync(join(tmpdir(), "sluice-import2-"));
		Bun.spawnSync({ cmd: ["bash", STATUS, "init", "--topic", "widget", "--channel", "deep", "--dir", dir] });
		return dir;
	}
	function imp(dir: string, body: string, ...flags: string[]) {
		const proc = Bun.spawnSync({
			cmd: ["bash", SCRIPT, "import", planFile(body), "--dir", dir, ...flags],
			timeout: 10000,
		});
		return { code: proc.exitCode, out: proc.stdout.toString(), err: proc.stderr.toString() };
	}
	function tasks(dir: string) {
		return JSON.parse(readFileSync(join(dir, ".sluice", "run.json"), "utf8")).tasks;
	}

	const WITH_MODEL = broken(
		"**Touches:** src/widget.ts (new) | tests/widget.test.ts (test)\n",
		"**Touches:** src/widget.ts (new) | tests/widget.test.ts (test)\n**Model:** cheaper, the contract is exact\n",
	);

	// The plan marks that a task is mechanical; pre-flight ratifies which model it
	// actually runs on. Re-import replacing that answer with a placeholder rewinds
	// the one decision the partner was asked to price.
	test("does not overwrite a model already recorded against a task", () => {
		const dir = repoWithRun();
		imp(dir, WITH_MODEL);
		Bun.spawnSync({ cmd: ["bash", STATUS, "task", "1", "--model", "claude-haiku-4-5", "--dir", dir] });

		imp(dir, WITH_MODEL);
		expect(tasks(dir)[0]).toMatchObject({ id: 1, model: "claude-haiku-4-5" });
	});

	test("still marks a task the plan flagged and the run has not answered for", () => {
		const dir = repoWithRun();
		imp(dir, WITH_MODEL);
		expect(tasks(dir)[0]).toHaveProperty("model");
	});

	// The header promised a tier. Flips and Review are the two the plan settles;
	// the rest turn on task shape and stay for the tier table to decide.
	test("records tier 3 for the task carrying Flips", () => {
		const dir = repoWithRun();
		imp(dir, GOOD);
		expect(tasks(dir)[1]).toMatchObject({ id: 2, tier: 3 });
	});

	test("records tier 3 for a task the plan flagged for Review", () => {
		const dir = repoWithRun();
		imp(
			dir,
			broken(
				"**Touches:** src/widget.ts (new) | tests/widget.test.ts (test)\n",
				"**Touches:** src/widget.ts (new) | tests/widget.test.ts (test)\n**Review:** auth\n",
			),
		);
		expect(tasks(dir)[0]).toMatchObject({ id: 1, tier: 3 });
	});

	// The tier is derived rather than left unset, since an absent tier read as zero
	// to the review-debt count. GOOD's task 1 only creates files and ships a test,
	// which is tier 0 on Touches alone, but task 2 is built blind against its
	// Offers, and the tier table makes that tier 1: "modified existing code, or
	// later tasks build on it".
	test("floors a task at what its Touches and its contract graph imply", () => {
		const dir = repoWithRun();
		imp(dir, GOOD);
		expect(tasks(dir)[0]).toMatchObject({ id: 1, tier: 1 });
		expect(tasks(dir)[1]).toMatchObject({ id: 2, tier: 3 });
	});

	// Printed on the --force path, the advice to pass --force reads as a refusal
	// that then went ahead anyway.
	test("--force says it proceeded rather than advising --force", () => {
		const r = imp(dir_force(), broken("**Flips:** the CLI renders widgets, from printing nothing\n", ""), "--force");
		expect(r.code).toBe(0);
		expect(r.err).not.toMatch(/re-run with --force/);
		expect(r.err + r.out).toMatch(/anyway|proceed|--force/i);
	});

	function dir_force(): string {
		return repoWithRun();
	}
});

// A debt counter that can only see tier 3 is blind to two thirds of what the tier
// table promises. The Touches annotations already say enough to floor the tier:
// an (edit) means existing code changed, and no (test) means nothing executable
// covers the task.
describe("tier derived from Touches", () => {
	function task(touches: string, extra = ""): string {
		return `# Plan: x

## Ground Rules
- Commit: \`feat(x): <s>\`

### Task 1: under test
**Contract:** Needs: none | Offers: \`f()\`
**Touches:** ${touches}
${extra}- [ ] do it -> proof

### Task 2: the flip
**Contract:** Needs: none | Offers: none
**Touches:** src/z.ts (edit)
**Flips:** on, from off
- [ ] do it -> proof
`;
	}

	const STATUS = join(import.meta.dir, "..", "skills", "sluice", "scripts", "status.sh");
	function tierOf(body: string): number | undefined {
		const dir = mkdtempSync(join(tmpdir(), "sluice-tier-"));
		Bun.spawnSync({ cmd: ["bash", STATUS, "init", "--topic", "t", "--channel", "deep", "--dir", dir] });
		Bun.spawnSync({ cmd: ["bash", SCRIPT, "import", planFile(body), "--dir", dir], timeout: 10000 });
		return JSON.parse(readFileSync(join(dir, ".sluice", "run.json"), "utf8")).tasks[0].tier;
	}

	test("created files with a test are tier 0, needing no dispatch", () => {
		expect(tierOf(task("src/a.ts (new) | tests/a.test.ts (test)"))).toBe(0);
	});

	test("an edited path is tier 1, since existing code changed", () => {
		expect(tierOf(task("src/a.ts (edit) | tests/a.test.ts (test)"))).toBe(1);
	});

	// The row the tier table exists for: prose and config, where a stat confirms
	// nothing about whether the words are true.
	test("no test path is tier 2, since nothing executable covers it", () => {
		expect(tierOf(task("docs/adr/0001.md (new)"))).toBe(2);
	});

	test("an edit with no test takes the higher of the two", () => {
		expect(tierOf(task("README.md (edit)"))).toBe(2);
	});

	test("a Review flag still wins at 3", () => {
		expect(tierOf(task("src/a.ts (new) | tests/a.test.ts (test)", "**Review:** auth\n"))).toBe(3);
	});

	test("so does the flip", () => {
		const dir = mkdtempSync(join(tmpdir(), "sluice-tier-"));
		Bun.spawnSync({ cmd: ["bash", STATUS, "init", "--topic", "t", "--channel", "deep", "--dir", dir] });
		Bun.spawnSync({ cmd: ["bash", SCRIPT, "import", planFile(task("src/a.ts (new) | t/a.test.ts (test)")), "--dir", dir], timeout: 10000 });
		expect(JSON.parse(readFileSync(join(dir, ".sluice", "run.json"), "utf8")).tasks[1].tier).toBe(3);
	});

	// The plan's own tier marks are a floor, not a ceiling: the table says a task
	// matching more than one row takes the highest.
	test("validate reports the derived tier so the plan can be read against it", () => {
		const out = validate(task("src/a.ts (edit) | tests/a.test.ts (test)")).out;
		expect(out).toMatch(/tier/i);
	});
});

// Round three. The tier derivation shipped with the debt counter treating it as
// ground truth, which makes every under-tiering a review nobody is owed.
describe("tier derivation, corrected", () => {
	const STATUS = join(import.meta.dir, "..", "skills", "sluice", "scripts", "status.sh");

	function two(touches1: string, offers1 = "`f()`", needs2 = "none"): string {
		return `# Plan: x

## Ground Rules
- Commit: \`feat(x): <s>\`

### Task 1: producer
**Contract:** Needs: none | Offers: ${offers1}
**Touches:** ${touches1}
- [ ] do it -> proof

### Task 2: the flip
**Contract:** Needs: ${needs2} | Offers: none
**Touches:** src/z.ts (edit)
**Flips:** on, from off
- [ ] do it -> proof
`;
	}

	function seedRun(body: string) {
		const dir = mkdtempSync(join(tmpdir(), "sluice-tier3-"));
		Bun.spawnSync({ cmd: ["bash", STATUS, "init", "--topic", "t", "--channel", "deep", "--dir", dir] });
		Bun.spawnSync({ cmd: ["bash", SCRIPT, "import", planFile(body), "--dir", dir], timeout: 10000 });
		return dir;
	}
	const rows = (dir: string) => JSON.parse(readFileSync(join(dir, ".sluice", "run.json"), "utf8")).tasks;

	// The tier table takes the highest row a task matches, so a hand-raised tier is
	// a decision. Re-import lowering it back silently un-decides it, and the task
	// then drops out of the review debt it was owed.
	test("a hand-raised tier survives re-import", () => {
		const body = two("src/a.ts (new) | tests/a.test.ts (test)");
		const dir = seedRun(body);
		Bun.spawnSync({ cmd: ["bash", STATUS, "task", "1", "--tier", "3", "--dir", dir] });
		expect(rows(dir)[0].tier).toBe(3);

		Bun.spawnSync({ cmd: ["bash", SCRIPT, "import", planFile(body), "--dir", dir], timeout: 10000 });
		expect(rows(dir)[0].tier).toBe(3);
	});

	test("but a derived tier above what is recorded still raises it", () => {
		const dir = seedRun(two("src/a.ts (new) | tests/a.test.ts (test)"));
		expect(rows(dir)[0].tier).toBe(0);

		const harder = two("src/a.ts (edit) | tests/a.test.ts (test)");
		Bun.spawnSync({ cmd: ["bash", SCRIPT, "import", planFile(harder), "--dir", dir], timeout: 10000 });
		expect(rows(dir)[0].tier).toBe(1);
	});

	// The table's tier 1 is "modified existing code, OR later tasks build on it".
	// Only the first half was implemented, so the task whose Offers three others
	// were built blind against was the one nobody reviewed.
	test("a task whose Offers a later task Needs is tier 1", () => {
		const dir = seedRun(two("src/a.ts (new) | tests/a.test.ts (test)", "`f()`", "`f()`"));
		expect(rows(dir)[0].tier).toBe(1);
	});

	test("but not when nothing later needs it", () => {
		const dir = seedRun(two("src/a.ts (new) | tests/a.test.ts (test)", "`f()`", "none"));
		expect(rows(dir)[0].tier).toBe(0);
	});

	// Under-tiering is the unsafe direction, and an annotation the parser does not
	// recognise reads as "no edit here" rather than as a mistake.
	test.each([
		["a forgotten annotation", "src/a.ts | tests/a.test.ts (test)"],
		["an annotation with extra text", "src/a.ts (edit, plus notes) | tests/a.test.ts (test)"],
		["a synonym the format does not use", "src/a.ts (modified) | tests/a.test.ts (test)"],
	])("validate warns on %s", (_label, touches) => {
		const r = validate(two(touches));
		expect(r.out).toMatch(/warn/);
		expect(r.out).toMatch(/annotation|new|edit|test/i);
	});

	test("a Touches line spelled correctly draws no annotation warning", () => {
		const out = validate(two("src/a.ts (edit) | tests/a.test.ts (test)")).out;
		expect(out).not.toMatch(/annotation/i);
	});
});

describe("plan.sh usage stays true", () => {
	const SRC = readFileSync(SCRIPT, "utf8");
	const header = SRC.slice(0, SRC.indexOf("set -uo pipefail"));

	// usage() prints this block, so a stale claim here is the one a caller reads.
	test("does not still promise only one derived tier", () => {
		expect(header).not.toMatch(/one tier the plan settles/i);
	});

	test("names what re-import preserves, including the review mark", () => {
		expect(header).toMatch(/re-?run|re-?import/i);
		expect(header).toMatch(/review/i);
	});
});

// Round four. The contract-graph half of tier 1 shipped with a hole, and import
// could add a flip but never move one.
describe("tier 1 from the contract graph, corrected", () => {
	const STATUS = join(import.meta.dir, "..", "skills", "sluice", "scripts", "status.sh");

	function seedRun(body: string) {
		const dir = mkdtempSync(join(tmpdir(), "sluice-graph-"));
		Bun.spawnSync({ cmd: ["bash", STATUS, "init", "--topic", "t", "--channel", "deep", "--dir", dir] });
		Bun.spawnSync({ cmd: ["bash", SCRIPT, "import", planFile(body), "--dir", dir], timeout: 10000 });
		return dir;
	}
	const tierOf = (dir: string, id: number) =>
		JSON.parse(readFileSync(join(dir, ".sluice", "run.json"), "utf8")).tasks.find(
			(t: { id: number }) => t.id === id,
		)?.tier;

	// The consumer set was collapsed to its minimum, so one early consumer hid
	// every later one and the task nobody else could see dropped to tier 0.
	const EARLY_AND_LATE = `# Plan: x

## Ground Rules
- Commit: \`feat(x): <s>\`

### Task 1: unrelated
**Contract:** Needs: none | Offers: none
**Touches:** src/one.ts (new) | tests/one.test.ts (test)
- [ ] do -> p

### Task 2: early consumer
**Contract:** Needs: \`helperFn()\` | Offers: none
**Touches:** src/two.ts (new) | tests/two.test.ts (test)
- [ ] do -> p

### Task 3: the producer
**Contract:** Needs: none | Offers: \`helperFn()\`
**Touches:** src/three.ts (new) | tests/three.test.ts (test)
- [ ] do -> p

### Task 4: later consumer
**Contract:** Needs: \`helperFn()\` | Offers: none
**Touches:** src/four.ts (new) | tests/four.test.ts (test)
- [ ] do -> p

### Task 5: the flip
**Contract:** Needs: none | Offers: none
**Touches:** src/five.ts (edit)
**Flips:** on, from off
- [ ] do -> p
`;

	test("any later consumer earns tier 1, not only the earliest", () => {
		expect(tierOf(seedRun(EARLY_AND_LATE), 3)).toBe(1);
	});

	test("a task nothing later consumes stays where its Touches put it", () => {
		expect(tierOf(seedRun(EARLY_AND_LATE), 1)).toBe(0);
	});

	// Two tasks offering a shared return type is the ordinary case once Offers is
	// read generously, and it used to mask the later one.
	test("a shared symbol name does not hide the later producer", () => {
		const body = `# Plan: x

## Ground Rules
- Commit: \`feat(x): <s>\`

### Task 1: first producer
**Contract:** Needs: none | Offers: \`parseOne(p)\` -> \`PlanDoc\`
**Touches:** src/one.ts (new) | tests/one.test.ts (test)
- [ ] do -> p

### Task 2: consumer
**Contract:** Needs: \`PlanDoc\` | Offers: none
**Touches:** src/two.ts (new) | tests/two.test.ts (test)
- [ ] do -> p

### Task 3: second producer
**Contract:** Needs: none | Offers: \`parseTwo(p)\` -> \`PlanDoc\`
**Touches:** src/three.ts (new) | tests/three.test.ts (test)
- [ ] do -> p

### Task 4: later consumer
**Contract:** Needs: \`PlanDoc\` | Offers: none
**Touches:** src/four.ts (new) | tests/four.test.ts (test)
- [ ] do -> p

### Task 5: the flip
**Contract:** Needs: none | Offers: none
**Touches:** src/five.ts (edit)
**Flips:** on, from off
- [ ] do -> p
`;
		expect(tierOf(seedRun(body), 3)).toBe(1);
	});

	// The format has no "edited test" annotation, so a task that only changes an
	// existing suite reads as creating one and owes no review.
	test("a task whose only path is a test still owes a review", () => {
		const body = `# Plan: x

## Ground Rules
- Commit: \`feat(x): <s>\`

### Task 1: add cases to the existing suite
**Contract:** Needs: none | Offers: none
**Touches:** tests/existing.test.ts (test)
- [ ] add cases -> they pass

### Task 2: the flip
**Contract:** Needs: none | Offers: none
**Touches:** src/z.ts (edit)
**Flips:** on, from off
- [ ] do -> p
`;
		expect(tierOf(seedRun(body), 1)).toBeGreaterThanOrEqual(1);
	});

	// The tier table's row 1 is what the run is checked against, so a task holding
	// a stale flip stays pinned at 3 forever and the render names the wrong
	// milestone. Import has to be able to move a flip, not only add one.
	test("moving the flip in the plan moves it in the run", () => {
		const at = (n: number) => `# Plan: x

## Ground Rules
- Commit: \`feat(x): <s>\`

### Task 1: first
**Contract:** Needs: none | Offers: none
**Touches:** src/one.ts (edit)
${n === 1 ? "**Flips:** on, from off\n" : ""}- [ ] do -> p

### Task 2: second
**Contract:** Needs: none | Offers: none
**Touches:** src/two.ts (edit)
${n === 2 ? "**Flips:** on, from off\n" : ""}- [ ] do -> p
`;
		const dir = seedRun(at(1));
		Bun.spawnSync({ cmd: ["bash", SCRIPT, "import", planFile(at(2)), "--dir", dir], timeout: 10000 });

		const tasks = JSON.parse(readFileSync(join(dir, ".sluice", "run.json"), "utf8")).tasks;
		expect(tasks.filter((t: { flips?: boolean }) => t.flips)).toHaveLength(1);
		expect(tasks[1]).toMatchObject({ id: 2, flips: true });
		expect(tasks[0]).not.toHaveProperty("flips");
	});

	// The message told the author the tier was under-derived when it was not,
	// which invites a hand-raise that is not needed.
	test("a recognised annotation with trailing text does not claim nothing was edited", () => {
		const out = validate(`# Plan: x

## Ground Rules
- Commit: \`feat(x): <s>\`

### Task 1: one
**Contract:** Needs: none | Offers: none
**Touches:** src/a.ts (edit) and notes | tests/a.test.ts (test)
- [ ] do -> p

### Task 2: the flip
**Contract:** Needs: none | Offers: none
**Touches:** src/z.ts (edit)
**Flips:** on, from off
- [ ] do -> p
`).out;
		expect(out).not.toMatch(/as if nothing was edited/);
	});
});

// Proposal three: the reader nobody served. Deciding a wave means reading the
// graph, which needs Needs, Offers and Touches kept rather than discarded after
// the tier is derived.
describe("import keeps the graph it parses", () => {
	const STATUS = join(import.meta.dir, "..", "skills", "sluice", "scripts", "status.sh");
	const WAVE = `# Plan: x

## Ground Rules
- Commit: \`feat(x): <s>\`

### Task 1: producer
**Contract:** Needs: none | Offers: \`seam(a)\`
**Touches:** src/one.ts (new) | tests/one.test.ts (test)
- [ ] do -> p

### Task 2: consumer
**Contract:** Needs: \`seam(a)\` | Offers: none
**Touches:** src/two.ts (edit)
- [ ] do -> p

### Task 3: independent
**Contract:** Needs: none | Offers: none
**Touches:** src/two.ts (edit)
- [ ] do -> p

### Task 4: the flip
**Contract:** Needs: none | Offers: none
**Touches:** src/four.ts (edit)
**Flips:** on, from off
- [ ] do -> p
`;

	function seeded() {
		const dir = mkdtempSync(join(tmpdir(), "sluice-graph2-"));
		Bun.spawnSync({ cmd: ["bash", STATUS, "init", "--topic", "t", "--channel", "deep", "--dir", dir] });
		Bun.spawnSync({ cmd: ["bash", SCRIPT, "import", planFile(WAVE), "--dir", dir], timeout: 10000 });
		return dir;
	}
	const rows = (dir: string) => JSON.parse(readFileSync(join(dir, ".sluice", "run.json"), "utf8")).tasks;

	// Containment, not equality. Offers is read generously so a return shape is on
	// offer as well as the function; a parameter name riding along is permitted by
	// that design. Repeats are not, so both lists are deduped.
	test("records what each task needs", () => {
		const t = rows(seeded())[1];
		expect(t.id).toBe(2);
		expect(t.needs).toContain("seam");
		expect(new Set(t.needs).size).toBe(t.needs.length);
	});

	test("and what it offers", () => {
		const t = rows(seeded())[0];
		expect(t.id).toBe(1);
		expect(t.offers).toContain("seam");
		expect(new Set(t.offers).size).toBe(t.offers.length);
	});

	test("and the paths it touches, which is what decides concurrency", () => {
		expect(rows(seeded())[2]).toMatchObject({ id: 3, touches: ["src/two.ts"] });
	});

	test("a task with an empty side records no key rather than an empty list", () => {
		const t = rows(seeded())[3];
		expect(t).toMatchObject({ id: 4 });
		expect(t).not.toHaveProperty("needs");
	});
});

// A return shape on the demand side pulls in whatever it is spelled with, and a
// primitive is not a symbol any task creates. Listing it as a dependency is noise
// in `ready` and a false error waiting to happen.
describe("primitives are not dependencies", () => {
	const STATUS = join(import.meta.dir, "..", "skills", "sluice", "scripts", "status.sh");
	function needsOf(needs: string) {
		const dir = mkdtempSync(join(tmpdir(), "sluice-prim-"));
		Bun.spawnSync({ cmd: ["bash", STATUS, "init", "--topic", "t", "--channel", "deep", "--dir", dir] });
		const body = `# Plan: x

## Ground Rules
- Commit: \`feat(x): <s>\`

### Task 1: producer
**Contract:** Needs: none | Offers: \`writeBundle(a, b)\`, \`f(x)\`, \`parse(p)\`, \`PlanDoc\`
**Touches:** src/one.ts (new) | tests/one.test.ts (test)
- [ ] do -> p

### Task 2: consumer
**Contract:** Needs: ${needs} | Offers: none
**Touches:** src/two.ts (edit)
**Flips:** on, from off
- [ ] do -> p
`;
		const r = Bun.spawnSync({ cmd: ["bash", SCRIPT, "import", planFile(body), "--dir", dir], timeout: 10000 });
		// A refused import leaves no rows, which would make every assertion below
		// pass vacuously. Fail loudly instead.
		if (r.exitCode !== 0) throw new Error(`import refused: ${r.stderr.toString()}`);
		const [, consumer] = JSON.parse(readFileSync(join(dir, ".sluice", "run.json"), "utf8")).tasks;
		return consumer.needs ?? [];
	}

	test("a return shape's primitive is not recorded as needed", () => {
		const needs = needsOf("`writeBundle(a, b)` -> `string[]`");
		expect(needs).toContain("writeBundle");
		expect(needs).not.toContain("string");
	});

	test.each([["number"], ["boolean"], ["void"], ["any"], ["unknown"]])("nor is %s", (prim) => {
		expect(needsOf(`\`f(x)\` -> \`${prim}\``)).not.toContain(prim);
	});

	test("but a real type name still is", () => {
		expect(needsOf("`parse(p)` -> `PlanDoc`")).toContain("PlanDoc");
	});
});

// Round five.
describe("graph extraction, corrected again", () => {
	const STATUS = join(import.meta.dir, "..", "skills", "sluice", "scripts", "status.sh");
	function seed(body: string) {
		const dir = mkdtempSync(join(tmpdir(), "sluice-g5-"));
		Bun.spawnSync({ cmd: ["bash", STATUS, "init", "--topic", "t", "--channel", "deep", "--dir", dir] });
		const r = Bun.spawnSync({ cmd: ["bash", SCRIPT, "import", planFile(body), "--dir", dir], timeout: 10000 });
		return { dir, code: r.exitCode, err: r.stderr.toString() };
	}
	const rows = (dir: string) => JSON.parse(readFileSync(join(dir, ".sluice", "run.json"), "utf8")).tasks;

	function two(needs2: string, touches1 = "src/a.ts (new) | tests/a.test.ts (test)"): string {
		return `# Plan: x

## Ground Rules
- Commit: \`feat(x): <s>\`

### Task 1: producer
**Contract:** Needs: none | Offers: \`makeConfig()\` -> \`Config\`
**Touches:** ${touches1}
- [ ] do -> p

### Task 2: the flip
**Contract:** Needs: ${needs2} | Offers: none
**Touches:** src/b.ts (edit)
**Flips:** on, from off
- [ ] do -> p
`;
	}

	// The primitive filter was undone by the fallback beneath it: with every strict
	// candidate filtered out, count stayed zero and the raw half was re-split
	// without the guard.
	test("a lone wrapper type does not become a false dependency", () => {
		expect(validate(two("`Promise<Config>`")).out).not.toMatch(/Needs Promise/);
	});

	// And the meaningful half of a wrapped type is the inner one.
	test("a wrapped type contributes the type it wraps", () => {
		expect(rows(seed(two("`Promise<Config>`")).dir)[1].needs).toContain("Config");
	});

	test.each([["`string`"], ["`Array<Config>`"], ["`void`"]])("%s alone raises no error", (needs) => {
		expect(validate(two(needs)).code).toBe(0);
	});

	// The annotation is tolerated mid-field with a warning, but the path extraction
	// only stripped a trailing one, so the rest of the field became fake paths and
	// serialised a wave that was actually disjoint.
	test("a path is extracted whatever follows its annotation", () => {
		const { dir } = seed(two("none", "src/a.ts (edit) see note | tests/a.test.ts (test)"));
		expect(rows(dir)[0].touches).toEqual(["src/a.ts", "tests/a.test.ts"]);
	});

	// Add-only left a removed edge in place, so ready kept reporting a task as
	// waiting on a contract the plan no longer mentions.
	test("re-import clears an edge the plan dropped", () => {
		const { dir } = seed(two("`makeConfig()`"));
		expect(rows(dir)[1].needs).toContain("makeConfig");

		Bun.spawnSync({ cmd: ["bash", SCRIPT, "import", planFile(two("none")), "--dir", dir], timeout: 10000 });
		expect(rows(dir)[1]).not.toHaveProperty("needs");
	});

	test("and clears a Touches path the plan dropped", () => {
		const { dir } = seed(two("none", "src/a.ts (new) | src/gone.ts (edit) | tests/a.test.ts (test)"));
		expect(rows(dir)[0].touches).toContain("src/gone.ts");

		Bun.spawnSync({ cmd: ["bash", SCRIPT, "import", planFile(two("none")), "--dir", dir], timeout: 10000 });
		expect(rows(dir)[0].touches).not.toContain("src/gone.ts");
	});
});
