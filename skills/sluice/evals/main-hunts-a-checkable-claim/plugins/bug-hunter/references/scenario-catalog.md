# Scenario catalog

Where QA finds bugs that the author's tests missed. Work through every
category for the target; a category that gives no purchase gets one line in
`scenarios.md` saying why, so its absence reads as a decision. Each probe is a
prompt for a scenario, not a scenario: the expected result still has to come
from a claim in `intent.md`.

## Boundaries

- The value exactly at each stated limit, one below it, and one above it.
- Zero, one, and many: an empty collection, a single element, the maximum.
- The first and last item of a page, a range or a batch, and a request for
  the page after the last.
- Inclusive against exclusive ends: does "until Friday" or "up to 10" include
  the endpoint the claim names.
- Negative numbers and zero where only positives were imagined.

## Sequence and state

- Run the same action twice in a row; the second call should be safe or
  refused, whichever the claim says.
- Double submit: two identical requests arriving before the first completes.
- Retry after partial failure: the first attempt wrote half its state and
  failed; the retry must not duplicate or skip the half already written.
- Out of order: the steps a workflow expects in sequence, sent in a different
  order, or a later step without the earlier one.
- An action on something already deleted, cancelled, closed or expired.
- Undo, then redo, then the original action again.

## Combinations of flags, options and roles

- Two options that each work alone, set together, especially ones that pull
  in opposite directions (`--force` with `--dry-run`).
- A role with less permission reaching an action through a path built for a
  more privileged one.
- An option that the change added, combined with each pre-existing option it
  interacts with.
- The default for every option left unset, against each one explicitly set to
  its default value.

## Time

- A timestamp in a timezone other than the server's, and a user whose
  timezone differs from the data's.
- The DST transition days: an hour that does not exist, and an hour that
  happens twice.
- Month end: the 31st plus one month, 29 February, and a non-leap year.
- Midnight and the date boundary: an event at 23:59:59 and at 00:00:00, and a
  "today" computed in UTC against local time.
- Year end, and a range that spans it.

## Data shape

- Null against missing against empty: a field absent, present as `null`,
  present as `""` or `[]`; are they meant to mean the same thing.
- Duplicates in input that the claim assumes unique.
- Ordering: input in reverse or random order where the code may assume sorted,
  and output order where the claim promises one.
- Unicode: combining characters, emoji, right-to-left text, and case folding
  outside ASCII.
- Size: a very long string, a very large collection, a deeply nested value.
- Whitespace and case variants of a value meant to match: leading or trailing
  spaces, mixed case.

## Arithmetic

- Rounding: half-way values, and the rounding mode the claim requires against
  the one the language defaults to.
- Money in floating point: sums of many small amounts, and totals that must
  equal the sum of their rounded parts.
- Units: seconds against milliseconds, bytes against kilobytes, cents against
  dollars, at each boundary between components.
- Integer division and remainder with negative operands, and division by zero.
- Overflow at the type's limit, and percentages over 100 or below 0.

## Partial failure

- A dependency call that fails after earlier writes succeeded: what state is
  left, and does the caller learn about it.
- A timeout that fires after the remote side completed the work.
- One item failing in a batch: do the others commit, roll back, or report.
- An error raised inside cleanup or a `finally`, hiding the original one.
- A process killed between two writes that the claim says happen together.

## Environment

- A stale cache serving a value the change made obsolete.
- Config missing, empty, or set to a value of the wrong type.
- A feature flag off, on, and flipped while work is in flight.
- Running against data written by the previous version of the code.
- A different locale, working directory, or a path with spaces in it.
