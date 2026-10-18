#!/usr/bin/env bash
# Print the test paths a session changed in a way that needs a record, for the
# test-change gate.
#
# Usage: test-changes.sh [--list] <tree> <base>
# Without --list, prints each test path needing a record, one per line, sorted;
# empty output means none does. With --list, prints every test path that
# differs from base (added, modified, deleted, and both ends of a rename), for
# the proof run to copy or, where the path is gone now, delete. Exit 0 printed
# the answer, exit 1 the tree or base could not be read, and then nothing is
# printed: an unreadable tree is "unknown", never "changed", and the caller
# stays silent.
#
# A test that only grows is a test that only asks more of the code, so it
# passes. What needs a record is a test that asks less, or asks nothing:
#
#   - a modified file with any removed line, since an edited assertion is a
#     removed line plus an added one;
#   - a deleted file;
#   - an added line carrying a skip or focus marker, in a new file or an old
#     one, since `it.skip(` switches a test off without removing a line, and
#     `.only(` switches every other test off.
#
# A 100% rename moves a test without changing what it asks, so it passes.
#
# The comparison is base against the working tree as `git add -A` would stage
# it, so untracked test files count. It is staged into a copy of the index, as
# content-digest.sh does it: staging the partner's work in the real index to
# read it would be a change of its own.

set -uo pipefail

mode=records
if [ "${1-}" = "--list" ]; then
	mode=list
	shift
fi
tree="${1-}"
base="${2-}"
[ -n "$tree" ] && [ -n "$base" ] || exit 1
cd "$tree" 2>/dev/null || exit 1
git rev-parse --show-toplevel >/dev/null 2>&1 || exit 1
cd "$(git rev-parse --show-toplevel)" 2>/dev/null || exit 1
git rev-parse --verify --quiet "$base^{commit}" >/dev/null 2>&1 || exit 1
index="$(git rev-parse --git-path index 2>/dev/null)" || exit 1
[ -n "$index" ] || exit 1

markers='\.(skip|only)\(|\bx(it|describe|test)\(|@pytest\.mark\.(skip|xfail)|pytest\.skip\(|\bt\.Skip|@Disabled|@Ignore|#\[ignore\]'

# The list comes from the base rather than HEAD or the working tree: a session
# commits, so HEAD is its to move, and it should not be able to move its own
# tests out of view by editing .sluice-test-paths.
pathspecs=()
if git cat-file -e "$base:.sluice-test-paths" 2>/dev/null; then
	listed="$(git cat-file blob "$base:.sluice-test-paths" 2>/dev/null)" || exit 1
	while IFS= read -r line; do
		line="${line%$'\r'}"
		case "$line" in
		'' | '#'*) continue ;;
		esac
		pathspecs+=(":(glob)$line")
	done <<<"$listed"
	# A list of nothing but comments would otherwise diff every path.
	[ "${#pathspecs[@]}" -gt 0 ] || exit 0
else
	for glob in '**/test/**' '**/tests/**' '**/__tests__/**' '**/spec/**' \
		'**/*.test.*' '**/*.spec.*' '**/*_test.*' '**/test_*.*' \
		'**/__snapshots__/**' '**/*.snap' '**/testdata/**' '**/golden/**'; do
		pathspecs+=(":(glob)$glob")
	done
fi

# The scratch index lives in the git dir for content-digest.sh's reason: a
# sandbox can refuse the temp dir, and git add has to write the git dir anyway.
gitdir="$(git rev-parse --absolute-git-dir 2>/dev/null)" || exit 1
scratch="$(mktemp -d "$gitdir/sluice-test-changes.XXXXXX" 2>/dev/null)" || exit 1
trap 'rm -rf "$scratch"' EXIT
# -p keeps the index's own mtime. A fresh one would make git trust the stat
# data of a file edited in the same second it was staged, and miss a same-size
# edit to it.
if [ -f "$index" ]; then
	cp -p "$index" "$scratch/index" 2>/dev/null || exit 1
fi
export GIT_INDEX_FILE="$scratch/index"
git add -A >/dev/null 2>&1 || exit 1

# The repo's colour, external diff and textconv settings would all change the
# lines the marker grep reads, so every diff turns them off.
plain=(--no-color --no-ext-diff --no-textconv)

# NUL-separated, because git C-quotes a name holding a quote, backslash, tab or
# newline in any other form, and a variable cannot hold a NUL.
git diff --cached "${plain[@]}" -M100% --name-status -z "$base" -- "${pathspecs[@]}" >"$scratch/statuses" || exit 1

flagged=""
while IFS= read -r -d '' status; do
	IFS= read -r -d '' path || exit 1
	source_path=""
	case "$status" in
	R*)
		source_path="$path"
		IFS= read -r -d '' path || exit 1
		;;
	esac
	if [ "$mode" = list ]; then
		# The source too: it is gone now, and the proof's overlay has to remove it
		# from the base, or a file moved into a directory of its own name blocks
		# that directory.
		flagged="$flagged$source_path${source_path:+$'\n'}$path"$'\n'
		continue
	fi
	case "$status" in
	D | T) flagged="$flagged$path"$'\n' ;;
	A | M)
		# A binary file reports "-" for its line counts, and a changed binary
		# snapshot is as much an edit as a changed text one. A new file has
		# nothing to remove, binary or not.
		if [ "$status" = M ]; then
			numstat="$(git diff --cached "${plain[@]}" --numstat "$base" -- ":(literal)$path")" || exit 1
			removed="$(printf '%s\n' "$numstat" | cut -f2)"
			if [ "$removed" != 0 ]; then
				flagged="$flagged$path"$'\n'
				continue
			fi
		fi
		diff="$(git diff --cached "${plain[@]}" -U0 "$base" -- ":(literal)$path")" || exit 1
		if printf '%s\n' "$diff" | sed -n '/^@@/,$p' | grep '^+' | grep -Eq "$markers"; then
			flagged="$flagged$path"$'\n'
		fi
		;;
	esac
done <"$scratch/statuses"

printf '%s' "$flagged" | grep -v '^$' | LC_ALL=C sort -u
exit 0
