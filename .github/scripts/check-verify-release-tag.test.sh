#!/usr/bin/env bash
# Tests for check-verify-release-tag.sh, the verifier release-tag guard.
set -uo pipefail
dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
guard="$dir/check-verify-release-tag.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
fail=0

mkpkg() { # mkpkg <file> <name> <version>
  printf '{"name":"%s","version":"%s"}\n' "$2" "$3" > "$1"
}
mkpkg "$tmp/ok.json" "@mnemom/verify" "1.2.3"
mkpkg "$tmp/old.json" "@mnemom/aip-verifier" "1.2.3"

expect() { # expect <want-exit> <args...>
  local want="$1"; shift
  "$guard" "$@" >/dev/null 2>&1
  local got=$?
  if [ "$got" -ne "$want" ]; then
    echo "FAIL: guard $* -> exit $got, want $want"; fail=1
  else
    echo "ok: guard ${*:-<no args>} -> exit $got"
  fi
}

expect 0 verify-v1.2.3 "$tmp/ok.json"
expect 1 verify-v1.2.4 "$tmp/ok.json"      # version mismatch
expect 1 verify-1.2.3 "$tmp/ok.json"       # no v
expect 1 verify-v "$tmp/ok.json"
expect 1 aip-verifier-v1.2.3 "$tmp/ok.json" # retired tag form
expect 1 v1.2.3 "$tmp/ok.json"             # SDK tag
expect 1 verify-v1.2.3 "$tmp/old.json"     # old package name
expect 2 verify-v1.2.3 "$tmp/missing.json"
expect 2 ""
expect 2

# The real package: its own verify-v<version> tag passes.
real="$dir/../../packages/verify/package.json"
v=$(node -p 'require(process.argv[1]).version' "$(cd "$(dirname "$real")" && pwd)/package.json")
expect 0 "verify-v$v" "$real"
expect 1 "aip-verifier-v$v" "$real"

[ "$fail" -eq 0 ] && echo "all release-tag guard tests passed"
exit "$fail"
