---
id: q-express-mailer-delivery-unobservable
severity: moderate
status: open
---

## Evidence

`WN-003` describes the outbound POST at `app.js:21-24` to
`https://mailer.example.com/send`. The basis for this run is source-only, so
there is no live legacy system to diff against and nothing to capture a
golden master from, and the call crosses a boundary neither could reach in
any case.

## Options

(a) Ship `rubric:low` and revisit if a runnable environment appears.
(b) Block parity on this requirement until the mailer can be observed.
(c) Ship `rubric:moderate`: the guard conditions and the recipient are both
readable from the source, the delivery itself is not.

## Recommendation

Recommend (c); `rubric:moderate` matches exactly what is observable today.
