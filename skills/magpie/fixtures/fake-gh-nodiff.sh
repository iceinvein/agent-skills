#!/usr/bin/env bash
# Fake gh whose `pr diff` refuses to serve, the way GitHub does above ~300
# files. MAGPIE_FAKE_HEAD_OID lets a test point pr.json at a real local commit.
# MAGPIE_FAKE_DIFF_MODE=fail (default) exits non-zero; =empty exits 0 with no
# output, which is the truncation case fetchPr also has to catch.
case "$1 $2" in
  "pr view")
    cat <<JSON
{
  "number": 7,
  "title": "Fake big PR",
  "headRefName": "feature-x",
  "baseRefName": "main",
  "headRefOid": "${MAGPIE_FAKE_HEAD_OID:-deadbeefdeadbeefdeadbeefdeadbeefdeadbeef}",
  "baseRefOid": "cafebabecafebabecafebabecafebabecafebabe",
  "author": { "login": "octocat" },
  "body": "Fake body",
  "url": "https://github.com/octocat/Hello-World/pull/7",
  "files": [
    { "path": "a.ts", "additions": 1, "deletions": 1, "changeType": "modified" }
  ],
  "commits": [],
  "closingIssuesReferences": []
}
JSON
    ;;
  "pr diff")
    if [ "${MAGPIE_FAKE_DIFF_MODE:-fail}" = "empty" ]; then
      exit 0
    fi
    echo "the diff exceeded the maximum number of files (300) (HTTP 406)" >&2
    exit 1
    ;;
  *)
    echo "fake-gh-nodiff: unsupported args: $*" >&2
    exit 1
    ;;
esac
