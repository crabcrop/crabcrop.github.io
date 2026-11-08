#!/usr/bin/env bash
# Download the approved Higgsfield sources listed in sources.json into .cache/sources.
# Needs network access to Higgsfield's file host (d8j0ntlcm91z4.cloudfront.net).
set -euo pipefail
cd "$(dirname "$0")/.."
out=.cache/sources; mkdir -p "$out"
base=$(jq -r .base scripts/sources.json)
jq -r '.files | to_entries[] | "\(.key) \(.value.file)"' scripts/sources.json | while read -r name file; do
  if [ -s "$out/$name" ]; then echo "have $name"; continue; fi
  echo "get  $name"
  curl -fsSL --retry 3 -o "$out/$name.part" "$base$file" && mv "$out/$name.part" "$out/$name"
done
