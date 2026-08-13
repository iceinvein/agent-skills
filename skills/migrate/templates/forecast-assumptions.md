---
attestedBy: <owner-name>
attestedDate: <YYYY-MM-DD>
---

# Forecast assumptions

Owner-attested judgment inputs for `migrate forecast`. Everything measured
lives in the store and in the adapter's throughput; everything here is a
decision. Re-attest (edit and commit) when a judgment changes.

Copy this file to `.migrate/forecast-assumptions.md` and fill it in. `migrate
forecast` refuses without it, because a projection nobody signed is exactly the
asserted number this method exists to refuse.

## Territories

One row per capability that has confirmed requirements. A territory is a name
for how hard the ground is, and it is the unit of attested difficulty: a
campaign names a handful of them rather than a weight per requirement. Every
territory named here needs a multiplier row below.

| capability | territory |
| --- | --- |

## Multipliers

How much one requirement in that territory costs relative to a baseline of 1.0.
Positive numbers only.

| territory | multiplier |
| --- | --- |
| established | 1.0 |

## Scenarios

`rate` is one of three things, and the projection labels which:

- `as-is`, the measured velocity over calendar days since the first recorded
  completion, quiet days included. The pessimistic measured base.
- `active`, the measured velocity over the days something actually completed.
  The optimistic measured base.
- a positive number, requirements per day per stream, attested by the owner.
  Nothing measures this, the projection labels it a target, and it carries no
  uncertainty band.

`streams` is how many can run in parallel. `tax` is the coordination overhead,
in `[0, 1)`, taken off the combined rate. `note` says where the figure came
from; on a target row it is the only record of that.

| label | rate | streams | tax | note |
| --- | --- | --- | --- | --- |
| as-is | as-is | 1 | 0 | placeholder: re-attest before relying on projections |

## Caveats

Printed verbatim under every projection.

- Skeleton values: attest real territories, multipliers and scenarios before use.
