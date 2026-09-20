#!/usr/bin/env bash
# Print one digest of where a git tree stands, for stop-guard.sh's entry check.
#
# Usage: tree-snapshot.sh <tree>
# Exit 0 printed a digest, non-zero the tree could not be read. Prints nothing
# on failure, and a caller that cannot read the tree has no comparison to make
# rather than a change to report: an interrupted index, a lock held by another
# git, or a rebase in flight are all "unknown", never "moved".
#
# It lives in its own file because two hooks compute it at two different moments
# and a difference between their two copies would not read as a bug, it would
# read as the tree having moved. That is the whole measurement.
#
# Three signals, because each covers a way of finishing work that the others
# call standing still:
#
#   HEAD                        a session that committed leaves a clean tree
#   diff HEAD                   a session that rewrote a file already modified
#                               leaves the porcelain's shape untouched
#   status --porcelain -uall    a session that filled an untracked directory
#                               leaves one collapsed `?? build/` either way
#
# What it still misses, and why each is left:
#
#   - the content of a file that was already untracked when the session opened.
#     Listing untracked paths is cheap and hashing their contents is not, and
#     this runs at the end of every turn.
#   - anything inside a nested repository. `status` does not descend into a
#     directory carrying its own .git, so a session spent editing a scratch
#     clone or a vendored checkout reads as a tree nobody touched.
#   - who made the change. Nothing in a git tree records that, so a branch
#     switch, a pull, or another session writing to the same tree all read as
#     this session's work. stop-guard.sh bounds that rather than fixing it.

set -uo pipefail

tree="${1-}"
[ -n "$tree" ] || exit 1
command -v cksum >/dev/null 2>&1 || exit 1

# `git diff HEAD` has no meaning before the first commit, and a repo without one
# is a repo whose every file is untracked, which the porcelain covers. So an
# unresolvable HEAD is carried as "no-head" rather than refused.
#
# It would be better to refuse when HEAD is unresolvable because the ref store
# cannot be read, as opposed to because no commit exists yet, since the first is
# a tree this script cannot describe. git gives no way to tell them apart:
# `rev-parse --verify --quiet` exits 1 for both, and `for-each-ref` returns
# empty for both, hiding an unreadable ref exactly as it reports an absent one.
# Refusing on both would disarm the check permanently in any repo before its
# first commit, which is an ordinary place to be writing code. Carrying both
# costs a single nudge, and only in a tree whose refs broke partway through the
# session it had already been read in.
head="$(git -C "$tree" rev-parse --verify --quiet HEAD 2>/dev/null)" || head=""

# Streamed into cksum rather than gathered into variables first. A diff is
# unbounded, and this runs at the end of every turn until the session is either
# routed or nudged: an 80MB file rewritten peaks at 334MB resident streamed,
# against 622MB for a 61MB one held in a shell variable and then piped. What is
# left is git loading the blobs, which is the price of reading content at all
# and is the same for --numstat. Streaming also keeps NUL bytes intact, which a
# command substitution silently drops, and dropping them would hide a change
# confined to them.
#
# `exit 1` inside the group reaches the caller through pipefail, and the digest
# cksum prints from a truncated read is discarded with it: a caller that cannot
# read the tree needs no answer, and a short answer is a wrong one.
digest="$( {
	printf '%s\n' "${head:-no-head}"
	git -C "$tree" status --porcelain -uall 2>/dev/null || exit 1
	[ -n "$head" ] && { git -C "$tree" diff HEAD 2>/dev/null || exit 1; }
	true
} | cksum )" || exit 1

printf '%s\n' "$digest"
