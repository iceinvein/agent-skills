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
# flip, the model marks and the tiers come from the file rather than from a dozen
# hand-typed commands. It is safe to re-run: a status, a review mark or a
# ratified model already recorded is left alone, and a tier is only ever raised.
#
# Exit: 0 no errors, 2 errors found, 4 bad arguments, 5 jq missing (import only).

set -uo pipefail

err() { echo "plan.sh: $*" >&2; }

# ASCII unit separator. Tab would be merged by `read`; see the parser comment.
SEP="$(printf '\037')"

usage() {
	echo "usage:" >&2
	sed -n '/^#   plan.sh validate/,/^# Exit:/p' "$0" | sed 's/^# \{0,2\}//' >&2
}

# The parser. Emits rows on stdout separated by 0x1f, the ASCII unit separator,
# NOT by a tab. Tab is an IFS *whitespace* character, so `read` merges runs of it
# and drops empty fields: one task with an empty Needs then shifts every later
# field left, which is how the graph columns silently swapped. 0x1f is
# non-whitespace, so empty columns survive.
#
# Rows:
#   summary <task count> <flip task or 0>
#   error|warn  <message>
#   task  <id>  <name>  <tier 0-3>  <model 1|0>  <flips 1|0>  <needs>  <offers>  <touches>
#
# The last three are space-separated and are what answers "which tasks may go
# now": a task is ready when every Needs it names is offered by something already
# done, and two ready tasks are safe together when their Touches are disjoint.
#
# The tier is a floor derived from what the plan actually settles: an (edit) in
# Touches means existing code changed, no (test) means nothing executable covers
# the task, and Flips or a Review flag is tier 3 outright. A task matching more
# than one row takes the highest, per the tier table.
#
# One pass, line-oriented, because the plan format is a strict skeleton rather
# than free markdown. Fenced blocks are skipped: a plan carries signatures and
# commands in them, and a `- [ ]` inside a fence is an example, not a step.
PARSER='
BEGIN { SEP = sprintf("%c", 31) }

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
# of each comma-separated part when the half carries neither. Primitive type
# names are dropped from it: a return shape drags in whatever it is spelled with,
# and no task in any plan creates `string`.
function is_primitive(w) {
	return (w == "string" || w == "number" || w == "boolean" || w == "bool" ||
	        w == "void" || w == "any" || w == "unknown" || w == "never" ||
	        w == "null" || w == "undefined" || w == "int" || w == "float" ||
	        w == "object" || w == "Promise" || w == "Array")
}

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
		# The leading identifier of a backticked chunk, unless that is a wrapper
		# like Promise<Config> or Array<TaskRow>: then the dependency is what it
		# wraps, and taking the leading one both misses the real symbol and
		# invents a false one.
		while (match(chunk, /[A-Za-z_][A-Za-z0-9_]*/)) {
			tok = substr(chunk, RSTART, RLENGTH)
			chunk = substr(chunk, RSTART + RLENGTH)
			if (!is_primitive(tok)) { out[++count] = tok; break }
		}
	}
	rest = half
	gsub(/`/, "", rest)
	while (match(rest, /[A-Za-z_][A-Za-z0-9_]*\(/)) {
		tok = substr(rest, RSTART, RLENGTH - 1)
		if (!is_primitive(tok)) out[++count] = tok
		rest = substr(rest, RSTART + RLENGTH)
	}
	if (count == 0) {
		rest = half
		gsub(/`/, "", rest)
		n = split(rest, parts, /[,;]/)
		for (i = 1; i <= n; i++) {
			chunk = parts[i]
			# Guarded like the strict rules above. Unguarded, a half whose every
			# candidate was a primitive fell through to here and the filter was
			# undone by the code meant to back it up.
			while (match(chunk, /[A-Za-z_][A-Za-z0-9_]*/)) {
				tok = substr(chunk, RSTART, RLENGTH)
				chunk = substr(chunk, RSTART + RLENGTH)
				if (!is_primitive(tok)) { out[++count] = tok; break }
			}
		}
	}
	return count
}

function finding(sev, msg) { out[++nout] = sev SEP msg }

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
		offers[cur] = offers[cur] " " syms[i]
	}
	next
}

/^\*\*Touches:\*\*/ {
	has_touches[cur] = 1
	body = substr($0, length("**Touches:**") + 1)
	n = split(body, parts, /\|/)
	for (i = 1; i <= n; i++) {
		# The path is everything before the first parenthesis. Stripping only a
		# trailing annotation left the rest of a mid-field one in the path, and
		# those fragments then read as real paths: two tasks with disjoint files
		# came out sharing "(edit)" and were serialised for nothing.
		p = parts[i]
		if (index(p, "(") > 0) p = substr(p, 1, index(p, "(") - 1)
		p = trim(p)
		if (p == "") continue
		# The annotation is what the tier table turns on, so it is kept rather
		# than stripped and forgotten: an (edit) means existing code changed, and
		# the absence of any (test) means nothing executable covers the task.
		if (parts[i] ~ /\(edit\)/) has_edit[cur] = 1
		if (parts[i] ~ /\(test\)/) has_test[cur] = 1
		if (parts[i] ~ /\(new\)/)  has_new[cur] = 1
		# Under-tiering is the unsafe direction: an unrecognised annotation, or a
		# missing one, reads as "nothing was edited here" and the task then owes
		# no review. Say so rather than deriving from a spelling nobody checked.
		if (parts[i] !~ /\((new|edit|test)\)/)
			finding("warn", "task " cur " Touches " p " with no (new), (edit) or (test) annotation, so its tier is derived as if nothing was edited")
		else if (parts[i] !~ /\((new|edit|test)\)[ \t]*$/)
			finding("warn", "task " cur " Touches " p " with text after its annotation; the tier reads correctly but the line is not the format")
		# Accumulated rather than assigned: with three tasks on one path,
		# reporting a single pair leaves the reader serialising two of them and
		# still running the third alongside.
		if (index(" " owners[p] " ", " " cur " ") == 0)
			owners[p] = owners[p] (owners[p] == "" ? "" : " ") cur
		if (index(" " paths[cur] " ", " " p " ") == 0)
			paths[cur] = paths[cur] (paths[cur] == "" ? "" : " ") p
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

	# A task matching more than one row takes the highest of them, which is what
	# the tier table says and the reason this is a max rather than a chain of
	# elses. Computed once, ahead of both the histogram and the task rows.
	# The LAST task demanding each symbol, so "later tasks build on it" answers
	# for any consumer rather than only the earliest. Kept as a minimum, one early
	# consumer hid every later one and the producer three tasks were built blind
	# against came out owing no review at all.
	for (i = 1; i <= ntasks; i++) {
		n = split(needs[order[i]], want, " ")
		for (j = 1; j <= n; j++)
			if (want[j] != "" && (!(want[j] in last_demand) || order[i] > last_demand[want[j]]))
				last_demand[want[j]] = order[i]
	}

	for (i = 1; i <= ntasks; i++) {
		id = order[i]
		t = 0
		if (id in has_edit) t = 1
		# A task whose only path is a test is changing a suite that already
		# exists: the format offers no "(test) (edit)" spelling, so the annotation
		# cannot say so, and reading it as a creation leaves the task owing
		# nothing. Under-tiering is the unsafe direction.
		if ((id in has_test) && !(id in has_new) && !(id in has_edit)) t = 1
		n = split(offers[id], mine, " ")
		for (j = 1; j <= n; j++)
			if (mine[j] != "" && (mine[j] in last_demand) && last_demand[mine[j]] > id) t = (t > 1 ? t : 1)
		if (!(id in has_test)) t = (t > 2 ? t : 2)
		if ((id in has_flips) || (id in has_review)) t = 3
		tier_of[id] = t
	}

	flip = 0
	for (i = 1; i <= ntasks; i++) if (order[i] in has_flips) { flip = order[i]; break }
	# The histogram is what prices the review question at pre-flight: "four of
	# nine need a reviewer" is a decision a partner can weigh, and counting it
	# by hand off a nine-task plan is how the count comes out wrong.
	hist = ""
	for (t = 0; t <= 3; t++) {
		c = 0
		for (i = 1; i <= ntasks; i++) if (tier_of[order[i]] == t) c++
		if (c > 0) hist = hist (hist == "" ? "" : " ") t ":" c
	}
	print "summary" SEP ntasks SEP flip SEP hist
	for (i = 1; i <= nout; i++) print out[i]
	for (i = 1; i <= ntasks; i++) {
		id = order[i]
		tier = tier_of[id]
		print "task" SEP id SEP name[id] SEP tier SEP ((id in has_model) ? 1 : 0) SEP ((id in has_flips) ? 1 : 0) \
			SEP trim(needs[id]) SEP trim(offers[id]) SEP trim(paths[id])
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
	summary="$(printf '%s\n' "$raw" | grep "^summary$SEP" | head -1)"
	NTASKS="$(printf '%s' "$summary" | cut -d"$SEP" -f2)"
	FLIP="$(printf '%s' "$summary" | cut -d"$SEP" -f3)"
	TIERS="$(printf '%s' "$summary" | cut -d"$SEP" -f4)"
	FINDINGS="$(printf '%s\n' "$raw" | grep -E "^(error|warn)$SEP" || true)"
	TASKROWS="$(printf '%s\n' "$raw" | grep "^task$SEP" || true)"
	NERR="$(printf '%s\n' "$FINDINGS" | grep -c "^error$SEP" || true)"
	NWARN="$(printf '%s\n' "$FINDINGS" | grep -c "^warn$SEP" || true)"
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
		[ -n "$TIERS" ] && head="$head, tiers $TIERS"
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
		{ printf '%s\n' "$FINDINGS" | grep "^error$SEP" || true
		  printf '%s\n' "$FINDINGS" | grep "^warn$SEP" || true
		} | while IFS="$SEP" read -r sev msg; do
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

		# The tier table takes the highest row a task matches, so a tier raised by
		# hand is a decision and re-import may only ever raise. Lowering it back
		# silently un-decides it and drops the task out of the review debt it was
		# owed, which is the opposite of what re-import is for.
		RECORDED_TIERS="$(bash "$STATUS" show --json --dir "$DIR" 2>/dev/null |
			jq -r '[.tasks[]? | select(.tier != null) | "\(.id):\(.tier)"] | join(" ")' 2>/dev/null)"

		printf '%s\n' "$TASKROWS" | while IFS="$SEP" read -r _ id name tier model flips needs offers touches; do
			[ -n "${id:-}" ] || continue
			set -- task "$id" --name "$name" --dir "$DIR"
			# The flip is a plan fact rather than a run decision, so import is
			# authoritative on it both ways. Add-only left a moved flip set on two
			# tasks, and the render then named the wrong milestone.
			if [ "$flips" = "1" ]; then set -- "$@" --flips; else set -- "$@" --no-flips; fi
			if [ -n "$tier" ] && [ "$tier" != "-" ]; then
				recorded=""
				for pair in $RECORDED_TIERS; do
					case "$pair" in "$id:"*) recorded="${pair#*:}" ;; esac
				done
				if [ -z "$recorded" ] || [ "$tier" -gt "$recorded" ]; then
					set -- "$@" --tier "$tier"
				fi
			fi
			case "$HAS_MODEL" in
				*" $id "*) ;;
				*) [ "$model" = "1" ] && set -- "$@" --model cheap ;;
			esac
			# Passed unconditionally, empty included: the graph is a plan fact like
			# the flip, so an edge the plan dropped has to be cleared rather than
			# left behind reporting a contract that no longer exists.
			set -- "$@" --needs "${needs:-}" --offers "${offers:-}" --touches "${touches:-}"
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
