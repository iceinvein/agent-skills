#!/usr/bin/env bash
# The activity fetch asks pr view for different fields than setup's first call.
case "$*" in
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
    { "path": "src/a.ts",  "additions": 1, "deletions": 0, "changeType": "modified" },
    { "path": "bun.lock",  "additions": 1, "deletions": 0, "changeType": "modified" },
    { "path": "dist/x.js", "additions": 1, "deletions": 0, "changeType": "modified" }
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
diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1 @@
-export const x = 1
+export const x = 2
diff --git a/bun.lock b/bun.lock
index 3333333..4444444 100644
--- a/bun.lock
+++ b/bun.lock
@@ -1 +1 @@
-{}
+{"a":1}
diff --git a/dist/x.js b/dist/x.js
index 5555555..6666666 100644
--- a/dist/x.js
+++ b/dist/x.js
@@ -1 +1 @@
-1
+2
DIFF
    ;;
  *)
    echo "fake-gh: unsupported args: $*" >&2
    exit 1
    ;;
esac
