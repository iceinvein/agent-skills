#!/usr/bin/env bash
# Print the run ledger: what this piece of work actually cost.
#
# The run starts at the channel announcement, not at the session, so a session
# holding three unrelated tasks reports each one separately. A previous ledger
# ends the run before it. `bypass` announces nothing and so prints nothing.
#
# Usage: run-stats.sh [--tests "<what the suite reported>"] [--base <git-ref>]
#                     [--transcript <path>]
#
# Exit 0 printed a ledger, 1 could not read a transcript, 2 no run to report.

set -uo pipefail

TESTS=""
BASE=""
TRANSCRIPT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --tests) TESTS="${2-}"; shift 2 ;;
    --base) BASE="${2-}"; shift 2 ;;
    --transcript) TRANSCRIPT="${2-}"; shift 2 ;;
    -h|--help) sed -n '2,11p' "$0" | cut -c3-; exit 0 ;;
    *) echo "run-stats: unknown argument '$1'" >&2; exit 1 ;;
  esac
done

if ! command -v jq >/dev/null 2>&1; then
  echo "run-stats: jq is required and was not found on PATH" >&2
  exit 1
fi

if [ -z "$TRANSCRIPT" ]; then
  sid="${CLAUDE_CODE_SESSION_ID:-}"
  if [ -z "$sid" ]; then
    echo "run-stats: no --transcript given and CLAUDE_CODE_SESSION_ID is unset" >&2
    exit 1
  fi
  # The session id is unique across projects, so glob rather than guess the slug.
  TRANSCRIPT="$(ls "$HOME"/.claude/projects/*/"$sid".jsonl 2>/dev/null | head -1)"
fi

if [ -z "$TRANSCRIPT" ] || [ ! -f "$TRANSCRIPT" ]; then
  echo "run-stats: transcript not found (looked for '${TRANSCRIPT:-<unresolved>}')" >&2
  exit 1
fi

SUMMARY="$(jq -s '
  # ---- what counts as a real turn ----------------------------------------
  # Transcript stamps carry milliseconds, which fromdateiso8601 will not take.
  def ts: sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601;
  def is_meta: (.isMeta == true) or (.isSidechain == true);
  def texts: [ .message.content[]? | select(.type == "text") | .text ] | join("\n");
  # The channel is stated in one line before proceeding, so the announcement
  # opens the message. Anchoring there is what separates it from prose that
  # merely discusses a channel, which a session about sluice is full of.
  def marker: "^[*_#>[:space:]]*(?<c>fast|main|deep)[[:space:]]+channel";
  def announces: (.type == "assistant") and (is_meta | not)
    and (texts | test(marker; "i"));
  def chan: texts | capture(marker; "i") | .c | ascii_downcase;
  def is_stats_call: (.type == "assistant") and ([
      .message.content[]? | select(.type == "tool_use" and .name == "Bash")
      | select((.input.command // "") | test("run-stats\\.sh"))
    ] | length > 0);
  # Waiting is any turn the partner had to take: a prompt, or an answer to a
  # question you put to them. Leaving the latter out understates the wait on
  # exactly the runs that stopped to ask, which are the ones worth pricing.
  def is_prompt: (.type == "user") and (is_meta | not)
    and (((.message.content | type) == "string"
          or ((.message.content | type) == "array"
              and ([ .message.content[]? | select(.type == "tool_result") ] | length == 0)))
         or ((.toolUseResult | type) == "object" and (.toolUseResult | has("answers"))));

  . as $all
  | [ range(0; $all | length) ] as $ix
  | [ $ix[] | select($all[.] | announces) ] as $ann
  | if ($ann | length) == 0 then { empty: true } else

  # A previous ledger closes the run before it. The call running right now has
  # no announcement after it, so it is skipped rather than closing this run.
  ([ $ix[] | select($all[.] | is_stats_call) ]
    | map(select(. < ($ann | max)))
    | if length == 0 then -1 else max end) as $boundary
  | [ $ann[] | select(. > $boundary) ] as $ann
  | ($ann | min) as $from
  | [ $all[$from:][] | select(.timestamp) ] as $run

  # ---- channel, and the trail if it escalated ----------------------------
  | ([ $ann[] | $all[.] | chan ]
     | reduce .[] as $c ([]; if (. | last) == $c then . else . + [$c] end)) as $trail

  # ---- clocks ------------------------------------------------------------
  | ($run | map(.timestamp) | min) as $start
  | ($run | map(.timestamp) | max) as $end
  | (($end | ts) - ($start | ts)) as $elapsed
  | ([ range(1; $run | length)
       | select($run[.] | is_prompt)
       | ($run[.].timestamp | ts) - ($run[. - 1].timestamp | ts) ]
     | add // 0) as $waiting

  # ---- tools and tokens, main loop only ----------------------------------
  | [ $run[] | select((.type == "assistant") and (is_meta | not))
      | .message.content[]? | select(.type == "tool_use") | .name ] as $tools
  | ([ $run[] | select((.type == "assistant") and (is_meta | not))
       | .message.usage.output_tokens // 0 ] | add // 0) as $out_tok
  | ([ $run[] | select((.type == "assistant") and (is_meta | not))
       | .message.usage.cache_read_input_tokens // 0 ] | add // 0) as $cache_tok

  # ---- dispatched agents -------------------------------------------------
  | ([ $run[] | select(.type == "assistant") | .message.content[]?
       | select(.type == "tool_use" and (.name == "Agent" or .name == "Task"))
       | { key: .id, value: (.input.description // .input.subagent_type // "agent") } ]
     | from_entries) as $labels
  # toolUseResult is whatever the tool returned: object, array or string.
  | [ $run[] | select((.toolUseResult | type) == "object") | select(.toolUseResult.agentId)
      | { label: ($labels[[ .message.content[]? | select(.type == "tool_result") | .tool_use_id ][0]] // "agent"),
          model: (.toolUseResult.resolvedModel // "?"),
          status: (.toolUseResult.status // "?"),
          tokens: (.toolUseResult.totalTokens // 0),
          ms: (.toolUseResult.totalDurationMs // 0),
          tools: (.toolUseResult.totalToolUseCount // 0) } ] as $agents

  | { empty: false,
      trail: ($trail | join(" → ")),
      elapsed: $elapsed, waiting: $waiting,
      tool_total: ($tools | length),
      tool_top: ([ $tools | group_by(.)[] | { n: length, name: (.[0] | ascii_downcase | split("__") | last) } ]
                 | sort_by(-.n) | .[0:3]),
      out_tok: $out_tok, cache_tok: $cache_tok,
      agents: $agents,
      agent_tokens: ([ $agents[].tokens ] | add // 0),
      agent_ms: ([ $agents[].ms ] | add // 0) }
  end
' "$TRANSCRIPT" 2>/dev/null)"

if [ -z "$SUMMARY" ]; then
  echo "run-stats: could not parse '$TRANSCRIPT'" >&2
  exit 1
fi

if [ "$(jq -r '.empty' <<<"$SUMMARY")" = "true" ]; then
  exit 2
fi

# ---- formatting -------------------------------------------------------------

dur() { # seconds -> 1h05m | 3m11s | 42s
  local s=${1%.*} h m
  h=$((s / 3600)); m=$(((s % 3600) / 60)); s=$((s % 60))
  if [ "$h" -gt 0 ]; then printf '%dh%02dm' "$h" "$m"
  elif [ "$m" -gt 0 ]; then printf '%dm%ds' "$m" "$s"
  else printf '%ds' "$s"; fi
}

tok() { # tokens -> 1.2M | 313k | 51.0k | 350
  local n=$1
  if [ "$n" -ge 1000000 ]; then awk -v n="$n" 'BEGIN{printf "%.1fM", n/1000000}'
  elif [ "$n" -ge 100000 ]; then awk -v n="$n" 'BEGIN{printf "%dk", n/1000}'
  elif [ "$n" -ge 1000 ]; then awk -v n="$n" 'BEGIN{printf "%.1fk", n/1000}'
  else printf '%d' "$n"; fi
}

g() { jq -r "$1" <<<"$SUMMARY"; }

printf '─── run %s\n' "$(printf '─%.0s' $(seq 1 36))"
printf 'channel   %s\n' "$(g '.trail')"

elapsed=$(g '.elapsed'); waiting=$(g '.waiting')
if [ "${waiting%.*}" -gt 0 ]; then
  printf 'elapsed   %s · %s of that waiting on you\n' "$(dur "$elapsed")" "$(dur "$waiting")"
else
  printf 'elapsed   %s\n' "$(dur "$elapsed")"
fi

top="$(g '[.tool_top[] | "\(.n) \(.name)"] | join(" · ")')"
if [ -n "$top" ]; then
  printf 'tools     %s · %s\n' "$(g '.tool_total')" "$top"
else
  printf 'tools     %s\n' "$(g '.tool_total')"
fi

printf 'tokens    %s out · %s cache read\n' "$(tok "$(g '.out_tok')")" "$(tok "$(g '.cache_tok')")"
printf 'tests     %s\n' "${TESTS:-not reported}"

# The diff is the branch as a whole against where it left the base, working
# tree included, because uncommitted work is still work this run produced.
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if [ -z "$BASE" ]; then
    for cand in main master; do
      if git rev-parse --verify --quiet "$cand" >/dev/null 2>&1; then
        BASE="$(git merge-base HEAD "$cand" 2>/dev/null)" && break
      fi
    done
    [ -z "$BASE" ] && BASE="HEAD"
  fi
  stat="$(git diff --shortstat "$BASE" 2>/dev/null | sed 's/^ *//')"
  files="$(git diff --name-only "$BASE" 2>/dev/null | wc -l | tr -d ' ')"
  # awk, not sed: BSD sed has no \+ and silently matches nothing.
  ins="$(awk '{for(i=1;i<=NF;i++) if($i ~ /^insertion/) print $(i-1)}' <<<"$stat")"
  del="$(awk '{for(i=1;i<=NF;i++) if($i ~ /^deletion/) print $(i-1)}' <<<"$stat")"
  ins=${ins:-0}; del=${del:-0}

  # A file the run created is not in the diff until it is staged, and staging
  # it here would be a side effect on someone else's index. Count it instead.
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    files=$((files + 1))
    ins=$((ins + $(wc -l <"$f" 2>/dev/null || echo 0)))
  done < <(git ls-files --others --exclude-standard 2>/dev/null)

  [ "$files" -gt 0 ] && printf 'diff      +%s −%s across %s files\n' "$ins" "$del" "$files"
fi

count=$(g '.agents | length')
if [ "$count" -eq 0 ]; then
  printf 'agents    none dispatched\n'
else
  printf 'agents    %s dispatched · %s tok · %s wall\n' \
    "$count" "$(tok "$(g '.agent_tokens')")" "$(dur "$(( $(g '.agent_ms') / 1000 ))")"

  # Up to a dozen rows read as the narrative of the plan. Past that the order
  # stops helping, so show what the run actually spent on and say what is cut.
  if [ "$count" -le 12 ]; then rows='.agents[]'; else rows='(.agents | sort_by(-.tokens) | .[0:10][])'; fi
  while IFS=$'\t' read -r label model status tokens ms tools; do
    model="${model#claude-}"; model="$(sed 's/-[0-9]\{8\}$//' <<<"$model")"
    [ "$status" = "completed" ] && status="" || status="  ($status)"
    printf '  %-22.22s %-10s %6s  %7s  %s tools%s\n' \
      "$label" "$model" "$(tok "$tokens")" "$(dur "$((ms / 1000))")" "$tools" "$status"
  done < <(g "$rows | [.label, .model, .status, .tokens, .ms, .tools] | @tsv")

  if [ "$count" -gt 12 ]; then
    printf '  +%s more · %s tok (dearest 10 shown)\n' \
      "$((count - 10))" "$(tok "$(g '(.agents | sort_by(-.tokens) | .[10:] | map(.tokens) | add) // 0')")"
  fi
fi
