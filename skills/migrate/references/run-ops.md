# Run operations

This file holds what is true across every phase of a run rather than any one
of them: how the orchestrator dispatches subagents, how their work gets
checkpointed into the store, what happens when a subagent goes quiet, and
what an agent sees when it contends with another for the store lock.
`SKILL.md`'s Aborting section names the batch-checkpoint discipline and says
Aborting assumes it was followed; `references/phases/enumerate.md` and
`references/phases/extract.md` both point here for dispatch and checkpoint
mechanics instead of restating them. This file is what they are pointing at.

This is not a phase manual. The six-section shape every file under
`references/phases/` uses (Purpose, Inputs, Procedure, What closes it,
Degradation, Commands) does not fit here: there is no single phase this file
belongs to, and nothing below is an exit condition `migrate check` gates.

A note on how to read what follows. Dispatch and the watchdog are
orchestration policy carried from a real migration campaign; nothing in the
CLI enforces a pulse interval or a discovery order, so those sections are
marked as guidance. The batch checkpoint loop and the store lock are
different: every claim about their mechanics, message text, and exit codes
below was run against a scratch store while writing this file, not recalled
or paraphrased.

## Dispatch

Guidance, not CLI-enforced.

The orchestrator does source discovery itself, inline, before dispatching
anything. A subagent it dispatches starts at classification, not discovery,
with verified paths already in the prompt. A subagent that has to rediscover
its own paths is a subagent re-deriving something the orchestrator already
resolved, on its own dime, and re-litigating a decision that has already been
made once.

One lens per agent when lenses are heavy. Fanout unit is (surface, lens) in
phase 1 (enumerate) and capability in phase 3 (extract): an agent enumerating
`routes` under the `code` lens never needs to know what the `nav` lens found
for the same surface, and an agent mining `user-management` never needs to
know what `invoicing` looks like.

## The batch checkpoint loop

Enforced. Every claim in this section was run.

Agents never write JSONL directly. The loop is:

1. **Accumulate roughly ten rows** of findings in memory (a lens's elements,
   a capability's requirements, whatever the current phase produces).
2. **Write them to a batch file** (`batch.json`, or any name you choose) in
   the envelope shape `references/phases/*.md` and `docs/reference.md`
   describe: `{"batch": "...", "phase": "...", "rows": [...]}`.
3. **Run `migrate import`** (`elements`, `reqs`, or `deltas`, matching what
   you accumulated).
4. **Commit.** A git commit right after the import succeeds is the
   checkpoint. If the run is aborted or crashes anywhere after this point,
   `.migrate/` at the last commit is a complete, valid store as of that
   batch; nothing between commits needs to be recreated by memory, because
   nothing important was ever only in memory.

**Validation happens at write time, so a malformed row cannot enter the
store.** Import is all-or-nothing: one invalid row in a batch means nothing
in that batch is written, not a partial batch you'd have to reason about on
resume. Run against a scratch store, a batch with one row missing its
`element` text produced:

```
import: element route-get-api-orders-detail: missing element text
import: 1 error(s), nothing written
```

Exit `1`. The element count in `elements.jsonl` was unchanged; the one good
row in that same batch was not written either, because the batch is the unit.

**The batch id lands in `phases.json`, which is what makes the checkpoint
mechanical rather than remembered.** A successful import appends the batch's
id and row count to that phase's `batches` array. `savePhases` writes the file
with `JSON.stringify(file, null, 2)`, so every phase nests under a top-level
`"phases"` key beside a `"version"`, and each batch object spreads across four
lines rather than sitting on one. Real content of `.migrate/phases.json` after
two imports into `enumerate`, copied out of the file unedited, indentation
included:

```json
{
  "version": 1,
  "phases": {
    "probe": {
      "status": "pending",
      "batches": [],
      "pending": []
    },
    "enumerate": {
      "status": "running",
      "batches": [
        {
          "id": "b-routes-code-001",
          "count": 1
        },
        {
          "id": "b-routes-code-002",
          "count": 1
        }
      ],
      "pending": []
    },
```

(the remaining six phases follow in the same shape, each still `pending` with
an empty `batches`, and are cut here for length; nothing about them differs
from `probe` above.)

Nobody has to remember which batches already landed: `migrate status` and
`migrate phase enumerate` both read this array back, which is what makes
resuming a crashed run a read rather than a recollection.

## When the store is locked

Enforced. Every claim in this section was run.

`import`, `census`, `phase --status`, and `reset` each take one lock over the
whole store (`.migrate/.lock`) for the length of their read-modify-write. Those
four are the whole set; every other command either only reads the store, or
does not touch it. Without
it, two agents importing at once each read the same base file, and whichever
one rewrites last silently discards the other's rows. The default wait is 30
seconds, polling with backoff (25ms, growing by roughly 1.5x each attempt, up
to a 250ms cap; read directly from `scripts/lock.ts`, not independently timed
here). A wait longer than that, or a lock file that looks broken rather than
merely held, ends in exit `3`.

**Exit `3` means retry, not fix the batch.** It is its own code, distinct
from `1` (a content or domain failure: your batch or query was well-formed
and the answer is no) and `2` (a malformed request: a bad flag, a missing
file). A lock failure says the request itself was fine; there is nothing
about your `batch.json`, or about the `--phase` you named, to go back and
inspect, regardless of which of the three ways below the lock failed. (Three
ways the lock can fail, not three commands that take it: four commands do,
listed above.)

That said, "retry" resolves the three underlying causes differently, and only
one of them clears on its own. Verified against a scratch store: a lock held
by a genuinely live process that outlasted the 30-second timeout produced the
timeout message and exit `3` on the first attempt (elapsed 30.091s), then, on
a second attempt with nothing else changed, waited out the remaining hold and
succeeded on its own once that process actually released the lock (elapsed
4.627s, exit `0`, no `--force-unlock` involved). An ordinary contended or
slow lock genuinely does resolve with a bare retry, possibly more than one.
The two stale conditions below do not: retried bare, with no other change, a
corrupt lock file produced the identical exit `3` message on a second
attempt, immediately, because nothing about the file is different the second
time. Retry is the right first move for exit `3` in general; only
`--force-unlock`, after confirming safety, moves a stale lock forward.

**What a waiting agent sees.** `import`, `census`, and `reset` announce the
wait on stderr, once, the first time they see a live holder. Verified against a
scratch store, holding the lock with a real running process and then
attempting an import produced (path and pid shortened for readability; the
message text is exact):

```
import: waiting for store lock (held by pid 51234 since 2026-08-07T09:14:02.001Z)
```

`phase --status` is the one that does not print this line. It waits on the
same lock with the same backoff, silently: run against a scratch store with a
live holder released two seconds in, `migrate phase enumerate --status running`
printed nothing at all until it succeeded, 1.85 seconds later. `reset` does
print it, verified the same way against a live holder released two seconds in:

```
reset: waiting for store lock (held by pid 74987 since 2026-08-08T00:00:00.000Z)
```

If the wait for any of the four ends in a timeout instead, all four report it
the same way, with their own command name prefixed:

```
import: timed out after 30000ms waiting for the store lock held by pid 51234 since 2026-08-07T09:14:02.001Z
```

Verified with a real 30-second wait against a live holder (elapsed time
measured at 30.070s): the timeout is real, not advisory, and the message
names the same holder the waiting announcement did. When the lock file
itself is absent for the whole timeout instead of naming a holder, the
message falls back to naming the path instead:

```
import: timed out after 30000ms waiting for the store lock at /repo/.migrate/.lock
```

**Two conditions are refused immediately rather than waited out**, because
neither one is a lock that contention will ever resolve on its own: a holder
pid that has confirmed exited, and a lock file that fails to parse five
reads in a row. Verified against a scratch store, both returned in well
under a second, not anywhere near the 30-second timeout (0.031s and 0.259s
respectively in the runs that produced these):

```
import: store lock held by pid 51234, which is not running. Re-run with --force-unlock after confirming no other agent is writing
```

```
import: store lock at /repo/.migrate/.lock is unreadable; re-run with --force-unlock after confirming no other agent is writing
```

Both messages, and the timeout messages above, are copied verbatim from
`scripts/lock.ts`; only the pid, timestamp, and path are illustrative. Note
the two stale messages are not identically punctuated in the source (one
capitalizes "Re-run" after a period, the other lowercases "re-run" after a
semicolon) and this file preserves that rather than smoothing it over, so
what you read here matches what you'll see on screen exactly.

**`--force-unlock` is only appropriate after confirming the named pid is not
running and no other agent is mid-write.** It exists on `import`, `census`,
`phase`, and `reset`, the same four commands that take the lock at all.
Verified against a scratch store holding a dead holder's lock: each of the four
exits `3` without the flag and `0` with it. `reset` matters most here of the
four, since it is the one whose whole job is deleting rows. What it actually
does is blunt: it unlinks the lock file
unconditionally, before this process even checks who, if anyone, holds it.
The CLI does not verify staleness for you when you pass this flag; the
message says "after confirming no other agent is writing" because that
confirmation is entirely on you.

**Forcing a lock a live agent holds will lose that agent's rows.** If the
current holder is genuinely mid read-modify-write, unlinking its lock file
does not stop it. Both processes now race to rewrite the same store file, and
whichever one finishes and renames last wins, silently discarding whatever
the other one wrote. This is exactly the hazard the lock exists to prevent in
the first place, just re-opened by force. Confirm the named pid is actually
gone (not merely busy) before reaching for this flag, not after.

Verified: forcing a lock whose holder pid had genuinely exited (`pid 999999`,
not present on the system) removed the lock file and let the import through
in the same call:

```
import elements: 1 added, 0 updated, batch b-routes-code-002
```

## Watchdog

Guidance, not CLI-enforced.

Pulse roughly every 30 minutes on a dispatched subagent that has been running
a while. Movement in its transcript (a tool call, a written batch, anything)
means it is alive; let it keep going. No movement gets exactly one resume,
and that resume says write-first: whatever findings it is holding, checkpoint
them (batch, import, commit) before doing anything else. Still nothing after
that resume means abandon the subagent and do the remaining work inline,
never send a second resume. A transcript that has already gone quiet once and
been resumed once is a transcript that keeps growing every time you poke it,
and a resumed transcript eventually becomes unresumable from bloat alone, so
the second attempt is not a smaller version of the first risk, it is a worse
one.

## Report verification

Guidance for prose reports; the numeric part is now enforced by `migrate
check` instead.

The rule that every number in a report must be re-derived by a command the
writer actually ran exists because, before there was a store, coverage
arithmetic was hand-written and hand-verified, and the hand-written numbers
were wrong more than once. With the census living in the store, `migrate
check` (and `migrate status`) is the derivation: the coverage line, the
census balance, the run-state gate are commands, not claims someone typed.
The re-derive rule now narrows to prose: a queue item's evidence section, a
seam validator's raw script output, anything written in English about what a
lens or a validator found. Those still need to be something a command
actually produced or a person actually observed, quoted rather than
summarized from memory, for exactly the reason the original rule existed.

**Scorer and mapper stay separated for benchmark runs.** When the method
itself is being validated against a benchmark rather than run against a live
migration, the agent producing the mapping and the agent scoring it against
ground truth must not be the same agent, and must not share context that
would let one see the other's answer. This is a v1 documented discipline,
not a CLI verb; `migrate` has no benchmark command in this milestone.
