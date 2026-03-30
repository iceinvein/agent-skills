---
name: gestalt-reviewer
description: Use when reviewing layout, spacing, alignment, or visual grouping in UI components. Trigger when elements that belong together aren't visually grouped, when spacing is inconsistent, when alignment axes don't guide the eye, or when visual hierarchy doesn't match information hierarchy. Also trigger on "this layout feels off", "the grouping is wrong", "alignment issues", or after generating multi-element UI layouts. NOT for color, typography, or interaction design.
---

# Gestalt Reviewer

A visual perception audit based on the Gestalt principles of visual organization. The human visual system groups elements before the conscious mind processes them — proximity, similarity, closure, continuity, and figure-ground determine what "goes together" in milliseconds. When visual grouping contradicts logical grouping, the interface feels wrong even if the user can't articulate why.

**Core principle:** The eye groups before the mind reads. If your layout's visual structure doesn't match its information structure, the user will perceive the wrong relationships — regardless of labels, headings, or documentation.

## When to Use

- Reviewing layout, spacing, and alignment in generated UI
- When related elements don't look like they belong together
- When unrelated elements accidentally form visual groups
- "This layout feels off" / "The grouping is wrong" / "Alignment issues"
- After generating multi-element layouts (forms, dashboards, cards, navigation)
- When spacing between elements feels arbitrary or inconsistent

**Not for:** Color theory, typography selection, interaction design, animation, or accessibility compliance. This skill evaluates *spatial organization and visual grouping*, not visual styling.

## The Process

### 1. Proximity — Are related things close?

**Principle:** Elements that are near each other are perceived as belonging to the same group. Distance implies separation. Closeness implies relationship.

**Audit checklist:**
- Are form labels close to their inputs? (Label above or beside the input, not floating far away)
- Is the space *between* groups larger than the space *within* groups? This is the fundamental test.
- Are related action buttons grouped together and separated from unrelated actions?
- Does the card/section padding create clear internal vs. external spacing?

**Common violations:**
- Equal spacing everywhere — everything at 16px apart makes everything feel equally related (or equally unrelated)
- Label far from its field, close to the next field — the label appears to belong to the wrong input
- Button group with same spacing as the content above — actions don't feel like a distinct group

**The spacing hierarchy rule:**
- Tightest spacing: within a component (label + input: 4-8px)
- Medium spacing: between components in a group (field to field: 12-16px)
- Widest spacing: between groups (section to section: 24-32px+)

If any two adjacent spacings are the same, the grouping is ambiguous.

### 2. Similarity — Do related things look alike?

**Principle:** Elements that share visual properties (color, size, shape, weight) are perceived as belonging to the same category. Dissimilar elements are perceived as different categories.

**Audit checklist:**
- Do all interactive elements share a consistent visual treatment? (Buttons look like buttons, links look like links)
- Do elements at the same hierarchy level have the same visual weight?
- Are status indicators (success, error, warning) visually consistent across the interface?
- Do different categories of content have distinct but consistent visual treatments?

**Common violations:**
- Interactive and non-interactive elements look the same — user can't tell what's clickable
- Two types of buttons with identical styling but different behaviors — similarity implies same category, but they're different
- Inconsistent card styling — some cards have shadows, some have borders, some have both, creating false categories
- Tags/badges with random colors — similarity of shape groups them, but random colors imply categories that don't exist

**The consistency test:** If two elements look the same, they should behave the same. If they behave differently, they must look different.

### 3. Closure — Can the mind complete the shapes?

**Principle:** The visual system completes incomplete shapes and perceives enclosed regions as groups. You don't always need explicit borders — implied boundaries work.

**Audit checklist:**
- Are containers and regions perceivable without heavy borders?
- Can spacing and alignment alone create perceived groups? (Often better than explicit borders)
- Are partial elements (truncated text, cropped images) clearly incomplete rather than broken?
- Do whitespace "containers" feel intentional rather than accidental?

**Common violations:**
- Borders on everything — explicit closure where implied closure would be cleaner
- No closure at all — elements float in undifferentiated space with no perceived groups
- Truncated text that looks like a rendering bug rather than a deliberate "read more" signal
- Overlapping elements where the overlap is ambiguous — which is in front?

**The border removal test:** For every border/divider in the layout, try removing it. If the grouping is still clear through spacing and alignment alone, the border was unnecessary.

### 4. Continuity — Does the eye flow correctly?

**Principle:** The eye follows smooth lines, curves, and alignment axes. Elements arranged along a line or curve are perceived as related, and the eye follows the path.

**Audit checklist:**
- Are elements aligned on clear vertical and horizontal axes?
- Do the alignment axes guide the eye from primary to secondary to tertiary content?
- Do F-pattern (text-heavy) or Z-pattern (action-heavy) scanning paths work?
- Are there broken axes — elements that almost align but are off by a few pixels?

**Common violations:**
- Multiple competing alignment axes — left-aligned labels, center-aligned inputs, right-aligned actions
- Almost-aligned elements — close enough to notice the misalignment, not different enough to be intentional
- Vertical rhythm breaks — consistent spacing except one section that's arbitrarily different
- Centered content inside left-aligned containers — creates an unstable axis

**The squint test:** Squint at the layout (or blur it). The alignment axes should still be visible. If the structure disappears when you can't read the text, the visual organization depends on reading, not perception.

### 5. Figure-Ground — Is foreground clear?

**Principle:** The visual system separates the visual field into figure (the thing you're looking at) and ground (the background). This separation must be unambiguous.

**Audit checklist:**
- Is the primary content clearly the figure? Does it stand forward from the background?
- Do modals, popups, and overlays clearly separate from the underlying page?
- Is there sufficient contrast between figure and ground?
- Are interactive elements (figure) clearly distinct from decorative or structural elements (ground)?

**Common violations:**
- Modal without backdrop dimming — the modal doesn't separate from the page
- Dropdown that blends with the content behind it — figure-ground ambiguity
- A sidebar that's visually heavier than the main content — the ground is competing with the figure
- Multiple "layers" of UI at the same visual depth — no clear hierarchy of what's in front

### 6. Gestalt Report

```
GESTALT: [component or page name]
  Proximity:     [grouping clear through spacing? spacing hierarchy correct?]
  Similarity:    [related elements consistent? dissimilar elements distinct?]
  Closure:       [boundaries perceivable? any unnecessary explicit borders?]
  Continuity:    [alignment axes clear? eye flow guided correctly?]
  Figure-ground: [primary content clearly foreground? layers unambiguous?]
  Violations:    [specific issues with locations]
  Fixes:         [specific spacing, alignment, or styling changes]
```

Example:

```
GESTALT: Contact form
  Proximity:     weak — label-to-input spacing (16px) equals input-to-input spacing (16px). Labels feel equidistant from both their own field and the next field.
  Similarity:    good — all inputs share consistent styling, submit button is distinct
  Closure:       good — form container creates clear boundary without explicit border
  Continuity:    weak — labels are left-aligned but input widths vary, creating a ragged right edge that breaks the vertical axis
  Figure-ground: good — form is clearly foreground against page background
  Violations:    proximity between labels and inputs ambiguous, inconsistent input widths break continuity
  Fixes:         reduce label-to-input spacing to 6px, increase input-to-input spacing to 20px (creates 3:1 ratio), standardize input widths to full-width or use consistent column grid
```

## Interaction Model

Decision engine. After generating UI with multiple elements, the agent audits the spatial organization against Gestalt principles. The audit identifies specific violations and provides concrete spacing/alignment/styling fixes. The human sees the audit alongside the layout.

The agent prioritizes **proximity** (most impactful, most commonly violated) and **continuity** (alignment issues are the most visually jarring). Similarity and figure-ground are audited when relevant but are less frequently the root cause of "this layout feels off."

## Guard Rails

**Gestalt principles are perceptual, not aesthetic.** This isn't about making things "look good" — it's about making the visual structure match the information structure. An ugly interface with correct Gestalt grouping communicates better than a beautiful one with wrong grouping.

**Don't over-specify spacing.** The principles guide relative relationships (closer = related, farther = separate), not absolute pixel values. 8px vs. 12px internal spacing is a design system decision, not a Gestalt decision.

**Context-dependent application.** A dense data table has different grouping needs than a marketing landing page. Apply the principles at the appropriate granularity for the interface type.

**The principles interact.** Proximity and similarity can reinforce each other (close AND similar = strongly grouped) or conflict (close but dissimilar = ambiguous). When principles conflict, proximity usually wins — the eye groups by distance first.

## The Gestalt Principles (Complete Reference)

| Principle | Rule | Visual test |
|-----------|------|-------------|
| **Proximity** | Close = related, far = separate | Is within-group spacing < between-group spacing? |
| **Similarity** | Same look = same category | Do elements that behave the same look the same? |
| **Closure** | Mind completes shapes, perceives regions | Does removing a border still preserve the group? |
| **Continuity** | Eye follows lines and axes | Does the squint test reveal clear alignment axes? |
| **Figure-Ground** | Foreground separates from background | Is primary content unambiguously the figure? |
| **Common Fate** | Elements moving together are grouped | Do animations group the right elements? |
| **Prägnanz** | Mind prefers the simplest interpretation | Is the simplest reading of the layout the correct one? |
