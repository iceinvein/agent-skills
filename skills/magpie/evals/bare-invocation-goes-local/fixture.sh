#!/usr/bin/env bash
# A bare /magpie on a feature branch that already has an open PR. With no PR
# named, the walkthrough routes to local mode, so the open PR is a lure: the
# gh fake answers `gh pr view` with it, and the case passes only if gh is never
# asked.
#
# The branch is an orphan history (it was imported, not branched from main), so
# no base has a merge base with it and the real `setup --local` fails in
# localBranchDiff. The walkthrough stops on a failed setup, which keeps the case
# to the routing decision: nothing past setup is dispatched or graded.
set -euo pipefail

BRANCH="feat/tenant-settings-cache"
CALLS="$PWD/.magpie-calls.log"
REPO="$PWD"

mkdir -p "$HOME/shims" "$HOME/tmp"
: > "$CALLS"

cat > "$HOME/shim-config" <<EOF
CALLS="$CALLS"
REPO="$REPO"
EOF

# The real magpie and gh are outside the eval sandbox and cannot be executed
# from inside it, so the child gets fakes rather than exit 126.
cat > "$HOME/.zshenv" <<'RC'
export PATH="$HOME/shims:/usr/bin:/bin:/usr/sbin:/sbin"
export TMPDIR="$HOME/tmp"
RC

# /usr/bin/git is the xcrun shim, which cannot write its cache in the sandbox,
# and local mode needs git for the branch slug. The Command Line Tools binary
# runs when called by full path (skills/sluice/evals/README.md has the details).
cat > "$HOME/shims/git" <<'SHIM'
#!/bin/sh
exec /Library/Developer/CommandLineTools/usr/bin/git "$@"
SHIM
chmod +x "$HOME/shims/git"

# setup --local makes the checks scripts/local-diff.ts makes, with the same
# messages, and writes what setup-cmd.ts writes for a local run when they pass.
# The PR path is not faked: reaching it fails the case.
cat > "$HOME/shims/magpie" <<'SHIM'
#!/usr/bin/env bash
. "$HOME/shim-config"
echo "magpie $*" >> "$CALLS"
case "${1:-}" in
  --list-runs) ;;
  setup)
    shift
    run_dir="$1"; shift
    local_mode=0 base="origin/HEAD" repo="$PWD"
    while [ $# -gt 0 ]; do
      case "$1" in
        --local) local_mode=1 ;;
        --base) base="$2"; shift ;;
        --repo) repo="$2"; shift ;;
        --intent-file) shift ;;
      esac
      shift
    done
    if [ "$local_mode" = 0 ]; then
      echo "fake magpie: PR setup is not faked" >&2
      exit 64
    fi
    mkdir -p "$run_dir/findings"
    if ! git -C "$repo" rev-parse --verify -q "$base^{commit}" > /dev/null; then
      echo "{\"stage\":\"local-diff\",\"status\":\"error\",\"error\":\"cannot resolve base ref $base to a commit\"}" >> "$run_dir/log.jsonl"
      echo "magpie: cannot resolve base ref $base to a commit" >&2
      exit 4
    fi
    if ! merge_base=$(git -C "$repo" merge-base "$base" HEAD); then
      echo "{\"stage\":\"local-diff\",\"status\":\"error\",\"error\":\"no merge base between $base and HEAD: \"}" >> "$run_dir/log.jsonl"
      echo "magpie: no merge base between $base and HEAD: " >&2
      exit 4
    fi
    head=$(git -C "$repo" rev-parse HEAD)
    branch=$(git -C "$repo" symbolic-ref --short -q HEAD || true)
    git -C "$repo" diff --no-color --no-ext-diff "$merge_base" > "$run_dir/diff.patch"
    printf '{ "mode": "local", "root": "%s" }\n' "$repo" > "$run_dir/target.json"
    git -C "$repo" log --format=%H%x1f%s%x1f%b%x1e "$merge_base..HEAD" |
      python3 -c '
import json, sys
branch, base, merge_base, head = sys.argv[1:]
commits = []
for record in sys.stdin.read().split("\x1e"):
    if record.strip():
        oid, headline, body = record.strip("\n").split("\x1f")
        commits.append({"oid": oid, "headline": headline, "body": body.strip()})
print(json.dumps({"branch": branch or None, "baseRef": base, "mergeBase": merge_base, "head": head,
                  "dirty": False, "author": "Asha Platform", "commits": commits, "intentFile": None}, indent=2))
' "$branch" "$base" "$merge_base" "$head" > "$run_dir/local.json"
    echo '[]' > "$run_dir/findings/tests.json"
    printf '%s\n' '{"stage":"preflight","status":"done","missingOptional":["codex"]}' '{"stage":"setup","status":"done"}' > "$run_dir/log.jsonl"
    echo "magpie: codex not found; peer review will use a Claude subagent"
    echo "setup done: $run_dir"
    ;;
  target)
    python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["root"])' "${2}/target.json"
    ;;
  *) echo "fake magpie: unsupported subcommand: $*" >&2; exit 64 ;;
esac
SHIM
chmod +x "$HOME/shims/magpie"

cat > "$HOME/shims/gh" <<'SHIM'
#!/usr/bin/env bash
. "$HOME/shim-config"
echo "gh $*" >> "$CALLS"
if [ "${1:-} ${2:-}" = "pr view" ] || [ "${1:-} ${2:-}" = "pr list" ]; then
  echo '{"number":1337,"title":"feat: cache tenant settings","headRefName":"feat/tenant-settings-cache","state":"OPEN"}'
  exit 0
fi
echo "fake gh: no request was made" >&2
exit 1
SHIM
chmod +x "$HOME/shims/gh"

export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
git init -q -b main .
git config commit.gpgsign false
printf '.magpie-calls.log\n' >> .git/info/exclude
export GIT_AUTHOR_NAME="Asha Platform" GIT_AUTHOR_EMAIL="asha@example.com"
export GIT_COMMITTER_NAME="Asha Platform" GIT_COMMITTER_EMAIL="asha@example.com"
mkdir -p src/settings

cat > src/settings/cache.ts <<'TS'
const store = new Map<string, Settings>()

export function clear() {
  store.clear()
}
TS

git add src
git commit -q -m "feat: tenant settings store"
git update-ref refs/remotes/origin/main HEAD
git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main
git checkout -q --orphan "$BRANCH"

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

git add src
git commit -q -m "feat: cache tenant settings in the request path"
