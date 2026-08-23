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

	test("leaves the tier unset where the plan does not settle it", () => {
		const dir = repoWithRun();
		imp(dir, GOOD);
		expect(tasks(dir)[0]).not.toHaveProperty("tier");
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
