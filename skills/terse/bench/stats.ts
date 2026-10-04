export type RunRecord = {
	promptId: string;
	category: string;
	arm: string;
	sample: number;
	model: string;
	outputTokens: number;
	thinkingTokens: number;
	/** Output tokens the reader sees: total output less thinking. */
	visibleTokens: number;
	words: number;
	costUsd: number;
	turns: number;
	isError: boolean;
	/** For task prompts, whether the fixture's check passed afterwards; null otherwise. */
	checkPassed: boolean | null;
	result: string;
	/** sha1 of the arm's system-prompt addition, so a results file names the SKILL.md it measured. Null for plain. */
	promptSha: string | null;
	cliVersion: string;
};

/** What the judge returns, about two responses shown in a random order. */
export type JudgeOutput = {
	same_conclusion: boolean;
	missing_from_1: string[];
	missing_from_2: string[];
	incorrect_in_1: string[];
	incorrect_in_2: string[];
	easier_to_read: "1" | "2" | "same";
};

/** The judge's output, read back as reference (the plain reply) against candidate. */
export type Verdict = {
	sameConclusion: boolean;
	lostFromCandidate: string[];
	addedByCandidate: string[];
	candidateIncorrect: string[];
	referenceIncorrect: string[];
	easierToRead: "reference" | "candidate" | "same";
};

export type JudgedPair = { promptId: string; arm: string; sample: number; verdict: Verdict };

export type ArmSummary = {
	arm: string;
	runs: number;
	errors: number;
	meanVisibleTokens: number;
	meanThinkingTokens: number;
	meanWords: number;
	meanCostUsd: number;
	/** Mean over prompts of (this arm's mean visible tokens / plain's), so long answers don't dominate. */
	ratioToPlain: number | null;
	checksPassed: number;
	checksRun: number;
	judged: number;
	lostFactRate: number | null;
	conclusionChangedRate: number | null;
	candidateIncorrectRate: number | null;
	readability: { candidate: number; same: number; reference: number };
};

/**
 * With `swapped` false the judge saw the reference as response 1 and the
 * candidate as response 2; with it true, the other way round.
 */
export function toVerdict(raw: JudgeOutput, swapped: boolean): Verdict {
	const reference = swapped ? "2" : "1";
	const readability =
		raw.easier_to_read === "same" ? "same" : raw.easier_to_read === reference ? "reference" : "candidate";
	return {
		sameConclusion: raw.same_conclusion,
		lostFromCandidate: swapped ? raw.missing_from_1 : raw.missing_from_2,
		addedByCandidate: swapped ? raw.missing_from_2 : raw.missing_from_1,
		candidateIncorrect: swapped ? raw.incorrect_in_1 : raw.incorrect_in_2,
		referenceIncorrect: swapped ? raw.incorrect_in_2 : raw.incorrect_in_1,
		easierToRead: readability,
	};
}

function mean(values: number[]): number {
	return values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;
}

function share(pairs: JudgedPair[], hit: (v: Verdict) => boolean): number | null {
	return pairs.length === 0 ? null : pairs.filter((p) => hit(p.verdict)).length / pairs.length;
}

function meanVisibleByPrompt(runs: RunRecord[]): Map<string, number> {
	const byPrompt = new Map<string, number[]>();
	for (const r of runs) byPrompt.set(r.promptId, [...(byPrompt.get(r.promptId) ?? []), r.visibleTokens]);
	return new Map([...byPrompt].map(([id, values]) => [id, mean(values)]));
}

export function summariseArms(runs: RunRecord[], judged: JudgedPair[]): ArmSummary[] {
	const ok = runs.filter((r) => !r.isError);
	const plainByPrompt = meanVisibleByPrompt(ok.filter((r) => r.arm === "plain"));
	const arms = [...new Set(runs.map((r) => r.arm))];

	return arms.map((arm) => {
		const armRuns = ok.filter((r) => r.arm === arm);
		const ratios = [...meanVisibleByPrompt(armRuns)]
			.filter(([id]) => (plainByPrompt.get(id) ?? 0) > 0)
			.map(([id, visible]) => visible / (plainByPrompt.get(id) as number));
		// Errored runs stay in: a task that hit the turn or budget cap failed it.
		const checks = runs.filter((r) => r.arm === arm && r.checkPassed !== null);
		const pairs = judged.filter((p) => p.arm === arm);
		return {
			arm,
			runs: armRuns.length,
			errors: runs.filter((r) => r.arm === arm && r.isError).length,
			meanVisibleTokens: mean(armRuns.map((r) => r.visibleTokens)),
			meanThinkingTokens: mean(armRuns.map((r) => r.thinkingTokens)),
			meanWords: mean(armRuns.map((r) => r.words)),
			meanCostUsd: mean(armRuns.map((r) => r.costUsd)),
			ratioToPlain: ratios.length === 0 ? null : mean(ratios),
			checksPassed: checks.filter((r) => r.checkPassed).length,
			checksRun: checks.length,
			judged: pairs.length,
			lostFactRate: share(pairs, (v) => v.lostFromCandidate.length > 0),
			conclusionChangedRate: share(pairs, (v) => !v.sameConclusion),
			candidateIncorrectRate: share(pairs, (v) => v.candidateIncorrect.length > 0),
			readability: {
				candidate: pairs.filter((p) => p.verdict.easierToRead === "candidate").length,
				same: pairs.filter((p) => p.verdict.easierToRead === "same").length,
				reference: pairs.filter((p) => p.verdict.easierToRead === "reference").length,
			},
		};
	});
}
