#!/usr/bin/env bash
# Check that local markdown links in docs/harness files resolve.
# Adapted from CanCan's check-links.sh.
set -euo pipefail

ROOT="${COFFEEMODE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$ROOT"

fail=0

# Fail-closed: grep exits 0 on match, 1 on no match, >1 on error.
set +e
links_output="$(grep -rn -oE '\]\([^)]+\)' --include='*.md' AGENTS.md docs .agents)"
grep_status=$?
set -e
if [ "$grep_status" -gt 1 ]; then
  echo "Markdown link check failed: link extraction error (grep exit $grep_status)"
  exit 1
fi

while IFS= read -r entry; do
  [ -n "$entry" ] || continue
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
done <<< "$links_output"

if [ "$fail" -ne 0 ]; then
  echo "Markdown link check failed."
  exit 1
fi

echo "Markdown link check passed."
