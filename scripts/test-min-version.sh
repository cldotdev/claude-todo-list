#!/usr/bin/env bash
# Validates and tests the mod on the oldest Claude Code version CI pins, so an
# API newer than the supported minimum fails here instead of only in CI.
set -euo pipefail

cd "$(dirname "$0")/.."

workflow=.github/workflows/ci.yml
version=$(sed -n 's/^ *claude: \["\([0-9][0-9.]*\)", latest\]$/\1/p' "$workflow")
if [ -z "$version" ]; then
  echo "error: no pinned Claude Code version found in the matrix of $workflow" >&2
  exit 1
fi

claude=(npx -y "@anthropic-ai/claude-code@$version")
echo "Claude Code $version"
"${claude[@]}" plugin validate --strict .
"${claude[@]}" plugin test .
