#!/usr/bin/env bash
# Decide, before the production environment gate, whether a workflow_dispatch
# publish (publish.yml dispatch-check) has anything to publish.
#
# mnemom/deploy dispatches publish.yml on every main push. The npm and PyPI
# skip-on-existing checks run inside the gated jobs, so a push that changes no
# version still waited at the production gate for a human to reject it. This
# script asks npm and PyPI for the exact versions first, and publish.yml skips
# each gated job whose version is already published.
#
# Usage: check-dispatch-unpublished.sh <package.json> <pyproject.toml>
# Writes npm-publish=true|false and pypi-publish=true|false to $GITHUB_OUTPUT
# (stdout when unset).
#   200 with the same version -> false (already published, the gated job skips)
#   404                       -> true  (unpublished, the gated job runs)
#   anything else             -> true  (unknown: the gated job runs and its own
#                                       skip-on-existing check decides, as before)
# Exit 1 when an argument is missing or a manifest has no name or version.
set -euo pipefail

pkg_json="${1-}"
pyproject="${2-}"
if [ -z "$pkg_json" ] || [ -z "$pyproject" ]; then
  echo "ERROR: usage: check-dispatch-unpublished.sh <package.json> <pyproject.toml>" >&2
  exit 1
fi

npm_meta=$(python3 -c '
import json, sys
d = json.load(open(sys.argv[1]))
print(d.get("name", ""), d.get("version", ""))
' "$pkg_json") || { echo "ERROR: cannot read $pkg_json" >&2; exit 1; }
pypi_meta=$(python3 -c '
import sys, tomllib
p = tomllib.load(open(sys.argv[1], "rb")).get("project", {})
print(p.get("name", ""), p.get("version", ""))
' "$pyproject") || { echo "ERROR: cannot read $pyproject" >&2; exit 1; }

read -r npm_name npm_version _ <<<"$npm_meta"
read -r pypi_name pypi_version _ <<<"$pypi_meta"
if [ -z "${npm_name-}" ] || [ -z "${npm_version-}" ]; then
  echo "ERROR: $pkg_json has no name or version" >&2
  exit 1
fi
if [ -z "${pypi_name-}" ] || [ -z "${pypi_version-}" ]; then
  echo "ERROR: $pyproject has no [project] name or version" >&2
  exit 1
fi

# registry_state <url> <version> <npm|pypi> -> published | unpublished | unknown
registry_state() {
  local url="$1" want="$2" kind="$3" body code got
  body=$(mktemp)
  code=$(curl -sS --retry 3 --max-time 30 -o "$body" -w '%{http_code}' "$url") || code="000"
  case "$code" in
    200)
      got=$(python3 -c '
import json, sys
d = json.load(open(sys.argv[1]))
print(d["version"] if sys.argv[2] == "npm" else d["info"]["version"])
' "$body" "$kind" 2>/dev/null) || got=""
      if [ "$got" = "$want" ]; then echo published; else echo unknown; fi
      ;;
    404) echo unpublished ;;
    *) echo unknown ;;
  esac
  rm -f "$body"
}

out="${GITHUB_OUTPUT:-/dev/stdout}"

# decide <output-key> <label> <state>
decide() {
  local key="$1" label="$2" state="$3"
  case "$state" in
    published)
      echo "$label already published, the gated publish job will skip"
      echo "$key=false" >>"$out"
      ;;
    unpublished)
      echo "$label not on the registry, the gated publish job will run"
      echo "$key=true" >>"$out"
      ;;
    *)
      echo "::warning::could not confirm whether $label is published, the gated publish job will run and its own skip-on-existing check decides"
      echo "$key=true" >>"$out"
      ;;
  esac
}

decide npm-publish "npm ${npm_name}@${npm_version}" \
  "$(registry_state "https://registry.npmjs.org/${npm_name/\//%2F}/${npm_version}" "$npm_version" npm)"
decide pypi-publish "PyPI ${pypi_name}==${pypi_version}" \
  "$(registry_state "https://pypi.org/pypi/${pypi_name}/${pypi_version}/json" "$pypi_version" pypi)"
