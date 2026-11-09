#!/usr/bin/env bash
# Download the approved sources listed in sources.json into .cache/sources:
# Higgsfield outputs from its file host (d8j0ntlcm91z4.cloudfront.net), and
# Tripo models through the tripo CLI (needs its API key and access to
# openapi.tripo3d.ai and openapi-dl.data.tripo3d.com).
set -euo pipefail
cd "$(dirname "$0")/.."
out=.cache/sources; mkdir -p "$out"
base=$(jq -r .base scripts/sources.json)
jq -r '.files | to_entries[] | "\(.key) \(.value.file) \(.value.tripo_task // "")"' scripts/sources.json | while read -r name file task; do
  if [ -s "$out/$name" ]; then echo "have $name"; continue; fi
  echo "get  $name"
  if [ -n "$task" ]; then
    tripo task get "$task" --download -o ".cache/tripo/$task" --json > /dev/null
    cp ".cache/tripo/$task/$file" "$out/$name"
  else
    curl -fsSL --retry 3 -o "$out/$name.part" "$base$file" && mv "$out/$name.part" "$out/$name"
  fi
done
