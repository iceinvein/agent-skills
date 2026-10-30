#!/usr/bin/env bash
# The activity fetch asks pr view for different fields than setup's first call.
case "$*" in
  # cleanup asks each saved PR ref's state: 1234 is open, 9 closed, 5 in a state
  # gh never reports, 404 errors, and any other PR is merged.
  *"--json state"*)
    case "$3" in
      1234) echo '{"state":"OPEN"}' ;;
      9) echo '{"state":"CLOSED"}' ;;
      5) echo '{"state":"WEIRD"}' ;;
      404) echo 'GraphQL: Could not resolve to a PullRequest' >&2; exit 1 ;;
      *) echo '{"state":"MERGED"}' ;;
    esac
    exit 0
    ;;
  *statusCheckRollup*)
    cat <<'JSON'
{
  "statusCheckRollup": [
    { "__typename": "CheckRun", "name": "build", "status": "COMPLETED", "conclusion": "FAILURE", "detailsUrl": "https://ci.example/1" }
  ],
  "comments": [
    { "author": { "login": "alice" }, "body": "Does this retry past three attempts?" }
  ],
  "reviews": []
}
JSON
    exit 0
    ;;
esac
case "$1 $2" in
  "pr view")
    # setup runs gh in the repo, so the PR head is read from it: a fake-pr-head file
    # in the git dir for a head the clone does not have yet, a fake-pr-head tag,
    # else feature-x, else a SHA no clone has.
    head=$(cat "$(git rev-parse --git-dir)/fake-pr-head" 2>/dev/null ||
      git rev-parse --verify -q 'refs/tags/fake-pr-head^{commit}' ||
      git rev-parse --verify -q 'refs/heads/feature-x' ||
      echo deadbeefdeadbeefdeadbeefdeadbeefdeadbeef)
    cat <<JSON
{
  "number": 1234,
  "title": "Fake PR",
  "headRefName": "feature-x",
  "baseRefName": "main",
  "headRefOid": "$head",
  "baseRefOid": "cafebabecafebabecafebabecafebabecafebabe",
  "author": { "login": "octocat" },
  "body": "Fake body",
  "url": "https://github.com/octocat/Hello-World/pull/1234",
  "files": [
    {
      "path": "src/a.ts",
      "additions": 1,
      "deletions": 0,
      "changeType": "modified"
    }
  ],
  "commits": [
    {
      "oid": "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      "messageHeadline": "Add retry handling to the upload path",
      "messageBody": ""
    }
  ],
  "closingIssuesReferences": [
    {
      "number": 42,
      "title": "Uploads fail intermittently under load",
      "url": "https://github.com/octocat/Hello-World/issues/42"
    }
  ]
}
JSON
    ;;
  "api graphql")
    cat <<'JSON'
{ "data": { "repository": { "pullRequest": { "reviewThreads": {
  "pageInfo": { "hasNextPage": false, "endCursor": null },
  "nodes": [
    { "path": "src/a.ts", "line": 1, "originalLine": 1, "isResolved": false, "isOutdated": false,
      "comments": { "totalCount": 1, "nodes": [ { "author": { "login": "dave" }, "body": "Why 2?" } ] } }
  ]
} } } } }
JSON
    ;;
  "pr diff")
    cat <<'DIFF'
diff --git a/a.ts b/a.ts
index 0000000..1111111 100644
--- a/a.ts
+++ b/a.ts
@@ -1 +1,2 @@
-export const x = 1
+export const x = 2
+export const y = 3
DIFF
    ;;
  *)
    echo "fake-gh: unsupported args: $*" >&2
    exit 1
    ;;
esac
