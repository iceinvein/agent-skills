#!/usr/bin/env bash
# The user ticked, unticked and re-ticked findings in the report, then typed
# `post`. state/events is the only record of that, and it has to be folded
# last-event-wins per id: union-minus-deselected would drop perf-1, which the
# user re-selected after unticking it.
#
# The run directory sits under the workspace rather than ~/.magpie because file
# graders refuse to follow a link out of the workspace. `magpie --list-runs` is
# what names the path a resume uses, so the shim reports this one.
set -euo pipefail

RUN_ID="pr-1337-1789600000"
RUN_DIR="$PWD/runs/$RUN_ID"
CALLS="$PWD/.magpie-calls.log"

mkdir -p "$RUN_DIR"/findings "$RUN_DIR"/state "$RUN_DIR"/screen "$HOME/shims"
: > "$CALLS"

cat > "$HOME/shim-config" <<EOF
RUN_ID="$RUN_ID"
RUN_DIR="$RUN_DIR"
CALLS="$CALLS"
PORT=4599
EOF

# The real magpie and gh are outside the eval sandbox and cannot be executed
# from inside it, so the child gets fakes rather than exit 126. Nothing here
# reaches GitHub: the fake post records the ids it was handed and writes the
# per-finding status the real CLI would write.
mkdir -p "$HOME/tmp"
cat > "$HOME/.zshenv" <<'RC'
export PATH="$HOME/shims:/usr/bin:/bin:/usr/sbin:/sbin"
# /usr/bin/python3 is the Xcode shim, and without a writable TMPDIR it fails
# trying to create its xcrun cache in a directory the sandbox blocks.
export TMPDIR="$HOME/tmp"
RC

cat > "$HOME/shims/magpie" <<'SHIM'
#!/usr/bin/env bash
. "$HOME/shim-config"
echo "magpie $*" >> "$CALLS"
case "${1:-}" in
  --list-runs) printf '%s\tactive\t%s\n' "$RUN_ID" "$RUN_DIR" ;;
  status)
    python3 - "${2:-$RUN_DIR}" <<'STATUS'
import json, pathlib, sys

ORDER = ['setup', 'context', 'specialists', 'dedupe', 'critic', 'peer-review', 'report', 'post']
last, error = None, None
for line in (pathlib.Path(sys.argv[1]) / 'log.jsonl').read_text().splitlines():
    if not line.strip():
        continue
    try:
        entry = json.loads(line)
    except ValueError:
        continue
    if entry.get('status') == 'error':
        error = entry.get('stage')
        break
    if entry.get('status') in ('done', 'skipped') and entry.get('stage') in ORDER:
        last = entry['stage']
index = ORDER.index(last) + 1 if last else 0
print(json.dumps({'lastCompleted': last, 'next': ORDER[index] if index < len(ORDER) else 'cleanup', 'error': error}))
STATUS
    ;;
  serve)
    mkdir -p "$RUN_DIR/screen" "$RUN_DIR/state"
    # The eval sandbox refuses listening sockets, so no fake can hold a port
    # open: this writes the server-info the walkthrough reads and exits. The
    # page is never reachable in a case, so no case pins the browser surface.
    echo "http://127.0.0.1:$PORT" > "$RUN_DIR/state/server-info"
    echo "serving $RUN_DIR on http://127.0.0.1:$PORT"
    ;;
  render)
    mkdir -p "$RUN_DIR/screen"
    python3 - "${2:-$RUN_DIR}" "${3:-progress}" <<'RENDER'
import json, pathlib, sys

run, screen = pathlib.Path(sys.argv[1]), sys.argv[2]
findings = run / 'findings.final.json'
rows = ''
if screen == 'findings' and findings.exists():
    for finding in json.loads(findings.read_text()):
        rows += f'<li><input type="checkbox" data-finding-id="{finding["id"]}"> {finding["id"]}: {finding["title"]}</li>'
buttons = '<button>Post Selected</button><button>Post Recommended</button>' if rows else ''
(run / 'screen').mkdir(exist_ok=True)
(run / 'screen' / f'{screen}.html').write_text(
    f'<html><body><h1>magpie {screen}</h1><ul>{rows}</ul>{buttons}</body></html>'
)
RENDER
    echo "rendered ${3:-progress} -> $RUN_DIR/screen/${3:-progress}.html"
    ;;
  post)
    ids=""
    while [ $# -gt 0 ]; do
      [ "$1" = "--ids" ] && ids="${2:-}"
      shift
    done
    {
      echo "{"
      first=1
      for id in ${ids//,/ }; do
        [ $first = 1 ] || echo ","
        printf '  "%s": "posted"' "$id"
        first=0
      done
      echo
      echo "}"
    } > "$RUN_DIR/post-status.json"
    for id in ${ids//,/ }; do echo "posted $id"; done
    echo "posted summary comment"
    ;;
  *) echo "fake magpie: unsupported subcommand: $*" >&2; exit 64 ;;
esac
SHIM
chmod +x "$HOME/shims/magpie"

cat > "$HOME/shims/gh" <<'SHIM'
#!/usr/bin/env bash
. "$HOME/shim-config"
echo "gh $*" >> "$CALLS"
echo "fake gh: no request was made" >&2
exit 1
SHIM
chmod +x "$HOME/shims/gh"

cat > "$RUN_DIR/pr.json" <<'JSON'
{
  "number": 1337,
  "title": "Cache tenant settings in the request path",
  "author": { "login": "asha-platform" },
  "headRefName": "feat/tenant-settings-cache",
  "baseRefName": "main",
  "headRefOid": "9f3a8c0211dbb5fe7a82a2c1b08e0a45c2d1ee01",
  "url": "https://github.com/example/repo/pull/1337"
}
JSON

cat > "$RUN_DIR/log.jsonl" <<'LOG'
{"stage":"preflight","status":"done","missingOptional":["codex"]}
{"stage":"setup","status":"done"}
{"stage":"context","status":"done"}
{"stage":"specialists","status":"done"}
{"stage":"dedupe","status":"done"}
{"stage":"critic","status":"done"}
{"stage":"peer-review","status":"done","provider":"claude"}
{"stage":"report","status":"done"}
LOG

# The PR under review, as setup would have left it: the filtered diff, and a
# worktree holding the head state the diff produces. The hunk headers count the
# lines they carry, and every finding below cites a line inside a hunk, so
# nothing here contradicts anything else.
cat > "$RUN_DIR/diff.patch" <<'PATCH'
diff --git a/src/settings/cache.ts b/src/settings/cache.ts
--- a/src/settings/cache.ts
+++ b/src/settings/cache.ts
@@ -1,5 +1,13 @@
 const store = new Map<string, Settings>()
 
+export function put(tenantId: string, settings: Settings) {
+  store.set(tenantId, settings)
+}
+
+export function get(tenantId: string): Settings | undefined {
+  return store.get(tenantId)
+}
+
 export function clear() {
   store.clear()
 }
diff --git a/src/settings/loader.ts b/src/settings/loader.ts
--- a/src/settings/loader.ts
+++ b/src/settings/loader.ts
@@ -9,3 +9,7 @@
 export async function load(tenantId: string) {
-  return fetchSettings(tenantId)
+  const hit = get(tenantId)
+  if (hit) return hit
+  const fresh = await fetchSettings(tenantId)
+  put(tenantId, fresh)
+  return fresh
 }
PATCH

mkdir -p "$RUN_DIR/worktree/src/settings"

cat > "$RUN_DIR/worktree/src/settings/cache.ts" <<'TS'
const store = new Map<string, Settings>()

export function put(tenantId: string, settings: Settings) {
  store.set(tenantId, settings)
}

export function get(tenantId: string): Settings | undefined {
  return store.get(tenantId)
}

export function clear() {
  store.clear()
}
TS

cat > "$RUN_DIR/worktree/src/settings/loader.ts" <<'TS'
import { get, put } from './cache'

type Settings = { theme: string }

async function fetchSettings(tenantId: string): Promise<Settings> {
  return { theme: 'default' }
}

export async function load(tenantId: string) {
  const hit = get(tenantId)
  if (hit) return hit
  const fresh = await fetchSettings(tenantId)
  put(tenantId, fresh)
  return fresh
}
TS

cat > "$RUN_DIR/findings.final.json" <<'JSON'
[
  {
    "id": "security-1",
    "file": "src/settings/cache.ts",
    "line": 4,
    "severity": "high",
    "risk": { "impact": "high", "likelihood": "likely", "confidence": "high", "action": "must-fix" },
    "domain": "security",
    "title": "Tenant settings cache is a process-global Map with no eviction",
    "description": "Observation: put() writes into a module-level Map with no bound and no TTL.\n\nWhy it matters: a settings change never reaches the cached copy.\n\nSuggested direction: bound the map and give entries a TTL."
  },
  {
    "id": "bugs-1",
    "file": "src/settings/loader.ts",
    "line": 12,
    "severity": "medium",
    "risk": { "impact": "medium", "likelihood": "possible", "confidence": "medium", "action": "should-fix" },
    "domain": "bugs",
    "title": "Concurrent loads for the same tenant each hit the network",
    "description": "Observation: load() awaits fetchSettings before writing back.\n\nWhy it matters: N concurrent first requests produce N fetches.\n\nSuggested direction: cache the in-flight promise."
  },
  {
    "id": "perf-1",
    "file": "src/settings/cache.ts",
    "line": 12,
    "severity": "low",
    "risk": { "impact": "low", "likelihood": "possible", "confidence": "medium", "action": "consider" },
    "domain": "performance",
    "title": "clear() evicts every tenant, not the one whose settings changed",
    "description": "Observation: clear() calls store.clear() (src/settings/cache.ts:12) and is the only invalidation the module offers.\n\nWhy it matters: one tenant's settings change flushes the entry for every tenant, so the next request for each of them refetches.\n\nSuggested direction: add delete(tenantId) and leave clear() for shutdown."
  },
  {
    "id": "arch-1",
    "file": "src/settings/loader.ts",
    "line": 10,
    "severity": "medium",
    "risk": { "impact": "medium", "likelihood": "possible", "confidence": "medium", "action": "consider" },
    "domain": "architecture",
    "title": "The loader owns the cache rather than being handed one",
    "description": "Observation: load() imports the cache module directly.\n\nWhy it matters: no caller can swap the policy.\n\nSuggested direction: take the cache as a parameter."
  },
  {
    "id": "smell-1",
    "file": "src/settings/cache.ts",
    "line": 8,
    "severity": "low",
    "risk": { "impact": "low", "likelihood": "unlikely", "confidence": "medium", "action": "optional" },
    "domain": "code-smells",
    "title": "get() hands back the stored object, so a caller can mutate the cache",
    "description": "Observation: get() returns store.get(tenantId) directly (src/settings/cache.ts:8).\n\nWhy it matters: a caller that edits the returned settings edits every later reader's copy.\n\nSuggested direction: freeze the value on put, or return a copy."
  }
]
JSON

# Ticked security-1 and bugs-1, unticked security-1, then unticked and re-ticked
# perf-1. Last event per id leaves bugs-1 and perf-1 selected.
cat > "$RUN_DIR/state/events" <<'EVENTS'
{"type":"select","findingId":"security-1","timestamp":1789600100000}
{"type":"select","findingId":"bugs-1","timestamp":1789600101000}
{"type":"deselect","findingId":"security-1","timestamp":1789600102000}
{"type":"select","findingId":"perf-1","timestamp":1789600103000}
{"type":"deselect","findingId":"perf-1","timestamp":1789600104000}
{"type":"select","findingId":"perf-1","timestamp":1789600105000}
EVENTS

echo '[]' > "$RUN_DIR/findings/tests.json"
echo "http://127.0.0.1:4599" > "$RUN_DIR/state/server-info"
echo "<html>report</html>" > "$RUN_DIR/screen/findings.html"
