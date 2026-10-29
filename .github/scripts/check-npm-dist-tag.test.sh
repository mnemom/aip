#!/usr/bin/env bash
# Tests for check-npm-dist-tag.sh — the "latest only" dist-tag guard (MNE-9044, reversed).
set -uo pipefail
dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
guard="$dir/check-npm-dist-tag.sh"
fail=0

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

expect 0 latest
expect 1 next
expect 1 NEXT
expect 1 LATEST
expect 1 Latest
expect 1 " latest"
expect 1 "latest "
expect 1 Next
expect 1 beta
expect 1 ""
expect 1

[ "$fail" -eq 0 ] && echo "all guard tests passed"
exit "$fail"
