#!/usr/bin/env bash
# Print one digest of the content a git tree holds, for status.sh verify and
# stop-guard.sh's verification gate.
#
# Usage: content-digest.sh <tree>
# Exit 0 printed a digest, non-zero the tree could not be read. Prints nothing
# on stdout on failure, and a caller that cannot read the tree has no comparison
# to make rather than a change to report: an interrupted index or a file git
# cannot open are "unknown", never "changed". git's own error goes to stderr,
# so status.sh verify can say why it recorded nothing; the hook discards it.
#
# It lives in its own file because two scripts compute it at two different
# moments, and a difference between two copies would not read as a bug, it
# would read as the tree having changed since the check passed.
#
# The question here is not tree-snapshot.sh's. That one asks whether the tree
# moved at all, HEAD included. This one asks whether the content a check passed
# on is still the content there, so it is the tree object `git add -A` would
# stage, written from a copy of the index:
#
#   - an untracked file is hashed by content, so the new module edited after
#     its test went green reads as a change;
#   - committing the checked content leaves the digest as it was, so "test,
#     commit, hand back" is not read as a change;
#   - ignored files stay out, as they stay out of everything git compares.
#
# The real index is never touched: staging the partner's work to hash it would
# be a change of its own. The blobs `add` writes land in the object store as
# loose objects, which is the price of hashing content at all.

set -uo pipefail

# Every refusal names its step on stderr: status.sh verify passes it through,
# and "could not read the content" with no cause sends the reader guessing.
fail() {
	printf 'content-digest: %s\n' "$1" >&2
	exit 1
}

tree="${1-}"
[ -n "$tree" ] || fail "needs a tree"
cd "$tree" 2>/dev/null || fail "cannot enter $tree"
git rev-parse --show-toplevel >/dev/null 2>&1 || fail "$tree is not inside a git work tree"
index="$(git rev-parse --git-path index 2>/dev/null)" || fail "git could not name the index of $tree"
[ -n "$index" ] || fail "git could not name the index of $tree"

# The scratch index lives in the git dir rather than the temp dir: a sandbox
# that lets a run write its own tree can refuse the temp dir (the eval sandbox
# did), and git add has to be able to write the git dir in any case.
gitdir="$(git rev-parse --absolute-git-dir 2>/dev/null)" || fail "git could not name the git dir of $tree"
scratch="$(mktemp -d "$gitdir/sluice-digest.XXXXXX" 2>/dev/null)" || fail "could not make a scratch directory under $gitdir"
trap 'rm -rf "$scratch"' EXIT

# A repo with no index yet is one nothing has been staged in, and starting
# from no index is exactly that. An empty file would not be: git reads it as a
# corrupt index.
if [ -f "$index" ]; then
	cp "$index" "$scratch/index" 2>/dev/null || fail "could not copy $index into $scratch"
fi

GIT_INDEX_FILE="$scratch/index" git add -A >/dev/null || exit 1
digest="$(GIT_INDEX_FILE="$scratch/index" git write-tree)" || exit 1
[ -n "$digest" ] || exit 1

printf '%s\n' "$digest"
