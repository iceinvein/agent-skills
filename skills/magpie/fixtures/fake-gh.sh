#!/usr/bin/env bash
case "$1 $2" in
  "pr view")
    cat <<'JSON'
{
  "number": 1234,
  "title": "Fake PR",
  "headRefName": "feature-x",
  "baseRefName": "main",
  "headRefOid": "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
  "baseRefOid": "cafebabecafebabecafebabecafebabe",
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
  ]
}
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
