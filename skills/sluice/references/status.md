# Run state

The plan says what the tasks are. The run record says why each decision went
the way it did. Neither answers "where is this right now" to anything but a
model reading prose, which is why a `deep` run is invisible from outside the
session that is running it: your partner has to ask, and asking costs a turn
and gets an answer from memory.

`.sluice/run.json` is that answer in a form something else can read. One file
per tree, holding only what changes as the run moves.

```
bash <skill-dir>/scripts/status.sh init --topic <t> --channel deep \
     --plan docs/plans/<date>-<topic>.md --record docs/plans/<date>-<topic>-record.md
bash <skill-dir>/scripts/status.sh task 3 --name "adapter seam" --tier 1 --model cheap
bash <skill-dir>/scripts/status.sh task 3 --status active --base 75014c9
bash <skill-dir>/scripts/status.sh task 3 --status done --commit 2c7f261
bash <skill-dir>/scripts/status.sh task 3 --reviewed
bash <skill-dir>/scripts/status.sh preflight --review "tier 3 only" --model "6 of 9 cheap" \
     --workspace "one worktree per implementer"
bash <skill-dir>/scripts/status.sh show
bash <skill-dir>/scripts/status.sh ready
bash <skill-dir>/scripts/status.sh line --full
bash <skill-dir>/scripts/status.sh close
```

`--dir <path>` reads another tree, which is what the statusline uses. Statuses
are `todo`, `active`, `review`, `done` and `blocked`. A new id needs `--name`;
after that every call is a bare flip, so keeping it current costs one command
per transition rather than a paragraph. `close` archives the run under
`.sluice/archive/` and frees the tree for the next one.

A command that cannot finish leaves the state exactly as it found it, so a
failed `task` never costs you the rows already in the file. Two argument rules
follow from that being worth guaranteeing: a value beginning with `--` is
rejected rather than accepted as a value, and a flag with no value at all is
rejected rather than taking the next flag as one.

Gitignore `.sluice/`. It is working state, and everything durable in it lands
somewhere else anyway: the commits are in git and the reasons are in the record,
which is the file that does get committed.

Open it with `init` when you open the run record, at the same point and for the
same reason, then seed the rows with `plan.sh import <plan>` rather than a
command per task. The ids, names, the flip, the `Model` marks and the tiers are
all fixed the moment the plan is written and are already in the file, so typing
them again is transcription with a chance of error in it.

The tier import writes is a floor read off `Touches`: an `(edit)` means existing
code changed, no `(test)` means nothing executable covers the task, and `Flips`
or a `Review` flag is tier 3 outright. Raise one by hand with `--tier` where the
work is more delicate than its paths suggest; nothing lowers it for you, because
the tier table takes the highest row a task matches.

Re-importing is safe and is the right move after the plan changes. It refreshes
names, the contract graph and the flip, moving the flip when the plan moved it,
and it raises a tier without ever lowering one. A status, a review mark or a model
ratified at pre-flight is left alone, so resuming after a compaction cannot rewind
the run. The one consequence worth knowing: adding a missing `(test)` to a plan
will not drop a task from tier 2 back to tier 1, because the tier table takes the
highest row a task matches and nothing here can tell a correction from a
regression. Lower it by hand with `--tier` if that is what you mean.

## What goes where

**`run.json` owns status. The record owns why.** A status written into both
drifts, and the moment it does there are two answers and no way to tell which
is stale. So the record stops carrying task rows with statuses in them and
carries what a status cannot hold: the reason review went the way it did, the
reason a task was downshifted, a finding that belongs to a task other than the
one that surfaced it, and what a stranger resuming tomorrow would need and
could not derive.

Pre-flight answers land in both, and that is deliberate rather than an
exception: `run.json` holds the answer so the file can say whether the stop
happened, the record holds the reason so a reader can tell whether it should
have gone that way. Those are different claims.

## Reading it back

`show` prints the whole run: channel, topic, how many tasks are done, the plan
and record paths, the pre-flight answers, and a row per task with its base,
commit, tier and model. Run it after compaction instead of reconstructing the
run from what you remember, and run it in the message that hands the work back,
where "four of nine, task five blocked" is a fact your partner can act on.

`show --json` is the same state for another reader. `line` is the compact
one-line form and `line --full` the wide one; both exit 0 in silence on a missing
run, unreadable state or a missing jq, because their caller is a status bar with
nowhere to put an error.

`line --full` renders three rows: the run and its clock, the bar alone, then the
detail. The bar gets a row to itself so it never competes with text for width,
which is what lets a cell be wide enough to read as a block rather than a tick.

A group of cells per task, one repeated glyph each: `▰` done, `◈` active, `▨` in
review, `▮` blocked, `▱` still to do. The glyphs are distinct before they are
coloured, so the rows survive having their colour stripped. The width is chosen
from what the whole bar would occupy, gaps included, rather than from the task
count: keyed off the count alone the schedule was not monotonic, and thirty tasks
at two cells each ran wider than twelve at three.

**A done task still owed a review trails the review glyph**, `▰▰▨` against
`▰▰▰`. Debt then reads in position rather than only as a count at the end of the
row, which is the difference between knowing how much there is and knowing where.
Tier 0 was never owed a dispatch, so it reads as plainly done. On a plan long
enough to narrow cells to one, there is no trailing cell to give up and the
positional reading stops: the count in the third row is then the only carrier,
which is why it is printed whether or not the bar could show the same thing.

**The flip draws as a rule, `┃`, before its task.** Everything left of it is inert
and safe to leave landed; everything right of it is not. That is what the flip
means, and it is a boundary between tasks rather than a property of one, so a
name in the header could not say it. `plan.sh validate` rejects a plan with two
flips and `import` clears a stale one, so the bar is only ever asked to draw the
single legal case.

The third row carries the progress count, whichever task wants attention, and the
review debt. A blocked task displaces the active one there, being the one of the
two worth interrupting for, and a `+n` follows when more than one task shares that
state, since a plan running four wide has four actives by design.

Mark a review with `task <id> --reviewed` when a reviewer comes back. What that
buys is the debt count: a task that is done, that the tier table owed a dispatch,
and that nobody marked. Tier 0 is excluded, having only ever been owed a stat
read. Without it "review outstanding" first appears in the closing summary, at
the one moment your partner can no longer do anything about it, and `show` and
the statusline both carry it from the moment it exists.

## The next wave

`ready` answers the one question the other commands do not: not what the state is,
but what may go now. A task is ready when every symbol it `Needs` is offered by a
task already done, and two ready tasks are safe together when their `Touches` are
disjoint.

```
6 ready now · a worktree each
  T1  extract the bundle writer              src/cli/adapters/bundle.ts, …
  T4  record what the harness offers         skills/sluice/scripts/status.sh, …
  T4 and T5 share skills/sluice/scripts/status.sh, so not together

2 waiting on a contract
  T2  cursor and gemini write bundles        needs writeBundle

the flip runs alone
  T8  sluice installs on four harnesses
```

It reads the graph `plan.sh import` recorded, so a run seeded before that existed
says so and tells you to re-import rather than reporting everything ready. The
flip is held out of every wave whatever the graph says, because the invariant it
establishes is what the tasks after it are checked against.

Derive the wave here rather than writing wave numbers into the plan. A declared
schedule is wrong the moment one task lands late; this recomputes.

## Statusline

This is the part that makes a run visible without anyone asking. Give it rows of
its own rather than a segment among the badges: it then costs nothing when no run
is live and contends with nothing for width when one is, which is what lets the
bar be wide and the task carry its name rather than only its number.

Capture it wherever the statusline command builds its other lines, keyed off the
state file existing so a session with no run spawns no process at all:

```bash
sluice_line=""
if [ -n "$cwd" ] && [ -f "$cwd/.sluice/run.json" ]; then
  for sluice_sh in "$cwd/.claude/skills/sluice/scripts/status.sh" \
                   "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/sluice/scripts/status.sh" \
                   "$HOME/.claude/skills/sluice/scripts/status.sh"; do
    [ -f "$sluice_sh" ] || continue
    sluice_line=$(bash "$sluice_sh" line --full --dir "$cwd" 2>/dev/null)
    break
  done
fi
```

then print it last, after whatever else the command emits:

```bash
if [ -n "$sluice_line" ]; then printf '%s\n' "$sluice_line"; fi
```

`if` rather than `[ ... ] &&`: as the last command of a statusline script the
short form makes it exit 1 on every render with no run live, which is the common
case. `%s` rather than `%b`: the render already carries real escape bytes, and
`%b` would reinterpret a backslash inside a task name. `$cwd` is
`workspace.current_dir` from the JSON the harness sends on stdin. The configured
config dir is read before the default because a session started with
`CLAUDE_CONFIG_DIR` set installs the skill there, which is the one place a
`$HOME/.claude` lookup will not find it; the two paths collapse to one when the
variable is unset, at the price of a second `[ -f ]`. It renders as:

```
⧗ deep · sluice-cross-harness   ◷ 38m
  ▰▰▰ ▰▰▨ ▨▨▨ ◈◈◈ ▱▱▱ ▮▮▮ ▱▱▱ ┃ ▱▱▱ ▱▱▱
  2/9 done · !T6 model tiers rather than model names +1 · ⟲1 unreviewed
```

The colour comes out of the script rather than being applied by the caller,
because the mapping from state to colour belongs next to the state. A caller that
coloured the line itself would have to re-derive each cell's meaning from its
glyph, which is the same fact stored twice.

A run that is only visible to the session running it is a run your partner
cannot redirect. That is the same argument the channel announcement makes, and
the statusline is where it holds for the hour after the announcement scrolled
away.

## Friction

"I know which task I'm on." You do, until this session is summarised. The file
costs one command per transition and is the only thing in the run that survives
that, and a plan whose progress lives in one context window is a plan nobody
outside that window can read.
