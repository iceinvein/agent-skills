# Proof prompt

Stage 7b of the walkthrough does not read this file by hand. `magpie proof-prompt
"$RUN_DIR"` picks the findings worth proving from `findings.final.json` (action
must-fix or should-fix, at most 8, highest score first),
takes the fenced `magpie-proof` block below, fills its four placeholders, and writes
one prompt file per finding:

- `<<FINDING>>`: the finding's `id`, `file`, `line`, `risk`, `domain`, `title`,
  `description` and `evidence`, as JSON.
- `<<WORKTREE>>`, `<<DIFF_PATH>>`: the run's worktree and `diff.patch`. In local mode
  the worktree is the caller's own repo.
- `<<OUTPUT_PATH>>`: where this finding's result goes, `proof-<id>.json`.

Each prompt file is the entire task of one `general-purpose` subagent. `magpie
proof-apply "$RUN_DIR"` then reads every result, rejects the set if any is missing or
malformed, drops the disproved findings to `proof-dropped.json`, and marks the rest in
`findings.final.json`. The output contract in the block is exactly what proof-apply
accepts; change one only with the other. All four placeholders must stay in the
block, or proof-prompt exits 1.

````magpie-proof
You are proving or disproving one finding from a code review of a change, by writing a
test that runs it. A finding that a failing test reproduces is shown to the author with
the test; a finding the test shows to be wrong is removed. Getting this right matters
more than getting a result: when you cannot run a fair test, say so.

Time matters here: do not spend time that can be avoided, and the earlier a correct
result is obtained, the better.

Working directory: <<WORKTREE>>
Diff: <<DIFF_PATH>>

## The finding

```json
<<FINDING>>
```

## How to prove it

1. Read the code at `file` and `line`, and the diff, until you can say exactly which
   input or sequence of calls shows the defect the description claims.
2. Find the repository's own test runner from its manifests (`package.json`,
   `pyproject.toml`, `Cargo.toml`, `go.mod`, ...) and its `CLAUDE.md` or `AGENTS.md`.
   Use it as the repository's existing tests do. Install nothing: dependencies were
   installed before you started, and if the runner still cannot run, stop with
   `not-proven`.
3. Write one test file whose name contains `magpie-proof-<id>` (the finding's id), or
   `MagpieProof<id>` where a file name must be an identifier, where the runner
   discovers it, next to the existing tests for that code. The test asserts the
   correct behaviour, so it fails while the defect is present. Take the expected value
   from the finding's description, the diff's intent or the existing tests, never from
   what you assume the code should do. Call the real code on the path the finding
   describes. Mock only what the existing tests mock; a mock that returns what the
   real dependency never would proves nothing.
4. Run only that file, with colour off (`--no-color`, `CI=1`), and in a way that does
   not compile or type-check the whole project: other provers' half-written files sit
   beside yours. Read the output. Anything you save outside the test file, such as the
   run's output, goes in a directory of your own from `mktemp -d`, never a scratchpad or
   temp path another session shares: other provers write there too, and their output
   is not your result.
5. Copy the test's full source and the last 40 lines of output (at most) into your
   result. Then, whatever the outcome, `not-proven` included, delete the test file and
   anything its run created (snapshots, fixtures). Change no other file in the working
   directory: it may be the author's own checkout, and other provers are running in it
   at the same time.

## Which outcome

- `"reproduced"`: the test ran and failed on the assertion, with the wrong behaviour
  the finding describes.
- `"disproved"`: the test ran, exercised the path the finding describes, and passed,
  so the code behaves correctly there. Say in `reason` what stops the defect (a guard,
  a caller that never passes the value), with its file:line.
- `"not-proven"`: anything else. The defect needs what a test here cannot set up (a
  live service, real concurrency, a browser, a security boundary outside the process),
  the runner cannot run, or the test failed for a reason other than the assertion (an
  import error, a missing fixture, a type error). A test that fails for the wrong
  reason is not a reproduction and a test that never reached the path is not a
  disproof: fix it, or report `not-proven` and say why.

## Output contract

Write one JSON object to <<OUTPUT_PATH>> with the Write tool:

```
{
  "id": string,              // the finding's id, verbatim
  "outcome": "reproduced" | "disproved" | "not-proven",
  "reason": string,          // one sentence, under 25 words
  "repro": {                 // REQUIRED with "reproduced" and "disproved"; omit with "not-proven"
    "path": string,          // the test file you wrote, relative to the working directory
    "command": string,       // the exact command that ran it
    "source": string,        // the test file's full source
    "output": string         // the last 40 lines of output, at most
  }
}
```

Then reply with one line: `proof <id>: <outcome>`.
````
