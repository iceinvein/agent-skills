import { describe, expect, test } from "bun:test";
import {
	type JudgeOutput,
	type RunRecord,
	type Verdict,
	summariseArms,
	toVerdict,
} from "../skills/terse/bench/stats";

function run(promptId: string, arm: string, sample: number, visibleTokens: number): RunRecord {
	return {
		promptId,
		category: "explain",
		arm,
		sample,
		model: "m",
		outputTokens: visibleTokens + 50,
		thinkingTokens: 50,
		visibleTokens,
		words: visibleTokens,
		costUsd: 0.01,
		turns: 1,
		isError: false,
		checkPassed: null,
		result: "",
		promptSha: null,
		cliVersion: "test",
	};
}

const judged: JudgeOutput = {
	same_conclusion: true,
	missing_from_1: ["a"],
	missing_from_2: [],
	incorrect_in_1: [],
	incorrect_in_2: ["b"],
	easier_to_read: "1",
};

describe("toVerdict", () => {
	test("reads response 1 as the reference when the pair was not swapped", () => {
		expect(toVerdict(judged, false)).toEqual({
			sameConclusion: true,
			lostFromCandidate: [],
			addedByCandidate: ["a"],
			candidateIncorrect: ["b"],
			referenceIncorrect: [],
			easierToRead: "reference",
		});
	});

	test("reads response 1 as the candidate when the pair was swapped", () => {
		expect(toVerdict(judged, true)).toEqual({
			sameConclusion: true,
			lostFromCandidate: ["a"],
			addedByCandidate: [],
			candidateIncorrect: [],
			referenceIncorrect: ["b"],
			easierToRead: "candidate",
		});
	});

	test("keeps a tie on readability as a tie either way round", () => {
		const tie = { ...judged, easier_to_read: "same" as const };
		expect(toVerdict(tie, true).easierToRead).toBe("same");
		expect(toVerdict(tie, false).easierToRead).toBe("same");
	});
});

describe("summariseArms", () => {
	test("reports each arm's change against plain as the mean of per-prompt ratios", () => {
		// p1: plain 100, terse 50 -> 0.5. p2: plain 200, terse 300 -> 1.5. Mean 1.0.
		const runs = [
			run("p1", "plain", 0, 100),
			run("p1", "terse", 0, 50),
			run("p2", "plain", 0, 200),
			run("p2", "terse", 0, 300),
		];
		const terse = summariseArms(runs, []).find((row) => row.arm === "terse");
		expect(terse?.meanVisibleTokens).toBe(175);
		expect(terse?.ratioToPlain).toBe(1);
	});

	test("averages samples within a prompt before taking the ratio", () => {
		// plain samples 100 and 300 average 200; terse 100 and 100 average 100.
		const runs = [
			run("p1", "plain", 0, 100),
			run("p1", "plain", 1, 300),
			run("p1", "terse", 0, 100),
			run("p1", "terse", 1, 100),
		];
		const terse = summariseArms(runs, []).find((row) => row.arm === "terse");
		expect(terse?.ratioToPlain).toBe(0.5);
	});

	test("leaves errored runs out of the token means and counts them", () => {
		const runs = [
			run("p1", "plain", 0, 100),
			{ ...run("p1", "terse", 0, 9999), isError: true },
			run("p1", "terse", 1, 60),
		];
		const terse = summariseArms(runs, []).find((row) => row.arm === "terse");
		expect(terse?.meanVisibleTokens).toBe(60);
		expect(terse?.errors).toBe(1);
	});

	test("counts an errored task run as a failed check, not a missing one", () => {
		const task = (sample: number, isError: boolean, checkPassed: boolean): RunRecord => ({
			...run("t1", "terse", sample, 100),
			isError,
			checkPassed,
		});
		const terse = summariseArms([task(0, false, true), task(1, true, false)], []).find((row) => row.arm === "terse");
		expect(terse?.checksRun).toBe(2);
		expect(terse?.checksPassed).toBe(1);
	});

	test("reports the share of judged pairs that lost a fact or changed the conclusion", () => {
		const verdict = (lost: string[], same: boolean): Verdict => ({
			sameConclusion: same,
			lostFromCandidate: lost,
			addedByCandidate: [],
			candidateIncorrect: [],
			referenceIncorrect: [],
			easierToRead: "same",
		});
		const verdicts = [
			{ promptId: "p1", arm: "terse", sample: 0, verdict: verdict(["x"], true) },
			{ promptId: "p1", arm: "terse", sample: 1, verdict: verdict([], true) },
			{ promptId: "p2", arm: "terse", sample: 0, verdict: verdict([], false) },
			{ promptId: "p2", arm: "terse", sample: 1, verdict: verdict([], true) },
		];
		const terse = summariseArms([run("p1", "plain", 0, 1), run("p1", "terse", 0, 1)], verdicts).find(
			(row) => row.arm === "terse",
		);
		expect(terse?.judged).toBe(4);
		expect(terse?.lostFactRate).toBe(0.25);
		expect(terse?.conclusionChangedRate).toBe(0.25);
	});
});
