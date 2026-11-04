#!/usr/bin/env bash
# Release guard for @mnemom/verify (packages/verify): a verifier release tag
# must be exactly `verify-v<version>`, where <version> is packages/verify's
# package.json version, and the package must be named @mnemom/verify.
# The retired `aip-verifier-v*` tag form (the package's old name, kept only on
# the 0.6.0 and 0.6.1 GitHub releases) is refused, so it can never publish.
#
# Usage: check-verify-release-tag.sh <tag> [<package.json>]
# Exit 0 accept, 1 refuse, 2 bad usage.
set -euo pipefail

NAME="@mnemom/verify"
PREFIX="verify-v"
tag="${1-}"
pkg="${2:-packages/verify/package.json}"

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ] || [ -z "$tag" ]; then
  echo "usage: check-verify-release-tag.sh <tag> [<package.json>]" >&2
  exit 2
fi
if [ ! -f "$pkg" ]; then
  echo "ERROR: $pkg not found" >&2
  exit 2
fi

case "$tag" in
  aip-verifier-*)
    echo "ERROR: '$tag' uses the retired aip-verifier- tag form; the package is $NAME, tag it ${PREFIX}<version>" >&2
    exit 1 ;;
  "$PREFIX"*) ;;
  *)
    echo "ERROR: '$tag' is not a verifier release tag (${PREFIX}<version>)" >&2
    exit 1 ;;
esac

name=$(node -p 'require(process.argv[1]).name' "$(cd "$(dirname "$pkg")" && pwd)/$(basename "$pkg")")
version=$(node -p 'require(process.argv[1]).version' "$(cd "$(dirname "$pkg")" && pwd)/$(basename "$pkg")")

if [ "$name" != "$NAME" ]; then
  echo "ERROR: $pkg is named '$name', expected '$NAME'" >&2
  exit 1
fi
if [ "${tag#"$PREFIX"}" != "$version" ]; then
  echo "ERROR: $pkg version ($version) != tag ($tag)" >&2
  exit 1
fi
echo "ok: $tag releases $NAME@$version"
