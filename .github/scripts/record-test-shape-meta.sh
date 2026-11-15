#!/usr/bin/env bash
# The labels and the waiver that record-test-shape.yml passes to the checker.
#
# Usage: record-test-shape-meta.sh <labels.json> <events.json> <output-file>
#   labels.json  `gh api repos/<repo>/issues/<n>/labels --paginate` (one or more JSON arrays)
#   events.json  `gh api repos/<repo>/issues/<n>/events --paginate` (one or more JSON arrays)
#   output-file  appended with labels=, waived_by= and waived_by_type= ($GITHUB_OUTPUT)
#
# No network and no token: the workflow reads the API, this script only decides. That keeps
# it runnable from the PR head on the bootstrap path, and testable with fixtures
# (record-test-shape-meta.test.sh).
#
# - labels: the label names joined with `,`. The checker splits --labels on commas, so a label
#   named `x,record-test-shape-waive` would read as the waive label. A name with a comma is
#   left out, with a ::warning::.
# - waived_by, waived_by_type: who applied `record-test-shape-waive`, only while that exact
#   label is on the PR and its latest labeled/unlabeled event is `labeled`, so a removed
#   waiver is never reused. Empty otherwise.
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "usage: $0 <labels.json> <events.json> <output-file>" >&2
  exit 2
fi
labels_json="$1"
events_json="$2"
out="$3"
waive=record-test-shape-waive

names="$(jq -rs 'add // [] | .[].name' "$labels_json")"
if grep -q ',' <<< "$names"; then
  echo "::warning::labels with a comma are not passed to the checker: $(grep ',' <<< "$names" | paste -sd' ' -)"
fi
labels="$({ grep -v ',' <<< "$names" || true; } | paste -sd, -)"

waived_by=""
waived_by_type=""
if grep -Fxq "$waive" <<< "$names"; then
  # Events are oldest first, across pages too, so the last match is the latest.
  last="$(jq -rs --arg l "$waive" '
    [add // [] | .[]
      | select((.event == "labeled" or .event == "unlabeled") and .label.name == $l)]
    | last // empty
    | select(.event == "labeled")
    | [.actor.login // "", .actor.type // ""] | @tsv' "$events_json")"
  if [ -n "$last" ]; then
    waived_by="$(cut -f1 <<< "$last")"
    waived_by_type="$(cut -f2 <<< "$last")"
  fi
fi

{
  echo "labels=${labels}"
  echo "waived_by=${waived_by}"
  echo "waived_by_type=${waived_by_type}"
} >> "$out"
