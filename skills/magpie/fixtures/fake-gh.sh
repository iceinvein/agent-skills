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
    cat <<'JSON'
{
  "number": 1234,
  "title": "Fake PR",
  "headRefName": "feature-x",
  "baseRefName": "main",
  "headRefOid": "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
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
