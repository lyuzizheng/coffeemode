#!/usr/bin/env bash
# Check that local markdown links in docs/harness files resolve.
# Adapted from CanCan's check-links.sh.
set -euo pipefail

ROOT="${COFFEEMODE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$ROOT"

fail=0

while IFS= read -r entry; do
  file="${entry%%:*}"
  rest="${entry#*:}"
  line="${rest%%:*}"
  token="${rest#*:}"
  target="${token#*](}"
  target="${target%)}"
  target="${target#<}"
  target="${target%>}"

  case "$target" in
    http://*|https://*|mailto:*|'#'*) continue ;;
  esac

  path="${target%%#*}"
  [ -n "$path" ] || continue

  if [[ "$path" = /* ]]; then
    candidate="$path"
  else
    candidate="$(dirname "$file")/$path"
  fi

  if [ ! -e "$candidate" ]; then
    echo "Broken local link: $file:$line -> $target"
    fail=1
  fi
done < <((rg --glob '*.md' -n -o '\]\(<[^>]+>\)|\]\([^)]+\)' AGENTS.md docs .agents || true))

if [ "$fail" -ne 0 ]; then
  echo "Markdown link check failed."
  exit 1
fi

echo "Markdown link check passed."
