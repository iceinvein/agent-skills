#!/usr/bin/env bash
# A run parked after the critic stage on a machine with no codex. Stage 7 still
# has to happen: the Claude second opinion stands in, with the preamble that
# buys back the independence a same-family reviewer loses.
#
# The run directory sits under the workspace rather than ~/.magpie because file
# graders refuse to follow a link out of the workspace. `magpie --list-runs` is
# what names the path a resume uses, so the shim reports this one.
set -euo pipefail

RUN_ID="pr-1337-1789600000"
RUN_DIR="$PWD/runs/$RUN_ID"
CALLS="$PWD/.magpie-calls.log"

mkdir -p "$RUN_DIR"/findings "$RUN_DIR"/state "$HOME/shims"
: > "$CALLS"

cat > "$HOME/shim-config" <<EOF
RUN_ID="$RUN_ID"
RUN_DIR="$RUN_DIR"
CALLS="$CALLS"
PORT=4599
EOF

# The real magpie is outside the eval sandbox and cannot be executed from
# inside it, so the child gets a fake rather than exit 126. The PATH here also
# leaves out the real codex, which is the condition under test.
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
  *) echo "fake magpie: unsupported subcommand: $*" >&2; exit 64 ;;
esac
SHIM
chmod +x "$HOME/shims/magpie"

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
{"stage":"context","status":"done","codeIntelligence":false,"interface":"none"}
{"stage":"specialists","status":"done"}
{"stage":"dedupe","status":"done"}
{"stage":"critic","status":"done"}
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

# The findings the run already has: one file per specialist focus, the deduped
# set derived from them, and the subset the critic kept. Generated together so
# the chain holds: nothing is kept that was never deduped, and every finding
# cites a line its hunk carries.
python3 - "$RUN_DIR" <<'FINDINGS'
import json, pathlib, sys

run = pathlib.Path(sys.argv[1])

FINDINGS = [
    {
        'id': 'security-1',
        'focus': 'security',
        'domain': 'security',
        'file': 'src/settings/cache.ts',
        'line': 4,
        'severity': 'high',
        'risk': {'impact': 'high', 'likelihood': 'likely', 'confidence': 'high', 'action': 'must-fix'},
        'score': 8,
        'title': 'Tenant settings cache is a process-global Map with no eviction',
        'description': """Observation: put() writes into a module-level Map keyed by tenant id (src/settings/cache.ts:4), with no size bound and no TTL.

Why it matters: a long-lived process accumulates every tenant it has served, and a settings change never reaches the cached copy.

Suggested direction: bound the map and give entries a TTL, or key the cache per request.""",
    },
    {
        'id': 'bugs-1',
        'focus': 'bugs',
        'domain': 'bugs',
        'file': 'src/settings/loader.ts',
        'line': 12,
        'severity': 'medium',
        'risk': {'impact': 'medium', 'likelihood': 'possible', 'confidence': 'medium', 'action': 'should-fix'},
        'score': 6,
        'title': 'Concurrent loads for the same tenant each hit the network',
        'description': """Observation: load() checks the cache, then awaits fetchSettings before writing back (src/settings/loader.ts:12).

Why it matters: N concurrent first requests for one tenant produce N fetches.

Suggested direction: cache the in-flight promise rather than the resolved value.""",
    },
    {
        'id': 'arch-1',
        'focus': 'architecture',
        'domain': 'architecture',
        'file': 'src/settings/loader.ts',
        'line': 10,
        'severity': 'medium',
        'risk': {'impact': 'medium', 'likelihood': 'possible', 'confidence': 'medium', 'action': 'consider'},
        'score': 5,
        'title': 'The loader owns the cache rather than being handed one',
        'description': """Observation: load() calls the cache module's free functions directly (src/settings/loader.ts:10).

Why it matters: no caller can swap the policy, and the loader cannot be tested without the module-global store.

Suggested direction: take the cache as a parameter.""",
    },
    {
        'id': 'perf-1',
        'focus': 'performance',
        'domain': 'performance',
        'file': 'src/settings/cache.ts',
        'line': 12,
        'severity': 'low',
        'risk': {'impact': 'low', 'likelihood': 'possible', 'confidence': 'medium', 'action': 'consider'},
        'score': 3,
        'title': 'clear() evicts every tenant, not the one whose settings changed',
        'description': """Observation: clear() calls store.clear() (src/settings/cache.ts:12) and is the only invalidation the module offers.

Why it matters: one tenant's change flushes the entry for every tenant.

Suggested direction: add delete(tenantId) and leave clear() for shutdown.""",
    },
    {
        'id': 'smell-1',
        'focus': 'code-smells',
        'domain': 'code-smells',
        'file': 'src/settings/cache.ts',
        'line': 8,
        'severity': 'low',
        'risk': {'impact': 'low', 'likelihood': 'unlikely', 'confidence': 'medium', 'action': 'optional'},
        'score': 2,
        'title': 'get() hands back the stored object, so a caller can mutate the cache',
        'description': """Observation: get() returns store.get(tenantId) directly (src/settings/cache.ts:8).

Why it matters: a caller that edits the returned settings edits every later reader's copy.

Suggested direction: freeze the value on put, or return a copy.""",
    },
]

# The critic kept the three above its bar and dropped the two below it.
KEPT = {'security-1', 'bugs-1', 'arch-1'}

def without(finding, *keys):
    return {k: v for k, v in finding.items() if k not in keys}

findings_dir = run / 'findings'
findings_dir.mkdir(parents=True, exist_ok=True)
for focus in ('security', 'bugs', 'performance', 'code-smells', 'architecture'):
    mine = [without(f, 'focus', 'score') for f in FINDINGS if f['focus'] == focus]
    (findings_dir / f'{focus}.json').write_text(json.dumps(mine, indent=2) + '\n')
(findings_dir / 'tests.json').write_text('[]\n')

(run / 'findings.deduped.json').write_text(
    json.dumps([without(f, 'focus') for f in FINDINGS], indent=2) + '\n'
)
(run / 'findings.kept.json').write_text(
    json.dumps([without(f, 'focus', 'score') for f in FINDINGS if f['id'] in KEPT], indent=2) + '\n'
)
FINDINGS

echo "http://127.0.0.1:4599" > "$RUN_DIR/state/server-info"

cat > "$RUN_DIR/brief.json" <<'JSON'
{
  "summary": "Adds a process-global cache in front of tenant settings loads.",
  "riskAreas": ["tenant isolation", "cache invalidation"],
  "conventions": []
}
JSON
