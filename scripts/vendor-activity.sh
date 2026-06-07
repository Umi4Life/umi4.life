#!/usr/bin/env bash
# Fetch the latest vendored activity JSON from git-activity for local Hugo dev.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="$ROOT/static/data/activity.json"
URL="https://raw.githubusercontent.com/Umi4Life/git-activity/master/data/activity.json"

mkdir -p "$(dirname "$TARGET")"
curl -fsSL "$URL" -o "$TARGET"
echo "Vendored activity data to $TARGET"
