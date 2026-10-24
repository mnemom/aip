#!/usr/bin/env bash
# Refuse any npm dist-tag other than `next` for @mnemom/aip-verifier (MNE-9044).
# The verifier is pre-GA: it must never take `latest` until a human promotes it.
# Usage: check-npm-dist-tag.sh <tag>   (exit 0 only when tag is exactly "next")
set -euo pipefail

tag="${1-}"
if [ -z "$tag" ]; then
  echo "ERROR: no npm dist-tag supplied; @mnemom/aip-verifier must publish with --tag next" >&2
  exit 1
fi
if [ "$tag" != "next" ]; then
  echo "ERROR: refusing npm dist-tag '$tag'; @mnemom/aip-verifier may only publish with --tag next (never latest)" >&2
  exit 1
fi
echo "dist-tag OK: $tag"
