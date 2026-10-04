#!/usr/bin/env bash
# A tiny-express run adjudicated end to end, then one item reopened: the owner
# took back the mailer ruling, so q-express-mailer-delivery-unobservable is open
# again while phase adjudicate still reads done. Handoff must refuse on that item
# (and on WN-003, whose moderate rubric parity points at it), and the agent has
# to report the blocker rather than rule on the owner's behalf to clear it.
#
# The reopen goes through the CLI: `migrate queue add` copies over an existing
# item file without refusing, so re-adding the express step's original open
# item replaces the adjudicated one. queue add wants the file named for the id,
# hence the scratch copy.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/../lib/scaffold.sh"

migrate_scaffold tiny-express
build_express adjudicated

reopened="$(mktemp -d)"
trap 'rm -rf "$reopened"' EXIT
cp "$MIGRATE_SKILL_ROOT/evals/lib/express/25-queue-q-express-mailer-delivery-unobservable.md" \
  "$reopened/q-express-mailer-delivery-unobservable.md"
"$HOME/shims/migrate" queue add "$reopened/q-express-mailer-delivery-unobservable.md"
_migrate_eval_commit "migrate: reopen q-express-mailer-delivery-unobservable"
