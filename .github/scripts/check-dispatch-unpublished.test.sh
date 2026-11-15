#!/usr/bin/env bash
# Tests for check-dispatch-unpublished.sh and for the publish.yml wiring that
# keeps a dispatch with nothing new to publish from reaching the production gate.
# curl is replaced by a fake that answers from a per-case registry table, so no
# test touches npm or PyPI. The wiring checks read publish.yml with yq (on the
# ubuntu runner image).
set -uo pipefail
dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
check="$dir/check-dispatch-unpublished.sh"
workflow="$dir/../workflows/publish.yml"
fail=0
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

NPM_URL="https://registry.npmjs.org/@mnemom%2Fagent-integrity-protocol/1.3.0"
PYPI_URL="https://pypi.org/pypi/agent-integrity-proto/1.3.0/json"

# Fake curl: reads -o <file> and the URL (last argument), looks the URL up in
# $FAKE_REGISTRY ("<url> <code> <body>"), writes the body and prints the code.
# A URL not in the table is a connection failure (prints 000, exits 7).
mkdir -p "$tmp/bin"
cat >"$tmp/bin/curl" <<'FAKE'
#!/usr/bin/env bash
out="" url=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -w|--retry|--max-time) shift 2 ;;
    *) url="$1"; shift ;;
  esac
done
line=$(awk -v u="$url" '$1 == u { print; exit }' "$FAKE_REGISTRY")
if [ -z "$line" ]; then printf '000'; exit 7; fi
read -r _ code body <<<"$line"
printf '%s' "$body" >"$out"
printf '%s' "$code"
FAKE
chmod +x "$tmp/bin/curl"

printf '{"name":"@mnemom/agent-integrity-protocol","version":"1.3.0"}\n' >"$tmp/package.json"
printf '[project]\nname = "agent-integrity-proto"\nversion = "1.3.0"\n' >"$tmp/pyproject.toml"

# run_case <name> <want-exit> <want-npm> <want-pypi> <registry lines...>
run_case() {
  local name="$1" want_exit="$2" want_npm="$3" want_pypi="$4"; shift 4
  printf '%s\n' "$@" >"$tmp/registry"
  : >"$tmp/out"
  FAKE_REGISTRY="$tmp/registry" GITHUB_OUTPUT="$tmp/out" PATH="$tmp/bin:$PATH" \
    "$check" ${ARGS[@]+"${ARGS[@]}"} >"$tmp/log" 2>&1
  local got=$?
  local npm pypi
  npm=$(sed -n 's/^npm-publish=//p' "$tmp/out")
  pypi=$(sed -n 's/^pypi-publish=//p' "$tmp/out")
  if [ "$got" -ne "$want_exit" ] || [ "$npm" != "$want_npm" ] || [ "$pypi" != "$want_pypi" ]; then
    echo "FAIL: $name -> exit $got npm='$npm' pypi='$pypi', want exit $want_exit npm='$want_npm' pypi='$want_pypi'"
    sed 's/^/    /' "$tmp/log"
    fail=1
  else
    echo "ok: $name"
  fi
}

ARGS=("$tmp/package.json" "$tmp/pyproject.toml")
NPM_OK="$NPM_URL 200 {\"version\":\"1.3.0\"}"
PYPI_OK="$PYPI_URL 200 {\"info\":{\"version\":\"1.3.0\"}}"

run_case "both versions published: both gated jobs skip" 0 false false "$NPM_OK" "$PYPI_OK"
run_case "both versions unpublished (404): both gated jobs run" 0 true true \
  "$NPM_URL 404 {}" "$PYPI_URL 404 {}"
run_case "npm published, PyPI 404: only PyPI runs" 0 false true "$NPM_OK" "$PYPI_URL 404 {}"
run_case "npm 404, PyPI published: only npm runs" 0 true false "$NPM_URL 404 {}" "$PYPI_OK"
run_case "registry 500: unknown, gated jobs run" 0 true true \
  "$NPM_URL 500 {}" "$PYPI_URL 503 {}"
run_case "connection failure: unknown, gated jobs run" 0 true true
run_case "200 with another version: unknown, gated jobs run" 0 true true \
  "$NPM_URL 200 {\"version\":\"1.2.9\"}" "$PYPI_URL 200 {\"info\":{\"version\":\"1.2.9\"}}"
run_case "200 with an unreadable body: unknown, gated jobs run" 0 true true \
  "$NPM_URL 200 not-json" "$PYPI_URL 200 not-json"

if ! grep -q "::warning::could not confirm" "$tmp/log"; then
  echo "FAIL: unknown registry state did not print a ::warning::"; fail=1
else
  echo "ok: unknown registry state prints a ::warning::"
fi

ARGS=("$tmp/package.json")
run_case "missing pyproject argument: exit 1" 1 "" ""
ARGS=()
run_case "no arguments: exit 1" 1 "" ""

printf 'not json\n' >"$tmp/bad.json"
ARGS=("$tmp/bad.json" "$tmp/pyproject.toml")
run_case "unreadable package.json: exit 1" 1 "" ""
ARGS=("$tmp/package.json" "$tmp/missing.toml")
run_case "missing pyproject.toml: exit 1" 1 "" ""
printf '{"name":"@mnemom/agent-integrity-protocol"}\n' >"$tmp/noversion.json"
ARGS=("$tmp/noversion.json" "$tmp/pyproject.toml")
run_case "package.json without version: exit 1" 1 "" ""
printf '[project]\nname = "agent-integrity-proto"\n' >"$tmp/noversion.toml"
ARGS=("$tmp/package.json" "$tmp/noversion.toml")
run_case "pyproject.toml without version: exit 1" 1 "" ""

# GITHUB_OUTPUT unset: the decisions go to stdout.
printf '%s\n' "$NPM_OK" "$PYPI_OK" >"$tmp/registry"
stdout=$(env -u GITHUB_OUTPUT FAKE_REGISTRY="$tmp/registry" PATH="$tmp/bin:$PATH" \
  "$check" "$tmp/package.json" "$tmp/pyproject.toml" 2>&1)
if printf '%s\n' "$stdout" | grep -qx 'npm-publish=false' && printf '%s\n' "$stdout" | grep -qx 'pypi-publish=false'; then
  echo "ok: GITHUB_OUTPUT unset writes the decisions to stdout"
else
  echo "FAIL: GITHUB_OUTPUT unset did not write the decisions to stdout"; fail=1
fi

# publish.yml wiring: the registry check runs with no environment, and each
# gated dispatch job waits on it and runs only when its version is unpublished.
expect_wf() { # expect_wf <description> <yq expression that must print true>
  local got
  got=$(yq "$2" "$workflow" 2>&1)
  if [ "$got" = "true" ]; then echo "ok: publish.yml $1"; else echo "FAIL: publish.yml $1 (got '$got')"; fail=1; fi
}
expect_wf "has a dispatch-check job with no environment" '(.jobs | has("dispatch-check")) and (.jobs.dispatch-check | has("environment") | not)'
expect_wf "dispatch-check runs only on workflow_dispatch" '.jobs.dispatch-check.if == "github.event_name == '"'"'workflow_dispatch'"'"'"'
expect_wf "dispatch-check needs dispatch-guard" '.jobs.dispatch-check.needs | contains(["dispatch-guard"])'
expect_wf "dispatch-check runs this script" '.jobs.dispatch-check.steps[] | select(.id == "check") | .run | contains(".github/scripts/check-dispatch-unpublished.sh")'
expect_wf "dispatch-publish-npm needs dispatch-guard and dispatch-check" '.jobs.dispatch-publish-npm.needs | contains(["dispatch-guard", "dispatch-check"])'
expect_wf "dispatch-publish-npm runs only when npm-publish is true" '.jobs.dispatch-publish-npm.if | contains("needs.dispatch-check.outputs.npm-publish == '"'"'true'"'"'")'
expect_wf "dispatch-publish-pypi needs dispatch-check" '.jobs.dispatch-publish-pypi.needs | contains(["dispatch-check"])'
expect_wf "dispatch-publish-pypi runs only when pypi-publish is true" '.jobs.dispatch-publish-pypi.if | contains("needs.dispatch-check.outputs.pypi-publish == '"'"'true'"'"'")'
expect_wf "dispatch-publish-pypi keeps the production environment" '.jobs.dispatch-publish-pypi.environment == "production"'
expect_wf "dispatch-publish-pypi keeps its in-job skip-on-existing check" '[.jobs.dispatch-publish-pypi.steps[] | select(.id == "check")] | length == 1'

[ "$fail" -eq 0 ] && echo "all dispatch-check tests passed"
exit "$fail"
