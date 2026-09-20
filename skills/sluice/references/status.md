# Run state

The plan says what the tasks are. The run record says why each decision went
the way it did. Neither answers "where is this right now" to anything but a
model reading prose, which is why a `deep` run is invisible from outside the
session that is running it: your partner has to ask, and asking costs a turn
and gets an answer from memory.

`.sluice/run.json` is that answer in a form something else can read. One file
per worktree set, holding only what changes as the run moves.

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
bash <skill-dir>/scripts/status.sh final
bash <skill-dir>/scripts/status.sh move --to <worktree>
bash <skill-dir>/scripts/status.sh pause --reason "waiting on the API key"
bash <skill-dir>/scripts/status.sh resume
bash <skill-dir>/scripts/status.sh line --full
bash <skill-dir>/scripts/status.sh close
```

`--dir <path>` reads another tree, which is what the statusline uses. A tree
with a run of its own is read as itself; one with none resolves to the main
worktree of its set, and from there to whatever tree the run has since moved
into. So any tree in the set reads the one run, wherever in the set it lives,
and `--dir <implementer worktree>` finds it too. `show` prints a `tree` row
naming where the run is whenever that is not the tree it was pointed at, since
a run read from a tree it does not live in otherwise answers "where is this"
with the tree the reader is already in. `show --json` stays the state file
verbatim, and the row is not in it. Statuses
are `todo`, `active`, `review`, `done` and `blocked`. A new id needs `--name`;
after that every call is a bare flip, so keeping it current costs one command
per transition rather than a paragraph. `close` archives the run under
`.sluice/archive/`, prints one line saying what it archived, progress, how many
tasks shipped without a dispatch and whether the final review landed, and frees
the tree for the next one.

The controller writes every row. An implementer reports its SHA in its reply
and touches nothing under `.sluice/`; the brief in `references/deep-channel.md`
says so to it. `active` is the dispatch, `review` is the commit in and a
reviewer out, with the task's paths still held because a finding may send the
implementer back into them, and `done` is the end: with `--reviewed` when a
review cleared it, without when the tier qualified for one and pre-flight
declined it, which is the row the no-dispatch count counts. Declining is meant
to show up there: the count describes the artifact, not the decision, and a
chosen skip that erased itself would leave a number that only ever recorded
accidents.

A task going `active` with no `--base` takes the HEAD of the tree the command
is pointed at, `--dir` if given and the current tree otherwise, once; a base
already on the row is kept. Issued from the controller's tree that is the
controller's HEAD, which is what an implementer worktree cut from that branch
starts at, so the default is right at dispatch. Where the implementer's tree
has moved on, point the command at that tree: `--dir <implementer worktree>`
resolves the run through the set and takes the base from the tree it was
pointed at, which is the one about to be built in. `--base $(git -C
<implementer worktree> rev-parse --short HEAD)` says the same thing outright.

`init` reports any other run live in a tree of the same set, without refusing:
two sessions in two worktrees is legal, and a run stranded in the main tree
beside a fresh one in a worktree looks the same until someone says so.

Every write stamps `updated`. Past a day since the last one, `show` and the
statusline both say how long the run has sat idle, because a finished plan
whose run was never closed looks exactly like a live one otherwise, and it
blocks the next `init`.

`final` records that the plan's final review cleared. `show` reports it
pending until then, and `close` says which it was.

A command that cannot finish leaves the state exactly as it found it, so a
failed `task` never costs you the rows already in the file. Two argument rules
follow from that being worth guaranteeing: a value beginning with `--` is
rejected rather than accepted as a value, and a flag with no value at all is
rejected rather than taking the next flag as one.

The directory ignores itself: `init` drops a `.gitignore` holding `*` next to
the state, so no project has to add a line of its own. It is working state, and
everything durable in it lands somewhere else anyway: the commits are in git and
the reasons are in the record, which is the file that does get committed. Delete
that `.gitignore` if you want a run tracked; it is only written when absent.

## Worktrees

The run lives with the controller: in the worktree the work runs in when
pre-flight bought one, in the main tree otherwise. Implementers never read or
write it, the controller flips every row, so nothing an implementer does
depends on seeing the run from its own worktree, and two sessions working
independently in two worktrees of one repo each keep their own run with
neither shown the other's.

`init` therefore always lands in the tree it is given, and every other command
reads that tree's own state when it has one. A tree with none falls back to the
main worktree of its set, which is what keeps a session working before this
rule existed, run in the main tree and worktree cut afterwards, reading the run
it started. That run stays in the main tree, where it blocks the next
session's `init`; `move --to <worktree>` relocates it, refusing a destination
that already holds a run or that is not a work tree of the same repository. A
submodule anchors on its own checkout, not the superproject's, and a directory
that is no git work tree keeps its run exactly where it sits.

`move` is half a step, and the half it cannot take is the session. The harness
holds one working directory and no command here reaches it, so the controller
goes on asking about the tree it is still sitting in: its statusline draws for
that tree, so does the SessionStart hook, and so does every bare `git`, build
and test command it runs. **Move the session into the tree the run went to**,
with the harness's worktree tool where there is one, entering the worktree by
path when it was cut by hand. `move` says so on the way out, because that is
the moment it is still cheap.

Until the session moves, the tree it came from reads the run rather than
denying it: `move` leaves `.sluice/run.at` at the main worktree, one line
naming the tree the run is in, and a tree with no run of its own follows it.
The note lives at the main worktree and nowhere else, so a run moved twice
forwards once rather than down a chain of trees, and it is followed only while
the run it names is really there. `close` removes a note naming its own tree,
because a note that outlived its run would hand the next run opened in that
tree to whoever reads the main tree.

One file for several writers is one file to contend on, so `init`, `task`,
`preflight`, `final`, `pause`, `resume`, `close` and `move` take a lock first, `move` taking the
destination tree's as well as its own: two flips issued at the same moment
from different trees would otherwise have the later write built on a snapshot
taken before the earlier one landed, dropping that row without saying so. The lock
carries its holder's pid, so a killed run is broken through rather than waited
out. Reads take nothing, state being installed through a rename, which is what
keeps `line` cheap enough to render on.

Open it with `init` when you open the run record, at the same point and for the
same reason, and in the same tree: after pre-flight, inside the worktree when
one was bought. Then seed the rows with `plan.sh import <plan>` rather than a
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
and record paths, how long it has sat idle once that passes a day, the tasks
that shipped without a dispatch, the final review, the pre-flight answers, and a row per task with its
base, commit, tier and model. Run it after compaction instead of reconstructing the
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

**A done task that got no dispatch trails the review glyph**, `▰▰▨` against
`▰▰▰`. The gap then reads in position rather than only as a count at the end of
the row, which is the difference between knowing how much there is and knowing where.
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
no-dispatch count. A blocked task displaces the active one there, being the one of
the two worth interrupting for, and a `+n` follows when more than one task shares
that state, since a plan running four wide has four actives by design.

Mark a review with `task <id> --reviewed` when a reviewer comes back. What that
buys is the count: a task that is done, that the tier table qualified for a
dispatch, and that nobody marked. Tier 0 is excluded, having only ever been owed
a stat read. Without it that count first appears in the closing summary, at the
one moment your partner can no longer do anything about it, and `show` and the
statusline both carry it from the moment it exists.

## Coverage against debt

The same count reads two ways, and which one it gets turns on whether
`preflight --review` has an answer on file.

With an answer, the level was priced at the stop and the tasks it skipped were
spent rather than forgotten. `show` calls it `coverage`, with the answer itself
on the `pre-flight` row three lines below rather than repeated beside the count;
the bar says `⟲ 9 at the chosen level` dim rather than in the warning colour, and
`close` says `9 at the chosen review level`. That is a fact about how
far review reached, not a thing still to do, and a run that keeps calling it
outstanding is nagging your partner about a decision they already made.

With no answer on file, nobody priced anything. `show` calls it `unreviewed`, the
bar and `close` say the same, and the warning colour stays: the dispatches the
tier table promised are genuinely owed, and the absence of a pre-flight answer is
the evidence that nobody weighed them.

What never changes is the number. Nine tasks that shipped without a second pair
of eyes carry the same risk whether the skip was chosen or forgotten, and the
count is there to say how far coverage reached. Erasing a chosen skip would turn
it into a measure of diligence, which is not what anyone reads it for. So the
word moves and the number does not.

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

What a wave of several means is read off the pre-flight workspace answer: an
answer containing "per implementer", "per concurrent implementer", "each
implementer" or "worktree each" prints "a worktree each", any other recorded
answer prints "serial, one at a time in the shared tree", and no answer prints
neither. It is a match on words, not a reading of the sentence, so record the
answer in one of those phrases when worktrees were bought and in none of them
when they were not.

## On session start

`scripts/session-start.sh` is the SessionStart hook a global install wires,
after the routing directive. On startup, resume, clear and compact it runs
`show` against the tree the session opened in, a subdirectory or a linked
worktree included since `show` anchors on the main worktree, and prints the
run when there is one, with one sentence more: after a compaction, resume or
clear, that the record is to be read before the next dispatch; on a fresh
start, that a run not being continued was left open and wants `close`. A tree
with no run prints nothing. The reading-back rule above still stands; this is
the harness doing it at the one moment memory has just been cut.

## On stopping

`scripts/stop-guard.sh` is the Stop hook a global install wires. When the model
tries to end its turn it reads the run in the session's own tree, the git
top level of the session's working directory, and refuses, with a reason, when
a `deep` run there is past pre-flight, has tasks still `todo`, `active` or
`review`, and nothing is `blocked` or paused. The reason says what to do
instead: dispatch the next wave in the same message, mark the task that needs
your partner `blocked`, `pause --reason` and say so, or `close` a run that is
not this session's work. Every real stop is let through: no run in the
session's tree (the main-tree fallback other commands use is not taken here,
since a Stop in a runless worktree may be an unrelated session), a channel
other than `deep`, pre-flight not yet recorded, a blocked task, a paused run,
every task done, a run idle for a day, and a turn where the harness says a
stop hook already fired, which is what keeps it from looping. That last rule
means it refuses once per turn and lets the next attempt through: a nudge, not
a wall. The gate keys on the git top level of the session's working
directory: the run this tree answers for is the state beside it, or the state
it forwarded into a worktree when `move` sent the run on without the session.
Both are this tree's, and a controller that moved its run out and stayed put is
guarded for the rest of the run rather than quietly let go at the moment it
moved. The main-worktree fallback stays untaken, so a session in a worktree
that merely reads the set's run is let stop as before.

Once the run is in another tree the remedy changes with it. The refusal names
that tree and says to move the session into it, and it stops offering `close`:
from here that would archive a run live somewhere else, which may be another
session's, and talking anyone into that is the one thing this hook must not do.
The offer comes back when the run is in the tree the stop came from. None of
this makes staying put correct: open the run after the worktree is cut, or
`move` it and enter that worktree, since `move` relocates the run and not the
session, and every bare `git`, build and test command meanwhile still lands in
the tree the work left.

`pause --reason <text>` records why a run is standing still; `show` and the
statusline carry it, and `resume` clears it. A pause with no reason is refused,
since the reason is the only thing that separates a pause from a stall.

## Free text

Every value a command stores is later drawn onto a terminal: by the statusline,
by `show`, by the SessionStart hook and by the stop guard's refusal. A control
character in one is not text there, it is an instruction the terminal obeys, and
task names are model-written and routinely pasted out of issue titles. `ESC[2J`
in a name clears the screen on every render for as long as the run is open; a
carriage return walks the cursor back over the row just drawn.

So every flag value is refused if it carries one, with exit 4 naming the flag,
rather than being quietly stripped: a name that is not the name the caller
passed is its own surprise, and no legitimate value has ever needed a control
byte. `plan.sh import` writes task names through the same door and inherits it.

The renders drop them as well. State written before the check existed, or edited
by hand, is an input like any other, and the only control bytes a render should
emit are the colour sequences it writes itself.

## Statusline

This is the part that makes a run visible without anyone asking. Give it rows of
its own rather than a segment among the badges: it then costs nothing when no run
is live and contends with nothing for width when one is, which is what lets the
bar be wide and the task carry its name rather than only its number.

Capture it wherever the statusline command builds its other lines, passing the
directory the session is in and nothing else:

```bash
sluice_line=$(bash "$HOME/.claude/skills/sluice/scripts/statusline.sh" --dir "$cwd" 2>/dev/null)
```

then print it last, after whatever else the command emits:

```bash
if [ -n "$sluice_line" ]; then printf '%s\n' "$sluice_line"; fi
```

`$cwd` is `workspace.current_dir` from the JSON the harness sends on stdin.
Substitute the install path: `${CLAUDE_CONFIG_DIR:-$HOME/.claude}` where a
session may set one, or `$cwd/.claude/skills/sluice/scripts/statusline.sh` for a
project-local install.

Those two lines are the whole contract, and they are deliberately empty of
judgement. Whether a run is visible from a given directory is a question about
this skill's layout, and the answer has moved twice: once when the run anchored
on the worktree set, once when a deep run began opening inside the implementer
worktree. Both times a caller carrying the test went stale and stopped drawing
without saying so, which is indistinguishable from no run being live. A caller
that contributes only a path cannot go stale, and every install brings
`statusline.sh` up to date behind it.

`scripts/statusline.sh` holds what used to sit in the caller: it resolves the
directory it was given, walks up looking for a state file or a worktree marker,
stops at an ordinary tree root or at `$HOME` with neither, and dispatches to
`status.sh line --full` only when there is something to draw. The walk is what
lets a session sitting in a subdirectory see the run in its tree, which testing
the session's own directory alone never did, and it resolves symlinks first
because a linked directory's lexical parents lead away from the tree rather than
up it.

It answers only whether a run might be visible from here, never where one is.
`status.sh` stays the single authority on that, and is handed the directory the
caller passed rather than the one the walk stopped at. A gate that were ever
narrower than the resolution behind it would blank the bar on a run that
resolves perfectly well, which is the failure this whole arrangement exists to
end, so it errs permissive: a wasted spawn is the acceptable direction.

The gate is kept rather than dropped because it costs about 8ms against the 33ms
an ungated `status.sh` pays to work out there is no run, and the common case on
any machine is a tree with no run at all. Depth barely moves it, 7.7ms stopping
at a `.git` directory against 8.4ms walking to the root, because 5.4ms of that
is the bash spawn and the walk itself forks nothing.

`if` rather than `[ ... ] &&`: as the last command of a statusline script the
short form makes it exit 1 on every render with no run live, which is the common
case. `%s` rather than `%b`: the render already carries real escape bytes, and
`%b` would reinterpret a backslash inside a task name. It renders as:

```
⧗ deep · sluice-cross-harness   ◷ 38m
  ▰▰▰ ▰▰▨ ▨▨▨ ◈◈◈ ▱▱▱ ▮▮▮ ▱▱▱ ┃ ▱▱▱ ▱▱▱
  2/9 done · !T6 model tiers rather than model names +1 · ⟲ 1 unreviewed
```

On a machine with no status line at all there is nothing to paste into, so the
install claims the empty `statusLine` slot and points it at
`scripts/statusline-command.sh`, a complete command that reads the harness JSON
on stdin and draws the run and nothing else. A slot already holding someone
else's command is never touched, on install or on removal, and the one the
install claimed is given back when the skill is removed, including on the
removal path that has no manifest to read.

Three things make claiming a single shared slot safe. The command is written
guarded by its own script's existence, as the hook commands are, so a bundle
that moved leaves the bar silent rather than running a path that is gone on
every keystroke. Ownership is matched on the whole command and never as a
substring, so a command with ours composed into it belongs to whoever composed
it and is left whole. And the path it matches carries the skill's own directory,
so the second skill to declare a statusline cannot take the first one's slot on
install or delete it on removal. That is why the bundled
command draws no prompt of its own: it exists for the empty slot, not to compete
for a full one, so with no run live it prints nothing rather than an empty row.

The colour comes out of the script rather than being applied by the caller,
because the mapping from state to colour belongs next to the state. A caller that
coloured the line itself would have to re-derive each cell's meaning from its
glyph, which is the same fact stored twice.

Past a day since the last write the first row gains `· idle 2d1h`, so a run
nobody closed reads as one.

A run that is only visible to the session running it is a run your partner
cannot redirect. That is the same argument the channel announcement makes, and
the statusline is where it holds for the hour after the announcement scrolled
away.

## Friction

"I know which task I'm on." You do, until this session is summarised. The file
costs one command per transition and is the only thing in the run that survives
that, and a plan whose progress lives in one context window is a plan nobody
outside that window can read.
