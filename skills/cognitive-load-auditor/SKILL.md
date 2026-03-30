---
name: cognitive-load-auditor
description: Use when reviewing UI that presents many options, complex forms, dense information displays, or navigation with many paths. Trigger on "this is overwhelming", "too many choices", "the user won't know where to start", or when evaluating whether a UI respects human cognitive limits. Also trigger when building settings pages, dashboards, multi-step forms, or any interface with high information density. NOT for visual styling or aesthetic concerns.
---

# Cognitive Load Auditor

A UI evaluation framework based on Jeff Johnson's *Designing with the Mind in Mind* and the foundational cognitive science laws (Miller, Hick, Fitts). Interfaces must respect human cognitive limits — working memory capacity, decision fatigue, attention allocation, and perceptual processing. An interface that looks "complete" but overloads the user's cognition has failed, regardless of how polished it appears.

**Core principle:** The human brain is the bottleneck. Working memory holds 3-4 chunks. Decision time scales with options. Attention is finite and competitive. Design for how the brain actually works, not for how you wish it worked.

## When to Use

- UI presents many options, controls, or data points on one screen
- Complex forms with many fields
- Dashboards with dense information
- Multi-step flows where users must track state across steps
- Settings pages with many configuration options
- "This is overwhelming" / "Too many choices" / "Where do I start?"
- Navigation with many paths or deep nesting

**Not for:** Visual styling (use Rams' Design Audit), color and typography choices (use Gestalt Reviewer for grouping), accessibility compliance (WCAG), or performance optimization.

## The Process

### 1. Apply the Cognitive Laws

**Miller's Law — Working memory holds 7±2 items (practically 3-4 groups)**
- Count the number of independent items/options/controls visible at once
- If > 7 items in a flat list, the interface is exceeding working memory
- Fix: chunk into 3-5 labeled groups. The groups themselves become the memory items, and users expand into detail as needed.
- Practical target: aim for 3-4 groups on any single screen. Within each group, 3-5 items.

**Hick's Law — Decision time = b × log₂(n + 1)**
- Count the number of choices the user must evaluate before acting
- More choices = longer decision time = higher abandonment
- Fix: reduce visible choices through progressive disclosure, smart defaults, or recommended options
- Key distinction: browsing (showing many items is fine — the user scans, doesn't decide) vs. choosing (fewer options, clearer differentiation)

**Fitts's Law — Time = a + b × log₂(1 + D/W)**
- Primary actions should be large and easy to reach
- Destructive actions should be small and distant from primary actions
- Touch targets: minimum 44×44px (mobile), 32×32px (desktop)
- Related actions should be spatially close to reduce movement

**Cognitive Load Theory — Intrinsic, extraneous, and germane load**
- **Intrinsic load** — the inherent complexity of the task. Can't be reduced, only managed.
- **Extraneous load** — load from poor design. Must be eliminated. Unclear labels, inconsistent patterns, unnecessary steps, ambiguous icons — all add extraneous load.
- **Germane load** — load from learning and schema-building. This is the good load — help users build mental models that transfer to future interactions.
- Goal: minimize extraneous load so the user's cognitive capacity is spent on intrinsic and germane load.

### 2. Audit the Four Channels

**Perception** — Can the user perceive the interface's structure without reading?
- Does the visual hierarchy match the information hierarchy?
- Are primary, secondary, and tertiary elements visually distinct?
- Can the user identify the "starting point" within 2 seconds?
- Are status indicators (success, error, warning, info) immediately distinguishable?

**Attention** — What competes for the user's attention?
- Is the primary action the most visually prominent element?
- How many elements demand attention simultaneously? (Aim for 1 primary focal point)
- Are notifications, badges, and alerts interrupting the main task?
- Does the interface change while the user is reading or deciding? (Auto-refresh, live updates, carousels — all compete for attention)

**Memory** — How much must the user remember?
- Does the user need to remember information from a previous screen to complete the current one?
- Are codes, IDs, or references that the user must recall displayed persistently?
- Does the interface rely on recall ("type the command") or recognition ("pick from this list")?
- **Recognition over recall** — always prefer selection, autocomplete, and visual references over asking the user to remember.

**Learning** — Can the user predict how the interface works?
- Are patterns consistent? (Same action, same visual treatment, same location)
- Can the user transfer knowledge from one section to another?
- Are conventions followed? (Links look like links, buttons look like buttons, navigation is where expected)
- How many new concepts must the user learn to use this interface? (Fewer is better — build on what they already know)

### 3. Cognitive Load Report

```
COGNITIVE LOAD: [component or page name]
  Items visible:     [count of independent elements/options on screen]
  Chunking:          [how many groups? are they labeled? target: 3-5 groups]
  Decision points:   [how many choices must user evaluate before primary action?]
  Memory demands:    [what must user remember? any recall-over-recognition violations?]
  Primary action:    [clear / buried / ambiguous — is the main CTA obvious?]
  Extraneous load:   [specific sources of unnecessary cognitive cost]
  Fix:               [specific changes to reduce load]
```

Example:

```
COGNITIVE LOAD: Project settings page
  Items visible:     23 settings in a flat list, no grouping
  Chunking:          none — all 23 items presented equally. Exceeds Miller's Law by 3x.
  Decision points:   each setting is an independent choice — 23 decisions on one page
  Memory demands:    user must scroll up to see project name while editing deploy settings at bottom
  Primary action:    Save button at bottom — not visible without scrolling
  Extraneous load:   technical jargon in labels ("SSR Hydration Strategy"), identical visual weight on all settings
  Fix:               group into 4-5 sections (General, Build, Deploy, Security, Advanced), sticky header with project name, float Save button, progressive disclosure for advanced settings, plain-language labels with technical terms in tooltips
```

## Interaction Model

Decision engine. After generating UI code, the agent audits its own output for cognitive overload. The report identifies specific violations and concrete fixes. The human sees the audit alongside the component.

For complex interfaces where high information density is unavoidable (dashboards, admin panels, IDE-like tools), the agent acknowledges that intrinsic load is high and focuses on eliminating extraneous load rather than demanding everything be simple.

## Common Violations

| Violation | Law broken | Fix |
|-----------|-----------|-----|
| 20+ items in a flat list | Miller's Law | Chunk into 3-5 labeled groups |
| 10+ navigation items at same level | Hick's Law | Progressive disclosure, group into categories |
| Small, closely-spaced action buttons | Fitts's Law | Increase size, increase spacing, primary action larger |
| "Type your account ID" (no autocomplete) | Recognition > recall | Provide selection or autocomplete |
| Same visual treatment for primary and secondary actions | Perception | Make primary action visually dominant |
| Information needed from previous step not shown | Memory | Persist key info across steps (sticky summary, breadcrumb) |
| Auto-refreshing content while user is reading | Attention | Pause updates during active interaction, show "new data available" indicator |
| Inconsistent button placement across pages | Learning | Establish and follow a layout convention |
| Modal on top of modal | Extraneous load | Redesign flow to avoid stacking contexts |
| Required fields with no defaults | Hick's Law | Provide smart defaults for common cases |

## Guard Rails

**Density isn't always bad.** Expert interfaces (IDEs, trading terminals, admin panels) serve users who have built expertise. These users process dense information efficiently because they've developed schemas. Don't simplify an expert tool to the point where experts feel patronized.

**Progressive disclosure is the primary tool.** Show the essential, reveal the advanced. This respects both novice users (who see only what they need) and expert users (who can access everything).

**Consistency beats optimization.** A slightly suboptimal layout that's consistent across the app creates less cognitive load than individually optimized pages that each work differently.

**Measure the right thing.** Fewer clicks ≠ less cognitive load. A single screen with 30 options has more cognitive load than a 3-step wizard with 10 options each. Cognitive load is about what the brain must process, not what the mouse must do.

## The Cognitive Science Foundations (Reference)

| Law | Formula/Rule | Practical Implication |
|-----|-------------|----------------------|
| **Miller's Law** | Working memory: 7±2 items (practically 3-4 groups) | Chunk information; aim for 3-5 groups per screen |
| **Hick's Law** | Decision time = b × log₂(n + 1) | Fewer choices → faster decisions. Use defaults. |
| **Fitts's Law** | Time = a + b × log₂(1 + D/W) | Big close targets for primary actions, small distant for destructive |
| **Von Restorff Effect** | Distinct items are remembered better | Make the important thing visually different |
| **Serial Position Effect** | First and last items remembered best | Put critical info at top and bottom, not buried in middle |
| **Cognitive Load Theory** | Intrinsic + extraneous + germane = total | Eliminate extraneous load; manage intrinsic; support germane |
| **Recognition > Recall** | Seeing is easier than remembering | Use selection, autocomplete, visual references over free-text input |
