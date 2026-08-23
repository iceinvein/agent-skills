#!/usr/bin/env bash
# sluice plan tooling: the parts of the plan format that a reader can check
# without judgement.
#
# `references/deep-channel.md` is 21KB read once, at the point the plan is
# written, and relied on from memory for the rest of the run. Most of what it
# asks for is not a matter of taste: a Needs no task Offers, a "TBD", a step
# deferring to another task, a plan with no flip or two. Those are checkable, so
# they should be checked rather than remembered.
#
#   plan.sh validate <plan.md>
#   plan.sh import <plan.md> [--dir <path>] [--force]
#
# validate prints one line per finding. An error means the plan cannot be
# dispatched as written; a warning is a judgement call left to its author.
# import seeds the run state's task rows from the plan, so the ids, names, the
# flip, the model marks and the one tier the plan settles come from the file
# rather than from a dozen hand-typed commands. It is safe to re-run: a status or
# a ratified model already recorded is left alone.
#
# Exit: 0 no errors, 2 errors found, 4 bad arguments, 5 jq missing (import only).

set -uo pipefail

err() { echo "plan.sh: $*" >&2; }

usage() {
	echo "usage:" >&2
	sed -n '/^#   plan.sh validate/,/^# Exit:/p' "$0" | sed 's/^# \{0,2\}//' >&2
}

# The parser. Emits tab-separated rows on stdout:
#   summary <task count> <flip task or 0>
#   error|warn  <message>
#   task  <id>  <name>  <tier 3 or ->  <model 1|0>  <flips 1|0>
#
# Only tier 3 is derivable from the plan: Flips and a Review flag are the two
# triggers the plan itself settles. The rest turn on task shape and stay for the
# tier table to decide.
#
# One pass, line-oriented, because the plan format is a strict skeleton rather
# than free markdown. Fenced blocks are skipped: a plan carries signatures and
# commands in them, and a `- [ ]` inside a fence is an example, not a step.
PARSER='
function trim(s) { gsub(/^[ \t]+|[ \t]+$/, "", s); return s }

# Symbols on one side of a Contract line. The two sides are read differently
# because a mistake costs differently on each.
#
# Supply (Offers) is generous: every identifier in the half goes on offer, so a
# return shape spelled `parsePlan(path) -> `PlanDoc`` puts PlanDoc on offer as
# well as parsePlan, which is what the format asks for when it says both sides
# are spelled out whole. An extra symbol on offer costs nothing.
#
# Demand (Needs) is strict, because an extra symbol here is a false error:
# backticked names and signatures only, falling back to the leading identifier
# of each comma-separated part when the half carries neither.
function symbols(half, out, generous,   count, rest, tok, lower, n, parts, i, chunk) {
	lower = half
	gsub(/`/, "", lower)
	lower = tolower(trim(lower))
	if (lower == "" || lower == "none" || lower == "-" || lower == "n/a") return 0
	count = 0

	if (generous) {
		rest = half
		gsub(/`/, " ", rest)
		while (match(rest, /[A-Za-z_][A-Za-z0-9_]*/)) {
			out[++count] = substr(rest, RSTART, RLENGTH)
			rest = substr(rest, RSTART + RLENGTH)
		}
		return count
	}

	rest = half
	while (match(rest, /`[^`]*`/)) {
		chunk = substr(rest, RSTART + 1, RLENGTH - 2)
		rest = substr(rest, RSTART + RLENGTH)
		if (match(chunk, /[A-Za-z_][A-Za-z0-9_]*/))
			out[++count] = substr(chunk, RSTART, RLENGTH)
	}
	rest = half
	gsub(/`/, "", rest)
	while (match(rest, /[A-Za-z_][A-Za-z0-9_]*\(/)) {
		tok = substr(rest, RSTART, RLENGTH - 1)
		out[++count] = tok
		rest = substr(rest, RSTART + RLENGTH)
	}
	if (count == 0) {
		rest = half
		gsub(/`/, "", rest)
		n = split(rest, parts, /[,;]/)
		for (i = 1; i <= n; i++)
			if (match(parts[i], /[A-Za-z_][A-Za-z0-9_]*/))
				out[++count] = substr(parts[i], RSTART, RLENGTH)
	}
	return count
}

function finding(sev, msg) { out[++nout] = sev "\t" msg }

/^[ \t]*```/ { fenced = 1 - fenced; next }
fenced { next }

/^# Plan:/ { has_title = 1 }

/^## / {
	in_rules = (tolower($0) ~ /^## ground rules/) ? 1 : 0
	if (in_rules) has_rules_heading = 1
	# A section after the last task belongs to the plan, not to that task. Left
	# set, cur attributes its prose and any checkbox in it to a task that ended
	# several headings ago.
	cur = 0
	next
}

/^### Task / {
	in_rules = 0
	s = substr($0, 10)
	colon = index(s, ":")
	if (colon == 0) { finding("error", "a task heading has no name: " $0); next }
	id = trim(substr(s, 1, colon - 1))
	if (id !~ /^[0-9]+$/) { finding("error", "a task heading is not numbered: " $0); next }
	id = id + 0
	if (id in seen) {
		finding("error", "task " id " appears twice; a repeated number makes the dependency order unreadable")
	}
	seen[id] = 1
	order[++ntasks] = id
	name[id] = trim(substr(s, colon + 1))
	cur = id
	next
}

in_rules && /^- / { nrules++ }

# Everything below belongs to a task, so a field outside one is a field nobody
# reads.
!cur { next }

# Scanned over every line of a task body, and deliberately ahead of the field
# and step rules: those end in `next`, so a check placed after them never sees a
# step, which is exactly where a "TBD" turns up.
{
	if ($0 ~ /TBD/)
		finding("error", "task " cur ": \"TBD\" is not an instruction")
	if (tolower($0) ~ /same as (task|step)/)
		finding("error", "task " cur ": \"same as ...\" defers to a task its implementer never sees")
}

/^\*\*Contract:\*\*/ {
	has_contract[cur] = 1
	body = substr($0, length("**Contract:**") + 1)
	oi = index(body, "Offers:")
	if (oi > 0) { nh = substr(body, 1, oi - 1); oh = substr(body, oi + 7) }
	else { nh = body; oh = "" }
	ni = index(nh, "Needs:")
	if (ni > 0) nh = substr(nh, ni + 6)
	sub(/\|[ \t]*$/, "", nh)

	delete syms
	n = symbols(nh, syms, 0)
	for (i = 1; i <= n; i++) needs[cur] = needs[cur] " " syms[i]

	delete syms
	n = symbols(oh, syms, 1)
	for (i = 1; i <= n; i++) {
		if (!(syms[i] in offered_by) || cur < offered_by[syms[i]]) offered_by[syms[i]] = cur
	}
	next
}

/^\*\*Touches:\*\*/ {
	has_touches[cur] = 1
	body = substr($0, length("**Touches:**") + 1)
	n = split(body, parts, /\|/)
	for (i = 1; i <= n; i++) {
		p = parts[i]
		sub(/\([^)]*\)[ \t]*$/, "", p)
		p = trim(p)
		if (p == "") continue
		# Accumulated rather than assigned: with three tasks on one path,
		# reporting a single pair leaves the reader serialising two of them and
		# still running the third alongside.
		if (index(" " owners[p] " ", " " cur " ") == 0)
			owners[p] = owners[p] (owners[p] == "" ? "" : " ") cur
	}
	next
}

/^\*\*Flips:\*\*/ { has_flips[cur] = 1; nflips++; flips_list = flips_list (flips_list == "" ? "" : ", ") cur; next }
/^\*\*Review:\*\*/ { has_review[cur] = 1; next }
/^\*\*Model:\*\*/  { has_model[cur] = 1; next }

/^- \[[ xX]\]/ {
	nsteps[cur]++
	# Counted rather than reported here. One warning per step turns a plan
	# written before the proof convention into forty identical lines, and the
	# errors underneath them stop being read.
	if (index($0, "->") == 0) noproof[cur]++
	next
}

END {
	if (!has_title) finding("warn", "no \"# Plan: <topic>\" heading, so the file does not say what it plans")

	if (!has_rules_heading || nrules == 0)
		finding("error", "no Ground Rules with entries; an implementer arrives with its own defaults and uses them on anything left unsaid")

	if (ntasks == 0) {
		finding("error", "no tasks, so there is nothing to dispatch")
	} else {
		for (i = 1; i <= ntasks; i++) {
			id = order[i]
			if (id != i)
				finding("error", "tasks are not numbered 1.." ntasks " in sequence: task " id " sits where " i " should")
		}
		for (i = 1; i <= ntasks; i++) {
			id = order[i]
			if (!(id in has_contract))
				finding("error", "task " id " has no Contract, so a symbol absent from it does not exist for whoever builds it")
			if (!(id in has_touches))
				finding("error", "task " id " has no Touches, and concurrency is derived from it")
			if (!(id in nsteps))
				finding("error", "task " id " has no steps")
			else if (id in noproof)
				finding("warn", "task " id ": " noproof[id] " of " nsteps[id] " steps have no proof after ->, so nothing says they worked")
			if ((id in has_model) && (id in has_flips))
				finding("error", "task " id " carries Flips and a Model mark; the flip is tier 3 and may not be downshifted")
			if ((id in has_model) && (id in has_review))
				finding("error", "task " id " is flagged for Review and carries a Model mark; a tier 3 task may not be downshifted")
		}

		if (nflips == 0)
			finding("error", "no task carries Flips, so nothing in the plan turns anything on")
		else if (nflips > 1)
			finding("error", "two or more tasks carry Flips (" flips_list "); a plan with more than one holds that many branches of work")

		for (i = 1; i <= ntasks; i++) {
			id = order[i]
			n = split(needs[id], want, " ")
			for (j = 1; j <= n; j++) {
				sym = want[j]
				if (sym == "" || ((id "\t" sym) in reported)) continue
				reported[id "\t" sym] = 1
				if (!(sym in offered_by))
					finding("error", "task " id " Needs " sym ", which no task Offers")
				else if (offered_by[sym] > id)
					finding("warn", "task " id " Needs " sym ", offered only by the later task " offered_by[sym])
			}
		}
	}

	for (p in owners) {
		n = split(owners[p], who, " ")
		if (n < 2) continue
		list = who[1]
		for (i = 2; i <= n; i++) list = list (i == n ? " and " : ", ") who[i]
		finding("warn", "tasks " list " " (n == 2 ? "both" : "all") " touch " p ", so they cannot run at the same time")
	}

	flip = 0
	for (i = 1; i <= ntasks; i++) if (order[i] in has_flips) { flip = order[i]; break }
	print "summary\t" ntasks "\t" flip
	for (i = 1; i <= nout; i++) print out[i]
	for (i = 1; i <= ntasks; i++) {
		id = order[i]
		tier = ((id in has_flips) || (id in has_review)) ? "3" : "-"
		print "task\t" id "\t" name[id] "\t" tier "\t" ((id in has_model) ? 1 : 0) "\t" ((id in has_flips) ? 1 : 0)
	}
}
'

# Runs the parser and splits its output into the shell. Sets: NTASKS, FLIP,
# FINDINGS (newline-separated sev\tmsg), TASKROWS (newline-separated), NERR,
# NWARN.
parse_plan() {
	local plan="$1" raw
	raw="$(awk "$PARSER" "$plan")" || { err "could not read $plan"; exit 4; }

	local summary
	summary="$(printf '%s\n' "$raw" | grep '^summary	' | head -1)"
	NTASKS="$(printf '%s' "$summary" | cut -f2)"
	FLIP="$(printf '%s' "$summary" | cut -f3)"
	FINDINGS="$(printf '%s\n' "$raw" | grep -E '^(error|warn)	' || true)"
	TASKROWS="$(printf '%s\n' "$raw" | grep '^task	' || true)"
	NERR="$(printf '%s\n' "$FINDINGS" | grep -c '^error	' || true)"
	NWARN="$(printf '%s\n' "$FINDINGS" | grep -c '^warn	' || true)"
}

# "1 error" / "2 errors", so the header does not read as a template.
plural() { [ "$1" = "1" ] && echo "$1 $2" || echo "$1 $2s"; }

SUB="${1-}"
[ $# -gt 0 ] && shift
if [ -z "$SUB" ]; then
	usage
	exit 4
fi

case "$SUB" in
	validate)
		PLAN="${1-}"
		[ -n "$PLAN" ] || { err "validate needs a plan path"; exit 4; }
		[ -f "$PLAN" ] || { err "no such plan: $PLAN"; exit 4; }
		shift
		[ $# -eq 0 ] || { err "unknown argument: $1"; exit 4; }

		parse_plan "$PLAN"

		head="$(basename "$PLAN"): $(plural "$NTASKS" task)"
		[ "$FLIP" != "0" ] && head="$head, flip at task $FLIP"
		if [ "$NERR" = "0" ] && [ "$NWARN" = "0" ]; then
			echo "$head, no errors"
			exit 0
		fi
		[ "$NERR" != "0" ] && head="$head, $(plural "$NERR" error)"
		[ "$NWARN" != "0" ] && head="$head, $(plural "$NWARN" warning)"
		[ "$NERR" = "0" ] && head="$head, no errors"
		echo "$head"
		echo
		# Errors before warnings. Within each, the parser's own order, which
		# follows the file.
		{ printf '%s\n' "$FINDINGS" | grep '^error	' || true
		  printf '%s\n' "$FINDINGS" | grep '^warn	' || true
		} | while IFS="$(printf '\t')" read -r sev msg; do
			[ -n "$sev" ] || continue
			printf '  %-5s  %s\n' "$sev" "$msg"
		done

		[ "$NERR" = "0" ] || exit 2
		;;

	import)
		PLAN="${1-}"
		[ -n "$PLAN" ] || { err "import needs a plan path"; exit 4; }
		[ -f "$PLAN" ] || { err "no such plan: $PLAN"; exit 4; }
		shift

		DIR="$PWD" FORCE=""
		while [ $# -gt 0 ]; do
			case "$1" in
				--dir)
					if [ $# -lt 2 ] || [ -z "${2-}" ]; then err "--dir needs a path"; exit 4; fi
					case "$2" in --*) err "--dir needs a path, but the next argument is the flag $2"; exit 4 ;; esac
					DIR="$2"; shift 2 ;;
				--force) FORCE=1; shift ;;
				*) err "unknown flag: $1"; exit 4 ;;
			esac
		done

		command -v jq >/dev/null 2>&1 || { err "jq is required"; exit 5; }
		STATUS="$(dirname "$0")/status.sh"
		[ -f "$STATUS" ] || { err "status.sh not found beside this script"; exit 4; }

		parse_plan "$PLAN"

		# A plan with errors in it is a plan nobody should be running yet, so
		# importing one would seed a run against work that has to change first.
		if [ "$NERR" != "0" ]; then
			if [ -n "$FORCE" ]; then
				err "$PLAN has $(plural "$NERR" error); importing anyway because --force was passed"
			else
				err "$PLAN has $(plural "$NERR" error); fix them or re-run with --force (plan.sh validate lists them)"
				exit 2
			fi
		fi

		[ "$NTASKS" != "0" ] || { err "$PLAN has no tasks to import"; exit 2; }

		# The plan marks that a task is mechanical; pre-flight ratifies which model
		# it actually runs on, and that answer lives in run.json. Re-import must
		# not replace it with the placeholder, so the ids already carrying a model
		# are read first and skipped.
		HAS_MODEL=" $(bash "$STATUS" show --json --dir "$DIR" 2>/dev/null |
			jq -r '[.tasks[]? | select(.model != null) | .id] | join(" ")' 2>/dev/null) "

		printf '%s\n' "$TASKROWS" | while IFS="$(printf '\t')" read -r _ id name tier model flips; do
			[ -n "${id:-}" ] || continue
			set -- task "$id" --name "$name" --dir "$DIR"
			[ "$flips" = "1" ] && set -- "$@" --flips
			[ "$tier" != "-" ] && [ -n "$tier" ] && set -- "$@" --tier "$tier"
			case "$HAS_MODEL" in
				*" $id "*) ;;
				*) [ "$model" = "1" ] && set -- "$@" --model cheap ;;
			esac
			bash "$STATUS" "$@" || exit 1
		done || exit 1
		imported="$NTASKS"

		echo "imported $(plural "$imported" task) from $(basename "$PLAN")"
		;;

	*)
		err "unknown subcommand: $SUB"
		usage
		exit 4
		;;
esac
