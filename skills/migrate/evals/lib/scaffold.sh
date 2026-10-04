# Shared setup for the migrate eval cases. A case's fixture.sh sources this and
# calls the two functions with the eval workspace as cwd:
#
#   . "$(dirname "${BASH_SOURCE[0]}")/../lib/scaffold.sh"
#   migrate_scaffold tiny-express
#   build_express seamed
#
# migrate_scaffold <fixture> compiles the real CLI to $HOME/shims/migrate (the
# skill's own bin/migrate.ts cannot run from inside the eval sandbox), points
# the agent's shell at it through $HOME/.zshenv, copies fixtures/<fixture> to
# ./legacy without its GROUND-TRUTH.md, and makes cwd a git repo with one
# commit.
#
# build_express <stage> replays evals/lib/express/NN-* in order through
# $HOME/shims/migrate until the step that marks <stage>'s phase done, with a
# commit after every step, as references/run-ops.md's checkpoint loop does. It
# needs migrate_scaffold tiny-express to have run first in the same HOME and
# cwd. Stages: probed enumerated seamed extracted parity queued adjudicated
# handed-off.
#
# Both run in a subshell under set -euo pipefail, so any failing command, CLI
# exit included, fails the caller whatever its own shell options are.

MIGRATE_SKILL_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# The fixture HOME has no global git config, and the developer's own may sign
# commits; the identity and the signing switch are fixed here so a commit never
# depends on either.
_migrate_eval_commit() {
  git add -A
  git -c user.name='migrate eval' -c user.email='migrate-eval@example.invalid' \
    -c commit.gpgsign=false commit -q -m "$1"
}

migrate_scaffold() (
  set -euo pipefail
  local name="$1"
  local fixture="$MIGRATE_SKILL_ROOT/fixtures/$name"
  if [[ ! -d "$fixture" ]]; then
    echo "migrate_scaffold: no fixture at $fixture" >&2
    exit 2
  fi

  mkdir -p "$HOME/shims" "$HOME/tmp"
  # bun build --compile leaves a large .bun-build file in its cwd; build from
  # $HOME/tmp so it never lands in the workspace the agent reads.
  (cd "$HOME/tmp" && bun build --compile "$MIGRATE_SKILL_ROOT/bin/migrate.ts" --outfile "$HOME/shims/migrate" >/dev/null)
  cat > "$HOME/.zshenv" <<'RC'
export PATH="$HOME/shims:/usr/bin:/bin:/usr/sbin:/sbin"
# /usr/bin/python3 is the Xcode shim, and without a writable TMPDIR it fails
# trying to create its xcrun cache in a directory the sandbox blocks.
export TMPDIR="$HOME/tmp"
RC

  mkdir "$PWD/legacy"
  cp -R "$fixture/." "$PWD/legacy/"
  rm -f "$PWD/legacy/GROUND-TRUTH.md"

  git init -q "$PWD"
  _migrate_eval_commit "scaffold: $name source"
)

build_express() (
  set -euo pipefail
  local stage="$1" phase
  case "$stage" in
    probed) phase=probe ;;
    enumerated) phase=enumerate ;;
    seamed) phase=seam ;;
    extracted) phase=extract ;;
    parity) phase=parity ;;
    queued) phase=queue ;;
    adjudicated) phase=adjudicate ;;
    handed-off) phase=handoff ;;
    *)
      echo "build_express: unknown stage $stage" >&2
      exit 2
      ;;
  esac
  if [[ ! -x "$HOME/shims/migrate" ]]; then
    echo "build_express: no CLI at $HOME/shims/migrate; run migrate_scaffold first" >&2
    exit 2
  fi
  export PATH="$HOME/shims:$PATH"

  # queue add requires a file named for the item's id, so the numbered prefix
  # comes off in a scratch copy.
  local renamed
  renamed="$(mktemp -d)"
  trap 'rm -rf "$renamed"' EXIT

  local step base name
  for step in "$MIGRATE_SKILL_ROOT"/evals/lib/express/[0-9][0-9]-*; do
    base="${step##*/}"
    name="${base#[0-9][0-9]-}"
    case "$name" in
      import-elements-*.json) migrate import elements "$step" ;;
      import-reqs-*.json) migrate import reqs "$step" ;;
      import-deltas-*.json) migrate import deltas "$step" ;;
      census-*.json) migrate census "$step" ;;
      queue-*.md)
        cp "$step" "$renamed/${name#queue-}"
        migrate queue add "$renamed/${name#queue-}"
        ;;
      *.sh) bash -euo pipefail "$step" ;;
      *)
        echo "build_express: no rule replays $base" >&2
        exit 2
        ;;
    esac
    _migrate_eval_commit "migrate: $base"
    if [[ "$name" == "phase-$phase-done.sh" ]]; then
      exit 0
    fi
  done
  echo "build_express: no step marks phase $phase done" >&2
  exit 1
)
