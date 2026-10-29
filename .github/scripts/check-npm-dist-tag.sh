#!/usr/bin/env bash
# Require npm dist-tag `latest` for @mnemom/aip-verifier release publishes.
# History: MNE-9044 originally pinned the verifier to `next`; the owner reversed
# that (customers install `latest`), so `latest` is now the only accepted tag.
# Usage: check-npm-dist-tag.sh <tag>   (exit 0 only when tag is exactly "latest")
set -euo pipefail

tag="${1-}"
if [ -z "$tag" ]; then
  echo "ERROR: no npm dist-tag supplied; @mnemom/aip-verifier must publish with --tag latest" >&2
  exit 1
fi
if [ "$tag" != "latest" ]; then
  echo "ERROR: refusing npm dist-tag '$tag'; @mnemom/aip-verifier may only publish with --tag latest" >&2
  exit 1
fi
echo "dist-tag OK: $tag"
