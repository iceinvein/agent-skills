---
name: rams-design-audit
description: Use when reviewing UI output for visual noise, unnecessary decoration, or over-design. Trigger when the agent generates UI with gradients, shadows, animations, or visual flourishes that may not serve a function. Also trigger on "this looks too busy", "simplify this design", "too much going on", or when evaluating whether a UI element earns its presence. NOT for functional logic review or accessibility audits.
---

# Rams' Design Audit

A design evaluation framework based on Dieter Rams' *Ten Principles for Good Design*. Every visual element in the interface must earn its presence. If removing an element loses nothing, remove it. The goal is not minimalism for aesthetic reasons — it's clarity through restraint. Good design is as little design as possible.

**Core principle:** "Less, but better" — *Weniger, aber besser*. An interface is not finished when there's nothing left to add, but when there's nothing left to take away.

## When to Use

- After generating UI components, pages, or layouts
- When reviewing an interface that feels busy, cluttered, or overwhelming
- "This looks too busy" / "Simplify this design" / "Too much going on"
- When every component seems to demand equal visual attention
- When decorative elements (gradients, shadows, borders, icons) are present
- Evaluating whether a redesign actually improved or just rearranged

**Not for:** Functional logic review, accessibility audits (WCAG compliance), performance optimization, or backend architecture. This skill evaluates *visual design quality*, not correctness.

## The Process

### 1. The Removal Test

For every visual element in the interface, ask: **"If I remove this, does the user lose the ability to do or understand something?"**

- If yes: the element earns its presence. Keep it.
- If no: remove it. It's decoration, not design.

Apply this ruthlessly to:
- **Borders and dividers** — Can spacing alone create the visual separation? If so, the border is noise.
- **Background colors** — Does the color convey information (status, grouping, hierarchy)? Or is it filling space?
- **Icons** — Does the icon communicate something the label doesn't? Decorative icons next to self-explanatory labels are redundant.
- **Shadows and elevation** — Does the shadow indicate interactive depth or layering? Or is it just "making it look like a card"?
- **Animations and transitions** — Does the motion communicate state change or spatial relationship? Or is it just "making it feel polished"?
- **Badges, pills, and tags** — Does the label convey information the user needs at this moment? Or is it labeling the obvious?

### 2. Evaluate Against Rams' Principles

Score the interface against the principles most relevant to digital UI:

**Is it innovative?**
- Does the design solve the interaction problem in a way that serves the user, or does it follow a template without questioning whether the template fits?
- Innovation isn't novelty — it's finding a better solution to the specific problem.

**Is it useful?**
- Does every screen, section, and element serve a user goal?
- Useful means the user can accomplish what they came to do. Decorative elements that don't serve a goal are not useful.

**Is it aesthetic?**
- Does the visual design have clarity, proportion, and rhythm?
- Aesthetic doesn't mean beautiful or trendy. It means visually coherent — the parts relate to each other and to the whole.

**Is it understandable?**
- Can the user understand the interface's structure and behavior without instruction?
- Does the design make the product's function self-evident?
- If the user needs a tooltip to understand a basic control, the design has failed.

**Is it unobtrusive?**
- Does the interface recede when the user is focused on their task?
- Or does it compete for attention with the content?
- Tools should feel invisible when in use. The UI should serve the task, not showcase itself.

**Is it honest?**
- Do affordances match capabilities? Does a button that looks clickable actually do something?
- Does the visual weight of an element match its importance?
- Are disabled states, loading states, and empty states honest about the system's current condition?

**Is it long-lasting?**
- Will this design survive a trend cycle? Or is it dependent on a current aesthetic (glassmorphism, neumorphism, etc.)?
- Trends date quickly. Restraint ages well.

**Is it thorough?**
- Has every state been considered? Empty, loading, error, partial, overflow, single item, many items?
- Thoroughness is care — the design works in all cases, not just the demo screenshot.

**Is it environmentally friendly?** (adapted for digital)
- Is the interface performant? Does it avoid unnecessary renders, massive images, and heavy animations?
- Does it respect the user's resources — battery, bandwidth, attention?

**Is it as little design as possible?**
- This is the capstone principle. After all other principles are satisfied, ask: can anything else be removed?
- Every remaining element must justify its existence. Not "it looks nice" but "the user needs this."

### 3. Design Audit Report

```
RAMS AUDIT: [component or page name]
  Removal candidates: [elements that can be removed without losing function]
  Noise level:        [quiet / moderate / noisy — how much competes for attention]
  Honesty check:      [do affordances match capabilities? any misleading elements?]
  Thoroughness:       [states covered / states missing]
  Verdict:            [restrained / overdesigned / underdesigned]
  Cuts:               [specific elements to remove, with reasoning]
```

Example:

```
RAMS AUDIT: User settings page
  Removal candidates: decorative icons next to every label, card shadows on flat sections, gradient header
  Noise level:        noisy — 4 visual treatments (cards, shadows, icons, color blocks) competing equally
  Honesty check:      "Save" button looks active when form is unchanged — dishonest affordance
  Thoroughness:       missing empty state for API keys section, no loading state for avatar upload
  Verdict:            overdesigned — visual noise obscures the actual controls
  Cuts:               remove decorative icons (labels are self-explanatory), remove card shadows (use spacing for grouping), remove gradient header (adds no information), disable Save button when form is unchanged
```

## Interaction Model

Decision engine. After generating UI code, the agent runs the Rams audit on its own output. The audit identifies specific elements to remove and states to add. The human sees the audit alongside the component and can override any cut.

When the human has explicitly requested a visual style that conflicts with Rams (e.g., "make it more playful," "add some personality"), the agent acknowledges the tension and adapts the audit to evaluate within the requested style — Rams doesn't mandate austerity, but even playful design should be intentional, not random.

## Anti-Patterns

| Pattern | Problem |
|---------|---------|
| Icon + label for every menu item | Redundant — if the label is clear, the icon is decoration |
| Card with border + shadow + background color | Three treatments doing the same job. Pick one. |
| Gradient backgrounds on content areas | Competes with content for visual attention |
| Hover effects on every element | Makes everything feel interactive when only some things are |
| Micro-animations on load | Delays the user's first interaction for aesthetic effect |
| Color-coding without legend or convention | Decoration disguised as information — the colors mean nothing to the user |
| Different styling for sections at the same hierarchy level | Visual inconsistency suggests structural inconsistency that doesn't exist |
| Empty state that's just "No data" text | Unfinished, not restrained. Thoroughness requires a designed empty state. |

## Guard Rails

**Restraint is not barrenness.** Removing visual noise doesn't mean stripping all character. A restrained interface can have warmth, personality, and visual interest — through typography, spacing, and a few deliberate choices rather than through scattered decoration.

**Respect the domain.** A children's education app and an enterprise admin panel have different appropriate aesthetics. Rams' principles apply at every aesthetic level — the question is always "does this element earn its presence in this context?"

**Don't audit micro-decisions.** Whether a border-radius is 4px or 6px is not a Rams concern. The audit operates at the element level: does this border/shadow/icon/animation justify its existence?

**States are features, not decoration.** The "thorough" principle means empty, loading, error, and edge-case states must be designed, not just acknowledged. "TODO: add empty state" is a design failure.

## The Rams Principles (Complete Reference)

1. Good design is **innovative**
2. Good design makes a product **useful**
3. Good design is **aesthetic**
4. Good design makes a product **understandable**
5. Good design is **unobtrusive**
6. Good design is **honest**
7. Good design is **long-lasting**
8. Good design is **thorough** down to the last detail
9. Good design is **environmentally friendly**
10. Good design is **as little design as possible**
