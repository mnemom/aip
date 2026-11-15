#!/usr/bin/env bash
# Tests for record-test-shape-meta.sh, the labels and waiver passed to the record-test-shape
# checker. Each case feeds labels/events API JSON to the script, checks its outputs, then runs
# the vendored checker with them on a Record-lane diff that reads a flag with no test, so a
# waiver that is honored exits 0 and one that is not exits 1.
set -uo pipefail
dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
meta="$dir/record-test-shape-meta.sh"
check="$dir/../record-test-shape/check.cjs"
flags="$dir/../record-test-shape/flags.json"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
fail=0

# A Record-lane diff (record-lane label) that reads a flag from flags.json with no parser test.
cat > "$tmp/pr.diff" <<'EOF'
diff --git a/packages/x/src/mode.ts b/packages/x/src/mode.ts
--- /dev/null
+++ b/packages/x/src/mode.ts
@@ -0,0 +1 @@
+export const mode = process.env.RECORD_INPUTS_MODE ?? "off";
EOF

labels() { # labels <name>... -> one labels page
  jq -cn '$ARGS.positional | map({name: .})' --args "$@"
}
ev() { # ev <labeled|unlabeled> <label> <login> <type> -> one event
  jq -cn --arg e "$1" --arg l "$2" --arg a "$3" --arg t "$4" \
    '{event: $e, label: {name: $l}, actor: {login: $a, type: $t}}'
}
page() { # page <event>... -> one events page
  jq -cs . <<< "$*"
}

W=record-test-shape-waive

# run <name> <want labels> <want waived_by> <want waived_by_type> <want checker exit> [<want warning>]
# Reads $tmp/labels.json and $tmp/events.json.
run() {
  local name="$1" want_labels="$2" want_by="$3" want_type="$4" want_exit="$5" want_warn="${6:-}"
  local out="$tmp/out" log="$tmp/log"
  : > "$out"
  if ! "$meta" "$tmp/labels.json" "$tmp/events.json" "$out" > "$log" 2>&1; then
    echo "FAIL: $name: script exited non-zero: $(cat "$log")"; fail=1; return
  fi
  local got_labels got_by got_type
  got_labels="$(sed -n 's/^labels=//p' "$out")"
  got_by="$(sed -n 's/^waived_by=//p' "$out")"
  got_type="$(sed -n 's/^waived_by_type=//p' "$out")"
  if [ "$got_labels|$got_by|$got_type" != "$want_labels|$want_by|$want_type" ]; then
    echo "FAIL: $name: outputs '$got_labels|$got_by|$got_type', want '$want_labels|$want_by|$want_type'"
    fail=1; return
  fi
  if [ -n "$want_warn" ] && ! grep -Fq "::warning::labels with a comma are not passed to the checker: $want_warn" "$log"; then
    echo "FAIL: $name: no comma warning naming '$want_warn': $(cat "$log")"; fail=1; return
  fi
  if [ -z "$want_warn" ] && grep -q '::warning::' "$log"; then
    echo "FAIL: $name: unexpected warning: $(cat "$log")"; fail=1; return
  fi
  node "$check" --diff="$tmp/pr.diff" --flags="$flags" --head-ref=feat/x \
    --labels="$got_labels" --pr-author=alice \
    --waived-by="$got_by" --waived-by-type="$got_type" \
    --out="$tmp/report.json" --summary=/dev/null > /dev/null 2>&1
  local got_exit=$?
  if [ "$got_exit" -ne "$want_exit" ]; then
    echo "FAIL: $name: checker exit $got_exit, want $want_exit"; fail=1; return
  fi
  echo "ok: $name"
}

# Honest waiver: bob (not the author alice) applied it and it is still on.
labels record-lane "$W" > "$tmp/labels.json"
page "$(ev labeled record-lane alice User)" "$(ev labeled "$W" bob User)" > "$tmp/events.json"
run "honest waiver by another user is honored" "record-lane,$W" bob User 0

# Forged: bob waived then removed it; the author adds `x,record-test-shape-waive`.
labels record-lane "x,$W" > "$tmp/labels.json"
page "$(ev labeled "$W" bob User)" "$(ev unlabeled "$W" bob User)" \
  "$(ev labeled "x,$W" alice User)" > "$tmp/events.json"
run "removed waiver is not reused through a comma label" record-lane "" "" 1 "x,$W"

# Reapplied by someone else after the removal: the latest applier counts.
labels record-lane "$W" > "$tmp/labels.json"
page "$(ev labeled "$W" bob User)" "$(ev unlabeled "$W" bob User)" \
  "$(ev labeled "$W" dave User)" > "$tmp/events.json"
run "waiver reapplied by another user names that user" "record-lane,$W" dave User 0

# Removed and not reapplied.
labels record-lane > "$tmp/labels.json"
page "$(ev labeled "$W" bob User)" "$(ev unlabeled "$W" bob User)" > "$tmp/events.json"
run "removed waiver is not honored" record-lane "" "" 1

# Label list read just before the removal event: latest event wins.
labels record-lane "$W" > "$tmp/labels.json"
page "$(ev labeled "$W" bob User)" "$(ev unlabeled "$W" bob User)" > "$tmp/events.json"
run "label listed but latest event is unlabeled" "record-lane,$W" "" "" 1

# Events across two pages (gh --paginate prints one array per page), oldest first.
labels record-lane "$W" > "$tmp/labels.json"
{ page "$(ev labeled "$W" bob User)" "$(ev unlabeled "$W" bob User)"
  page "$(ev labeled "$W" dave User)"; } > "$tmp/events.json"
run "latest event is read across pages" "record-lane,$W" dave User 0

# An event for a different label with the waive name inside it does not count.
labels record-lane "$W" > "$tmp/labels.json"
page "$(ev labeled "$W" bob User)" "$(ev unlabeled "$W" bob User)" \
  "$(ev labeled "x,$W" dave User)" > "$tmp/events.json"
run "only events for the exact waive label count" "record-lane,$W" "" "" 1

# The account type is passed through: a bot waiver is refused by the checker.
labels record-lane "$W" > "$tmp/labels.json"
page "$(ev labeled "$W" "ci[bot]" Bot)" > "$tmp/events.json"
run "bot waiver passes its type and is refused" "record-lane,$W" "ci[bot]" Bot 1

# The author cannot waive their own PR.
labels record-lane "$W" > "$tmp/labels.json"
page "$(ev labeled "$W" alice User)" > "$tmp/events.json"
run "self-applied waiver is refused" "record-lane,$W" alice User 1

# A comma label is dropped from scope too, with the warning.
labels "foo,record-lane" > "$tmp/labels.json"
page > "$tmp/events.json"
run "comma label does not put a PR in scope" "" "" "" 0 "foo,record-lane"

# No labels and no events.
echo '[]' > "$tmp/labels.json"
echo '[]' > "$tmp/events.json"
run "no labels" "" "" "" 0

# Wrong argument count is a usage error.
"$meta" "$tmp/labels.json" "$tmp/events.json" > /dev/null 2>&1
got=$?
if [ "$got" -ne 2 ]; then echo "FAIL: two arguments -> exit $got, want 2"; fail=1; else echo "ok: usage error exits 2"; fi

[ "$fail" -eq 0 ] && echo "all record-test-shape-meta tests passed"
exit "$fail"
