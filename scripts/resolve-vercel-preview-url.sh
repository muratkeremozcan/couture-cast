#!/usr/bin/env bash
set -euo pipefail

preview_url=""
if ! preview_url=$(node ./scripts/resolve-vercel-preview-url.mjs | tail -n 1); then
  exit 1
fi

if [ -z "$preview_url" ]; then
  echo "Failed to resolve Vercel Preview URL" >&2
  exit 1
fi

echo "$preview_url"
