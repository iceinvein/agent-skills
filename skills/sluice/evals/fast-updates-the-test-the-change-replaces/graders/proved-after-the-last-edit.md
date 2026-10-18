---
type: regex
# The proof runs the updated test against the session's starting code, so it
# has to follow the test change and describe the tree as handed back: an Edit
# or Write to tests/deploy.test.js, then a tests-changed call no later edit
# follows. Anchored on the command invoking status.sh, as
# verified-after-the-last-edit is, so a quoted mention does not count. Options
# (--because, --base, --with) may sit before `--`, and the suite after it may
# be scoped (`node --test tests/deploy.test.js`), but it must be the fixture's
# runner, so `--none` or `-- true` does not pass. Not seen here: whether the
# call exited 0, and edits made through Bash after it. So where the proof
# itself fails (tests-changed cuts its scratch worktree under $TMPDIR, which
# a macOS sandbox can refuse), this grader still passes on the call.
pattern: '"name":"(?:Write|Edit|MultiEdit)","input":\{(?:"(?:[^"\\]|\\.)*"|[^"{}])*?"file_path":"(?:[^"]*/)?tests/deploy\.test\.js"[\s\S]*?"command":"(?:(?:[^"\\]|\\.)*?(?:[\s/]|\\[nt]))?status\.sh(?:\\"|'')?(?:\s|\\[nt])+tests-changed(?:\s|\\[nt])(?:[^"\\]|\\.)*?(?:\s|\\[nt])--(?:\s|\\[nt])+(?:npm(?:\s|\\[nt])+(?:run(?:\s|\\[nt])+)?test|node(?:\s|\\[nt])+--test)(?=\s|\\[nt]|\\"|"|[;&|])(?![\s\S]*"name":"(?:Write|Edit|MultiEdit|NotebookEdit)")'
flags: i
target: trace
weight: 3
---
