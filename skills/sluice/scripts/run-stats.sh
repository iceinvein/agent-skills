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
# Exit 0 printed a ledger, 2 no run to report. Any other non-zero is the tool
# failing rather than a fact about the run: no jq, no readable transcript, an
# unknown argument, an unresolvable session id. Each prints its reason first.

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
  # The harness writes under whichever config dir it was started with, so read
  # CLAUDE_CONFIG_DIR first and fall back to the default: a machine that has run
  # under both profiles keeps transcripts in both, and a miss under the
  # configured one is not the end of the search.
  for root in "${CLAUDE_CONFIG_DIR:-$HOME/.claude}" "$HOME/.claude"; do
    TRANSCRIPT="$(ls "$root"/projects/*/"$sid".jsonl 2>/dev/null | head -1)"
    [ -n "$TRANSCRIPT" ] && break
  done
fi

if [ -z "$TRANSCRIPT" ] || [ ! -f "$TRANSCRIPT" ]; then
  echo "run-stats: transcript not found (looked for '${TRANSCRIPT:-<unresolved>}')" >&2
  exit 1
fi

# An agent the harness never priced leaves no cost on its tool result, but it
# keeps a transcript of its own beside the session. That file is the only place
# such an agent is ever written down, so read it rather than reporting the work
# as free. Only ids this transcript actually mentions are read: a long-lived
# session accumulates far more logs than any one run dispatched.
#
# No duration is taken from a log. Its span is first timestamp to last, which
# covers the idle between rounds whenever the agent was resumed, and that is
# not a measure of work. Tokens are summed per message rather than per line,
# because one message is written as several lines carrying the same cumulative
# usage, and summing the lines counts the message more than once.
SUBS="$(dirname "$TRANSCRIPT")/$(basename "$TRANSCRIPT" .jsonl)/subagents"
COSTS='{}'
if [ -d "$SUBS" ]; then
  COSTS="$(
    jq -r 'select((.toolUseResult | type) == "object")
           | .toolUseResult.agentId // empty' "$TRANSCRIPT" 2>/dev/null | sort -u |
    while IFS= read -r id; do
      [ -n "$id" ] || continue
      f="$SUBS/agent-$id.jsonl"
      [ -f "$f" ] || continue
      jq -s --arg id "$id" '
        [ .[] | select(.message.usage) ] as $u
        | if ($u | length) == 0 then {} else
          { ($id): {
            tokens: ([ $u[] | { k: (.message.id // "?"),
                                v: (.message.usage.output_tokens // 0) } ]
                     | group_by(.k) | map(map(.v) | max) | add // 0),
            tools: ([ .[] | .message.content[]? | select(.type == "tool_use") ] | length),
            model: ([ .[] | .message.model // empty ] | last // "?") } }
          end' "$f" 2>/dev/null
    done | jq -s 'add // {}' 2>/dev/null
  )"
fi
[ -n "$COSTS" ] || COSTS='{}'

SUMMARY="$(jq -s --argjson costs "$COSTS" --arg sid "$(basename "$TRANSCRIPT" .jsonl)" '
  # ---- what counts as a real turn ----------------------------------------
  # Transcript stamps carry milliseconds, which fromdateiso8601 will not take.
  def ts: sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601;
  def is_meta: (.isMeta == true) or (.isSidechain == true);
  def texts: [ .message.content[]? | select(.type == "text") | .text ] | join("\n");
  # The channel is stated in one line before proceeding, so the announcement
  # opens the message. Anchoring there is what separates it from prose that
  # merely discusses a channel, which a session about sluice is full of.
  def marker: "^[*_#>[:space:]]*(?<c>fast|main|deep)[[:space:]]+channel";
  # Real announcements carry a lead-in the anchor above misses: "Sluice: **deep
  # channel**", "Tier 2 (new contract surface) = **deep channel**". What makes
  # those announcements and not prose is that a label introduces them, so the
  # channel has to follow a colon or an equals directly. Emphasis alone will not
  # do: a closing ** reads the same as an opening one, which let "not a **big**
  # deep channel job" announce. The lead-in cannot cross a sentence or a line,
  # which is what keeps a session reviewing sluice from starting a run per quote.
  def lead: "^[^.!?\n]{0,100}[:=][[:space:]]*[*_]*(?<c>fast|main|deep)[[:space:]]+channel";
  def announces: (.type == "assistant") and (is_meta | not)
    and ((texts | test(marker; "i")) or (texts | test(lead; "i")));
  def chan: (if (texts | test(marker; "i")) then (texts | capture(marker; "i"))
             else (texts | capture(lead; "i")) end) | .c | ascii_downcase;
  def invokes_sluice: (.type == "assistant") and (is_meta | not) and ([
      .message.content[]? | select(.type == "tool_use" and .name == "Skill")
      | select((.input.skill // "") == "sluice")
    ] | length > 0);
  # A call carrying --transcript is reading another run rather than closing this
  # one, unless the transcript it names is this session, which is a documented
  # and legitimate way to meter yourself. Without the exception, a session
  # working on the ledger clips its own run at the last session it tested.
  def is_stats_call: (.type == "assistant") and ([
      .message.content[]? | select(.type == "tool_use" and .name == "Bash")
      | (.input.command // "") as $cmd
      | select($cmd | test("run-stats\\.sh"))
      | select(($cmd | test("--transcript") | not) or ($cmd | test($sid)))
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
  | [ $ix[] | select($all[.] | announces) ] as $said
  # A run whose announcement never matched is still a run when the skill was
  # invoked by name. Both kinds of anchor go in together rather than the
  # invocations being a fallback for the whole file: a session where run 1
  # announced and run 2 did not still has to report run 2 on its own.
  | [ $ix[] | select($all[.] | invokes_sluice) ] as $called
  | (($said + $called) | sort) as $ann
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
  | ([ $said[] | select(. >= $from) | $all[.] | chan ]
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
  # One message is written as several lines, each repeating the same cumulative
  # usage, so these are summed per message rather than per line. Summed per line
  # the figure for this run roughly doubles, and it is the one most likely to
  # be read.
  | ([ $run[] | select((.type == "assistant") and (is_meta | not))
       | select(.message.usage)
       | { k: (.message.id // .uuid // "?"),
           o: (.message.usage.output_tokens // 0),
           c: (.message.usage.cache_read_input_tokens // 0) } ]
     | group_by(.k)) as $usage
  | ([ $usage[] | map(.o) | max ] | add // 0) as $out_tok
  | ([ $usage[] | map(.c) | max ] | add // 0) as $cache_tok

  # ---- dispatched agents -------------------------------------------------
  | ([ $run[] | select(.type == "assistant") | .message.content[]?
       | select(.type == "tool_use" and (.name == "Agent" or .name == "Task"))
       | { key: .id, value: (.input.description // .input.subagent_type // "agent") } ]
     | from_entries) as $labels
  # toolUseResult is whatever the tool returned: object, array or string.
  | [ $run[] | select((.toolUseResult | type) == "object") | select(.toolUseResult.agentId)
      | . as $e
      # Where the harness priced the agent, that is the number: it is the
      # accounting the session itself was billed by, and it covers input as well
      # as output. The log is the fallback for agents the harness never priced,
      # and it holds output tokens only, so the two are different units and the
      # totals below never add one to the other.
      | ($costs[$e.toolUseResult.agentId] // null) as $c
      | (if ($e.toolUseResult.totalTokens != null)
             or ($e.toolUseResult.totalDurationMs != null) then "inline"
         elif $c != null then "log"
         else "none" end) as $src
      # Indexing with null throws, and a result without a tool_result block is
      # not worth failing the whole ledger over.
      | (([ $e.message.content[]? | select(.type == "tool_result") | .tool_use_id ][0]) // "") as $tid
      | { label: ($labels[$tid] // $e.toolUseResult.commandName // "agent"),
          src: $src,
          status: ($e.toolUseResult.status // "?"),
          # Model, tool count and cost all come from whichever source priced the
          # agent, so a row never mixes one source with another.
          model: (if $src == "log" then $c.model
                  else $e.toolUseResult.resolvedModel end // "?"),
          tokens: (if $src == "log" then $c.tokens
                   else $e.toolUseResult.totalTokens end // 0),
          tools: (if $src == "log" then $c.tools
                  else $e.toolUseResult.totalToolUseCount end // 0),
          ms: ($e.toolUseResult.totalDurationMs // 0),
          # The session transcript timestamps when an agent returned, not when
          # it began, so the start is back-derived from its own duration.
          ends: ($e.timestamp | ts),
          starts: (($e.timestamp | ts)
                   - (($e.toolUseResult.totalDurationMs // 0) / 1000)) } ] as $agents

  | [ $agents[] | select(.src == "inline") ] as $priced
  | [ $agents[] | select(.src == "log") ] as $logged
  | [ $agents[] | select(.src == "none") ] as $unpriced

  # Union of the agent intervals: sum the merged runs rather than the raw ones,
  # so overlapping agents are counted once against the clock they shared. Only
  # agents the harness timed are in here; a log carries no duration to add.
  | ([ $priced[] | { s: .starts, e: .ends } ] | sort_by(.s)
     | reduce .[] as $i ([];
         if (length == 0) or (.[-1].e < $i.s)
         then . + [$i]
         else .[0:-1] + [{ s: .[-1].s, e: ([.[-1].e, $i.e] | max) }] end)
     | map(.e - .s) | add // 0) as $agent_span

  | { empty: false,
      trail: (if ($trail | length) == 0 then "not announced" else ($trail | join(" → ")) end),
      elapsed: $elapsed, waiting: $waiting,
      tool_total: ($tools | length),
      tool_top: ([ $tools | group_by(.)[] | { n: length, name: (.[0] | ascii_downcase | split("__") | last) } ]
                 | sort_by(-.n) | .[0:3]),
      out_tok: $out_tok, cache_tok: $cache_tok,
      agents: $agents,
      priced_count: ($priced | length),
      logged_count: ($logged | length),
      unpriced_count: ($unpriced | length),
      agent_tokens: ([ $priced[].tokens ] | add // 0),
      logged_tokens: ([ $logged[].tokens ] | add // 0),
      agent_ms: ([ $priced[].ms ] | add // 0),
      concurrency: (if $agent_span > 0
                    then (([ $priced[].ms ] | add // 0) / 1000) / $agent_span
                    else 0 end) }
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
priced=$(g '.priced_count')
logged=$(g '.logged_count')
unpriced=$(g '.unpriced_count')
if [ "$count" -eq 0 ]; then
  printf 'agents    none dispatched\n'
else
  printf 'agents    %s dispatched' "$count"
  if [ "$priced" -gt 0 ]; then
    # 1.0× means every agent had the clock to itself. On a plan whose graph had
    # independent tasks in it, that number is the finding.
    printf ' · %s tok · %s wall · %s× concurrent' \
      "$(tok "$(g '.agent_tokens')")" "$(dur "$(( $(g '.agent_ms') / 1000 ))")" \
      "$(printf '%.1f' "$(g '.concurrency')")"
  fi
  if [ "$logged" -gt 1 ]; then
    printf ' · %s out from %s logs' "$(tok "$(g '.logged_tokens')")" "$logged"
  elif [ "$logged" -eq 1 ]; then
    printf ' · %s out from 1 log' "$(tok "$(g '.logged_tokens')")"
  fi
  if [ "$priced" -eq 0 ] && [ "$logged" -eq 0 ]; then
    # Nothing priced any of them, so there is no cost to report and none to
    # invent. Saying so beats a row of zeroes that reads as a total, and beats
    # a count of unpriced agents when the count is all of them.
    printf ' · cost not reported'
  elif [ "$unpriced" -gt 0 ]; then
    printf ' · %s unpriced' "$unpriced"
  fi
  printf '\n'

  # Up to a dozen rows read as the narrative of the plan. Past that the order
  # stops helping, so show what the run actually spent on and say what is cut.
  if [ "$count" -le 12 ]; then rows='.agents[]'; else rows='(.agents | sort_by(-.tokens) | .[0:10][])'; fi
  while IFS=$'\t' read -r label model status tokens ms tools src; do
    model="${model#claude-}"; model="$(sed 's/-[0-9]\{8\}$//' <<<"$model")"
    [ "$status" = "completed" ] && status="" || status="  ($status)"
    case "$src" in
      inline) printf '  %-22.22s %-10s %6s  %7s  %s tools%s\n' \
                "$label" "$model" "$(tok "$tokens")" "$(dur "$((ms / 1000))")" "$tools" "$status" ;;
      # A tilde marks the other unit, and the dash is the duration a log cannot
      # give. Both are explained by the footnote below.
      log)    printf '  %-22.22s %-10s %6s  %7s  %s tools%s\n' \
                "$label" "$model" "~$(tok "$tokens")" "-" "$tools" "$status" ;;
      *)      printf '  %-22.22s %-10s %6s  %7s  %s%s\n' \
                "$label" "$model" "-" "-" "cost not reported" "$status" ;;
    esac
  done < <(g "$rows | [.label, .model, .status, .tokens, .ms, .tools, .src] | @tsv")

  [ "$logged" -gt 0 ] && printf '  ~ output tokens from the agent log; the harness never priced these\n'

  if [ "$count" -gt 12 ]; then
    cut_priced="$(g '(.agents | sort_by(-.tokens) | .[10:] | map(select(.src == "inline") | .tokens) | add) // 0')"
    cut_unpriced="$(g '(.agents | sort_by(-.tokens) | .[10:] | map(select(.src != "inline")) | length)')"
    printf '  +%s more · %s tok (dearest 10 shown)' "$((count - 10))" "$(tok "$cut_priced")"
    [ "$cut_unpriced" -gt 0 ] && printf ', %s of them unpriced' "$cut_unpriced"
    printf '\n'
  fi
fi
