#!/usr/bin/env bash
# A crashed run parked after the context stage, whose diff split into seven
# shards. Stage 4 owes the user a stop before it dispatches 35 subagents.
#
# The run directory sits under the workspace rather than ~/.magpie because file
# graders refuse to follow a link out of the workspace. `magpie --list-runs` is
# what names the path a resume uses, so the shim reports this one.
set -euo pipefail

RUN_ID="pr-1337-1789600000"
RUN_DIR="$PWD/runs/$RUN_ID"
CALLS="$PWD/.magpie-calls.log"

mkdir -p "$RUN_DIR"/findings "$RUN_DIR"/state "$RUN_DIR"/shards "$HOME/shims"
: > "$CALLS"

# The real magpie, gh and codex are outside the eval sandbox and cannot be
# executed from inside it, so the child gets fakes rather than exit 126. A
# .zshenv in the sandboxed HOME is the only startup file the Bash tool reads.
cat > "$HOME/shim-config" <<EOF
RUN_ID="$RUN_ID"
RUN_DIR="$RUN_DIR"
CALLS="$CALLS"
PORT=4599
EOF

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
  shard) echo "re-sharded; see shards/manifest.json" ;;
  dedupe) echo "fake magpie: dedupe is out of scope for this case" >&2; exit 64 ;;
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
  "title": "Split the billing monolith into per-tenant workers",
  "author": { "login": "asha-platform" },
  "headRefName": "feat/tenant-workers",
  "baseRefName": "main",
  "headRefOid": "9f3a8c0211dbb5fe7a82a2c1b08e0a45c2d1ee01",
  "url": "https://github.com/example/repo/pull/1337"
}
JSON

cat > "$RUN_DIR/log.jsonl" <<'LOG'
{"stage":"preflight","status":"done","missingOptional":["codex"]}
{"stage":"setup","status":"done"}
{"stage":"context","status":"done"}
LOG

echo '[]' > "$RUN_DIR/findings/tests.json"
echo "http://127.0.0.1:4599" > "$RUN_DIR/state/server-info"

# Seven shards: over the four-shard gate, so the run owes a stop. The patches
# are generated first and the manifest is derived from them, so the counts the
# run reports back are the counts on disk.
python3 - "$RUN_DIR" <<'SHARDS'
import json, pathlib, sys

run = pathlib.Path(sys.argv[1])
shards_dir = run / 'shards'
shards_dir.mkdir(parents=True, exist_ok=True)

# Sized so each shard lands just under the 6000-line budget, which is what
# makes a seven-way split the honest consequence of the default flags.
FILES_PER_SHARD = 22
HUNKS_PER_FILE = 32

manifest_shards = []
full_diff = []
for shard_id in range(1, 8):
    files, lines = [], []
    for n in range(FILES_PER_SHARD):
        path = f'src/pkg-{shard_id}/worker-{n:02d}.ts'
        files.append(path)
        lines += [f'diff --git a/{path} b/{path}', f'--- a/{path}', f'+++ b/{path}']
        for hunk in range(HUNKS_PER_FILE):
            # Each hunk carries 3 context lines and swaps 1 line for 3, so the
            # old side is 4 lines and the new side 6, and the new file's line
            # numbers run 2 ahead per hunk already applied.
            old_head = hunk * 6 + 1
            new_head = old_head + hunk * 2
            lines.append(f'@@ -{old_head},4 +{new_head},6 @@')
            lines += [
                f' export function charge{hunk}(tenantId: string, amount: number) {{',
                '-  return gateway.charge(amount)',
                '+  const account = accounts.for(tenantId)',
                '+  if (!account) throw new TenantMissing(tenantId)',
                '+  return gateway.charge(account, amount)',
                ' }',
                ' ',
            ]
    patch = '\n'.join(lines) + '\n'
    (shards_dir / f'shard-{shard_id}.patch').write_text(patch)
    full_diff.append(patch)
    manifest_shards.append({
        'id': shard_id,
        'path': f'shards/shard-{shard_id}.patch',
        'files': files,
        'lines': len(lines),
    })

(run / 'diff.patch').write_text(''.join(full_diff))

worktree = run / 'worktree'
for shard in manifest_shards:
    for path in shard['files']:
        target = worktree / path
        target.parent.mkdir(parents=True, exist_ok=True)
        body = []
        for hunk in range(HUNKS_PER_FILE):
            body += [
                f'export function charge{hunk}(tenantId: string, amount: number) {{',
                '  const account = accounts.for(tenantId)',
                '  if (!account) throw new TenantMissing(tenantId)',
                '  return gateway.charge(account, amount)',
                '}',
                '',
            ]
        target.write_text('\n'.join(body))
(shards_dir / 'manifest.json').write_text(
    json.dumps(
        {
            'budget': 6000,
            'maxFiles': 80,
            'totalFiles': sum(len(s['files']) for s in manifest_shards),
            'totalLines': sum(s['lines'] for s in manifest_shards),
            'shards': manifest_shards,
        },
        indent=2,
    )
    + '\n'
)
SHARDS

cat > "$RUN_DIR/brief.json" <<'JSON'
{
  "summary": "Splits billing into per-tenant workers across 214 files.",
  "riskAreas": ["tenant isolation", "payment retries"],
  "conventions": []
}
JSON
