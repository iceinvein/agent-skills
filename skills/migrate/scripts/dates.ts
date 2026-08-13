// A completion date arrives from an adapter's medium: a hand-written date on a
// roadmap line, a `closedAt` from an API. Nothing upstream guarantees it names
// a real day, and `Date.parse` answers NaN rather than throwing, so an
// unvalidated date propagates silently into arithmetic and comes back out as
// a rate of NaN printed where a number belongs.
//
// Checked against the round-trip rather than by a regex on the parts, because
// the shapes that matter are the ones a regex accepts and a calendar does not:
// 2026-08-32 is well-formed and does not exist, and 2026-02-31 quietly rolls
// forward to 3 March, which would stretch an era by a month with nothing
// visibly wrong.
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return false
  return parsed.toISOString().slice(0, 10) === value
}
