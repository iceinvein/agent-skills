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
bash <skill-dir>/scripts/status.sh preflight --review "tier 3 only" --model "6 of 9 cheap" \
     --workspace "one worktree per implementer"
bash <skill-dir>/scripts/status.sh show
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
command per task. The ids, names, the flip, the `Model` marks and the one tier
the plan settles are all fixed the moment the plan is written and are already in
the file, so typing them again is transcription with a chance of error in it.

Re-importing is safe and is the right move after the plan changes. It refreshes
names, the flip and the tier, and it leaves a status or a ratified model already
recorded alone, so resuming after a compaction cannot rewind the run.

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

`show --json` is the same state for another reader. `line` is the one-line form,
and it exits 0 in silence on a missing run, unreadable state or a missing jq,
because its caller is a status bar with nowhere to put an error.

## Statusline

This is the part that makes a run visible without anyone asking. The segment
goes in the Claude Code statusline command, keyed off the state file existing so
a session with no run in flight spawns nothing:

```bash
sluice_line=""
if [ -n "$cwd" ] && [ -f "$cwd/.sluice/run.json" ]; then
  for sluice_sh in "$cwd/.claude/skills/sluice/scripts/status.sh" \
                   "$HOME/.claude/skills/sluice/scripts/status.sh"; do
    [ -f "$sluice_sh" ] || continue
    sluice_line=$(bash "$sluice_sh" line --dir "$cwd" 2>/dev/null)
    break
  done
fi
[ -n "$sluice_line" ] && printf ' %s' "$sluice_line"
```

`$cwd` is `workspace.current_dir` from the JSON the harness sends on stdin. It
renders as `sluice deep 4/9 ▸T5`, or `!T5` where a task is blocked, which is
the one state worth colouring as a warning rather than as progress.

A run that is only visible to the session running it is a run your partner
cannot redirect. That is the same argument the channel announcement makes, and
the statusline is where it holds for the hour after the announcement scrolled
away.

## Friction

"I know which task I'm on." You do, until this session is summarised. The file
costs one command per transition and is the only thing in the run that survives
that, and a plan whose progress lives in one context window is a plan nobody
outside that window can read.
