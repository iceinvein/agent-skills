---
type: regex
# Pre-flight settled one worktree per concurrent implementer, and three tasks
# run at once, so three worktrees have to be cut: one loop over the three tasks
# or three separate adds. Agent's `isolation: worktree` alone does not count,
# because a session in worktree mode refuses those switches and every kept run
# that tried it went on to cut the trees by hand. What this cannot see is
# whether each implementer was then told to work in its own tree.
pattern: '"command":"(?:[^"\\]|\\.)*?(?:\\[nt]|\b)for \w+ in 1 2 3\b(?:[^"\\]|\\.)*?git worktree add|(?:"command":"(?:[^"\\]|\\.)*?git worktree add[\s\S]*?){3}'
target: trace
weight: 2
---
