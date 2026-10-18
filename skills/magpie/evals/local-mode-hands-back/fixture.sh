#!/usr/bin/env bash
# A local review of the workspace's own branch, done through peer review. The
# local ladder ends at handoff: print the findings to the caller, archive the
# run, end the turn. There is no PR, so nothing is served, rendered or posted.
#
# The workspace is the repo under review, because local mode reviews the
# caller's working directory in place. The run directory sits under the
# workspace rather than ~/.magpie because file graders refuse to follow a link
# out of the workspace. `magpie --list-runs` is what names the path a resume
# uses, so the shim reports this one.
set -euo pipefail

BRANCH="feat/tenant-settings-cache"
RUN_ID="local-feat-tenant-settings-cache-1789600000"
RUN_DIR="$PWD/runs/$RUN_ID"
ARCHIVE_DIR="$PWD/archive"
CALLS="$PWD/.magpie-calls.log"

mkdir -p "$RUN_DIR"/findings "$HOME/shims"
: > "$CALLS"

cat > "$HOME/shim-config" <<EOF
RUN_ID="$RUN_ID"
RUN_DIR="$RUN_DIR"
ARCHIVE_DIR="$ARCHIVE_DIR"
CALLS="$CALLS"
EOF

# The real magpie and gh are outside the eval sandbox and cannot be executed
# from inside it, so the child gets fakes rather than exit 126. The gh fake is
# here to catch a post that goes around the CLI: a local run has no PR at all.
mkdir -p "$HOME/tmp"
cat > "$HOME/.zshenv" <<'RC'
export PATH="$HOME/shims:/usr/bin:/bin:/usr/sbin:/sbin"
# /usr/bin/python3 is the Xcode shim, and without a writable TMPDIR it fails
# trying to create its xcrun cache in a directory the sandbox blocks.
export TMPDIR="$HOME/tmp"
RC

# Unlike the PR cases' fakes, status reads target.json and picks the ladder the
# way scripts/status-cmd.ts does, so this run resumes at handoff, not report.
cat > "$HOME/shims/magpie" <<'SHIM'
#!/usr/bin/env bash
. "$HOME/shim-config"
echo "magpie $*" >> "$CALLS"
case "${1:-}" in
  --list-runs)
    if [ -d "$RUN_DIR" ]; then
      printf '%s\tactive\t%s\n' "$RUN_ID" "$RUN_DIR"
    else
      printf '%s\tarchived\t%s\n' "$RUN_ID" "$ARCHIVE_DIR/$RUN_ID"
    fi
    ;;
  status)
    python3 - "${2:-$RUN_DIR}" <<'STATUS'
import json, pathlib, sys

run = pathlib.Path(sys.argv[1])
PR = ['setup', 'context', 'specialists', 'dedupe', 'critic', 'peer-review', 'report', 'post']
LOCAL = ['setup', 'context', 'specialists', 'dedupe', 'critic', 'peer-review', 'handoff']
target = run / 'target.json'
mode = json.loads(target.read_text())['mode'] if target.exists() else 'pr'
ORDER = LOCAL if mode == 'local' else PR
last, error = None, None
for line in (run / 'log.jsonl').read_text().splitlines():
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
  target)
    python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["root"])' "${2:-$RUN_DIR}/target.json"
    ;;
  handoff)
    python3 - "${2:-$RUN_DIR}" <<'HANDOFF'
import json, pathlib, sys, time

run = pathlib.Path(sys.argv[1])
if json.loads((run / 'target.json').read_text())['mode'] != 'local':
    sys.stderr.write(f'magpie: handoff only applies to local runs; {run} is a PR run\n')
    sys.exit(2)
for name in ('findings.final.json', 'local.json'):
    if not (run / name).exists():
        sys.stderr.write(f'magpie: handoff: {run / name} is missing\n')
        sys.exit(4)
findings = json.loads((run / 'findings.final.json').read_text())
meta = json.loads((run / 'local.json').read_text())
subject = 'detached HEAD' if meta['branch'] is None else f"local branch {meta['branch']}"
rank = {'must-fix': 0, 'should-fix': 1}
actionable = sorted((f for f in findings if f['risk']['action'] in rank), key=lambda f: rank[f['risk']['action']])
optional = [f for f in findings if f['risk']['action'] not in rank]
counts = {a: sum(f['risk']['action'] == a for f in findings) for a in rank}
sections = [
    f"# magpie local review: {subject} against {meta['baseRef']}",
    f"{counts['must-fix']} must-fix, {counts['should-fix']} should-fix, {len(optional)} optional",
]
for n, f in enumerate(actionable + optional, 1):
    anchor = f['file'] if f.get('line') is None else f"{f['file']}:{f['line']}"
    sections.append(f"{n}. [{f['risk']['action']}] {anchor}: {f['title']}\n\n{f['description']}")
sections.append('Address every must-fix and should-fix, or say why not. The rest are optional.')
print('\n\n'.join(sections))
with (run / 'log.jsonl').open('a') as log:
    log.write(json.dumps({'stage': 'handoff', 'status': 'done', 'findings': len(findings), 'ts': int(time.time() * 1000)}) + '\n')
HANDOFF
    ;;
  cleanup)
    run="${2:-$RUN_DIR}"
    mkdir -p "$ARCHIVE_DIR"
    dest="$ARCHIVE_DIR/$(basename "$run")"
    mv "$run" "$dest"
    echo "archived to $dest"
    ;;
  serve|render|post) echo "fake magpie: $1 reached the CLI on a local run" ;;
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

# The repo under review: main holds the cache without a reader, the branch adds
# put/get and a cached load. The run's own files stay out of the diff.
git init -q -b main .
printf 'runs/\narchive/\n.magpie-calls.log\n' >> .git/info/exclude
export GIT_AUTHOR_NAME="Asha Platform" GIT_AUTHOR_EMAIL="asha@example.com"
export GIT_COMMITTER_NAME="Asha Platform" GIT_COMMITTER_EMAIL="asha@example.com"
mkdir -p src/settings

cat > src/settings/cache.ts <<'TS'
const store = new Map<string, Settings>()

export function clear() {
  store.clear()
}
TS

cat > src/settings/loader.ts <<'TS'
type Settings = { theme: string }

async function fetchSettings(tenantId: string): Promise<Settings> {
  return { theme: 'default' }
}

export async function load(tenantId: string) {
  return fetchSettings(tenantId)
}
TS

git add src
git commit -q -m "feat: tenant settings loader"
git update-ref refs/remotes/origin/main HEAD
git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main
MERGE_BASE=$(git rev-parse HEAD)

git checkout -q -b "$BRANCH"

cat > src/settings/cache.ts <<'TS'
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

cat > src/settings/loader.ts <<'TS'
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

git add src
git commit -q -m "feat: cache tenant settings in the request path" \
  -m "Settings are read on every request; keep them in memory per tenant."
HEAD_OID=$(git rev-parse HEAD)
git diff "$MERGE_BASE" > "$RUN_DIR/diff.patch"
DIFF_SHA=$(shasum -a 256 "$RUN_DIR/diff.patch" | cut -d' ' -f1)

cat > "$RUN_DIR/target.json" <<JSON
{ "mode": "local", "root": "$PWD" }
JSON

cat > "$RUN_DIR/local.json" <<JSON
{
  "branch": "$BRANCH",
  "baseRef": "origin/HEAD",
  "mergeBase": "$MERGE_BASE",
  "head": "$HEAD_OID",
  "dirty": false,
  "author": "Asha Platform",
  "commits": [
    {
      "oid": "$HEAD_OID",
      "headline": "feat: cache tenant settings in the request path",
      "body": "Settings are read on every request; keep them in memory per tenant."
    }
  ],
  "intentFile": null
}
JSON

cat > "$RUN_DIR/diff-source.json" <<JSON
{
  "source": "local",
  "mergeBase": "$MERGE_BASE",
  "baseRef": "origin/HEAD",
  "head": "$HEAD_OID",
  "diffSha256": "$DIFF_SHA"
}
JSON

cat > "$RUN_DIR/log.jsonl" <<'LOG'
{"stage":"preflight","status":"done","missingOptional":["codex"]}
{"stage":"setup","status":"done"}
{"stage":"context","status":"done"}
{"stage":"specialists","status":"done"}
{"stage":"dedupe","status":"done"}
{"stage":"critic","status":"running"}
{"stage":"critic","status":"done","kept":2,"dropped":0,"merged":0,"capped":0}
{"stage":"peer-review","status":"done","provider":"claude"}
LOG

# Each finding cites a line the branch added, with the evidence that line holds.
cat > "$RUN_DIR/findings.final.json" <<'JSON'
[
  {
    "id": "security-1",
    "file": "src/settings/cache.ts",
    "line": 4,
    "evidence": "store.set(tenantId, settings)",
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
    "evidence": "const fresh = await fetchSettings(tenantId)",
    "severity": "medium",
    "risk": { "impact": "medium", "likelihood": "possible", "confidence": "medium", "action": "should-fix" },
    "domain": "bugs",
    "title": "Concurrent loads for the same tenant each hit the network",
    "description": "Observation: load() awaits fetchSettings before writing back.\n\nWhy it matters: N concurrent first requests produce N fetches.\n\nSuggested direction: cache the in-flight promise."
  }
]
JSON

echo '[]' > "$RUN_DIR/findings/tests.json"
