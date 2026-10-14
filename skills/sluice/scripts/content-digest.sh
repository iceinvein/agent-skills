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

tree="${1-}"
[ -n "$tree" ] || exit 1
cd "$tree" 2>/dev/null || exit 1
git rev-parse --show-toplevel >/dev/null 2>&1 || exit 1
index="$(git rev-parse --git-path index 2>/dev/null)" || exit 1
[ -n "$index" ] || exit 1

scratch="$(mktemp -d 2>/dev/null)" || exit 1
trap 'rm -rf "$scratch"' EXIT

# A repo with no index yet is one nothing has been staged in, and starting
# from no index is exactly that. An empty file would not be: git reads it as a
# corrupt index.
if [ -f "$index" ]; then
	cp "$index" "$scratch/index" 2>/dev/null || exit 1
fi

GIT_INDEX_FILE="$scratch/index" git add -A >/dev/null || exit 1
digest="$(GIT_INDEX_FILE="$scratch/index" git write-tree)" || exit 1
[ -n "$digest" ] || exit 1

printf '%s\n' "$digest"
