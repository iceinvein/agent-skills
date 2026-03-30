---
name: evolution-analyzer
description: Use when making significant changes to established codebases, when complexity is growing over time, when the same areas keep needing rework, or when a system feels increasingly resistant to change. Trigger on "this keeps getting harder to change", "we keep touching the same files", "technical debt", or post-mortem analysis of change patterns. NOT for greenfield projects or one-off scripts.
---

# Lehman's Evolution Analyzer

A change-impact framework based on Meir Lehman's *Laws of Software Evolution*. Software systems that are used must be continually adapted — but each adaptation increases complexity unless work is done to reduce it. This skill forces the agent to think beyond the immediate change and evaluate its impact on the system's evolutionary trajectory.

**Core principle:** Every change exists on a trajectory. A system is either getting easier to change or harder to change — there is no neutral. The question isn't "does this change work?" but "does this change leave the system healthier or sicker?"

## When to Use

- Making significant changes to codebases with meaningful history
- When complexity is growing and changes are getting harder
- When the same code areas keep needing rework
- "This keeps getting harder to change" / "Technical debt"
- Post-mortem: why did this change have such a large blast radius?
- Evaluating refactoring proposals: is this cleanup worth the disruption?

**Not for:** Greenfield projects (no evolutionary history to analyze), prototypes, one-off scripts, or throwaway code with no expected lifespan.

## The Process

### 1. Assess Through Lehman's Laws

Evaluate the change against the laws most relevant to the situation:

**I. Continuing Change** — A system must be continually adapted to its environment, or it becomes progressively less satisfactory.
- Is this change *adapting* the system to a real environmental shift (new requirement, changed dependency, evolved user need)?
- Or is it *accreting* — adding without adapting? Features bolted on without integrating into the system's conceptual model?
- Adaptation improves alignment between the system and its environment. Accretion adds weight without alignment.

**II. Increasing Complexity** — As a system evolves, its complexity increases unless work is specifically done to maintain or reduce it.
- Is this change reducing complexity debt, or adding to it?
- If adding: what *compensating simplification* accompanies the change? (If none, complexity is growing unchecked.)
- Every change that adds complexity without paying some down is borrowing from the future.

**III. Self-Regulation** — The system evolution process is self-regulating, with statistically determinable trends and invariances.
- Large systems evolve at a pace determined by their structure, team, and process — not by management decree.
- Massive rewrites almost always fail because they fight the system's natural evolution rate.
- Incremental, well-directed changes succeed because they work with the system's grain.

**IV. Conservation of Familiarity** — The rate of effective change is limited by the team's ability to absorb novelty.
- How much novelty does this change introduce? New patterns, new abstractions, new conventions?
- Will the team still recognize this area of the codebase after the change?
- Changes that exceed the team's absorption rate create unknown unknowns — the team no longer fully understands what they have.

**V. Continuing Growth** — Functional content must continually increase to maintain user satisfaction.
- Is the system's *structure* keeping pace with its *functionality*?
- Growth without structural investment creates fragility: the system can do more but is harder to extend.
- Structural investment without growth is gold-plating: the architecture is beautiful but doesn't serve more users.

**VI. Declining Quality** — Unless rigorously adapted to account for environmental changes, system quality will appear to decline.
- Is the environment (dependencies, platforms, security requirements, user expectations) evolving in ways this code isn't keeping up with?
- A codebase that was excellent in 2020 may be declining in 2026 — not because it got worse, but because the world moved on.

### 2. Trajectory Assessment

Look at the area of code being changed:

**Churn analysis:**
- How often has this area been modified recently? High churn signals evolution pressure — this area is under active adaptation or struggling with accumulated debt.
- Is each successive change *smaller and easier* (debt being paid down) or *larger and harder* (debt compounding)?
- Are changes concentrated in a few files (hotspots) or spread evenly?

**Direction of travel:**
- **Improving trajectory** — recent changes have simplified, clarified, or better-aligned this area. Structure is keeping pace with functionality. The next change will be easier.
- **Stable trajectory** — changes are absorbed without significant complexity growth. Maintenance work is keeping pace.
- **Degrading trajectory** — each change makes the next one harder. Workarounds accumulate. The area resists modification. Debt is compounding.

### 3. Evolution Impact Report

```
EVOLUTION: [what's changing]
  Law:         [which Lehman law is most relevant to this change]
  Trajectory:  [improving / stable / degrading — based on recent change patterns]
  This change: [adapting / accreting / simplifying]
  Debt impact: [adds debt / neutral / pays down debt]
  Familiarity: [low / moderate / high novelty introduced]
  Recommendation: [specific action to maintain or improve evolutionary health]
```

Example:

```
EVOLUTION: Add webhook retry logic to notification service
  Law:         II (Increasing Complexity) — new retry state machine adds significant logic
  Trajectory:  degrading — notification service has been modified 12 times in 3 months, each change harder
  This change: accreting — retry logic bolted onto existing notification flow without simplifying
  Debt impact: adds debt — new state (retry count, backoff, dead letter) interleaved with existing notification state
  Familiarity: moderate — retry pattern is known, but this implementation adds 3 new concepts to the module
  Recommendation: Before adding retry, extract notification dispatch into its own module (pay down debt first). Then add retry as a wrapper around the clean dispatch interface — the retry logic stays simple and the notification logic doesn't grow.
```

## Interaction Model

Decision engine with Socratic hook. The agent runs the analysis independently, but asks the human for context it can't derive from code:

- "How often does this area of the code change? What's driving those changes?"
- "Is this a temporary fix or a permanent direction?"
- "Has this area been getting harder to work with over time?"

Change frequency and motivation are domain knowledge that code history only partially reveals.

## Guard Rails

**Don't block progress with analysis.** The evolution assessment is a lens, not a gate. A change that adds debt may still be the right choice — sometimes you need to ship. The skill ensures the decision is *informed*, not that it's *yours*.

**Not every change needs a full assessment.** Bug fixes, typo corrections, dependency updates — these don't need Lehman analysis. Reserve it for changes that significantly alter behavior, structure, or complexity.

**Evolution is empirical, not prescriptive.** Lehman's laws are derived from observation of real systems, not from first principles. They describe tendencies, not iron laws. Use them to inform judgment, not to replace it.

**Acknowledge trade-offs.** Sometimes the right move is to add debt now and pay it down later. The skill's job is to make the debt *visible and intentional*, not to prevent all debt.

**Don't confuse old with declining.** A system can be old and healthy (stable trajectory, low churn, still meeting needs) or new and declining (rapid complexity growth, every change harder). Age is not the relevant variable — trajectory is.

## Lehman's Laws (Complete Reference)

1. **Continuing Change** — Systems must be adapted or they become less satisfactory
2. **Increasing Complexity** — Complexity increases unless work is done to reduce it
3. **Self-Regulation** — Evolution is self-regulating with statistically determinable trends
4. **Conservation of Organizational Stability** — Average effective activity rate is invariant over system lifetime
5. **Conservation of Familiarity** — Effective change rate is limited by novelty absorption
6. **Continuing Growth** — Functionality must grow to maintain user satisfaction
7. **Declining Quality** — Quality declines unless maintained against environmental change
8. **Feedback System** — Evolution processes are multi-level, multi-loop, multi-agent feedback systems

Laws I-III and V-VII are most actionable for individual changes. Laws IV and VIII are more relevant to process and organizational analysis.

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Using Lehman to argue against all change | The first law says systems MUST change. Resistance to change is itself a form of decline. |
| Treating all debt as bad | Debt is a tool. Intentional, visible debt with a paydown plan is fine. Invisible, compounding debt is the problem. |
| Analyzing greenfield code through evolution lens | Lehman's laws apply to evolving systems, not new ones. Don't slow down a new project with trajectory analysis. |
| Ignoring the team's familiarity budget | A technically perfect refactoring that the team can't absorb is worse than incremental improvement they can follow. |
| Recommending "big rewrite" to fix trajectory | Law III (Self-Regulation) predicts big rewrites fail. Recommend incremental course corrections instead. |
