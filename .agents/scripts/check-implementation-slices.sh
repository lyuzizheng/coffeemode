#!/usr/bin/env bash
# Validate the implementation-slices manifest for CoffeeMode.
# Checks: statuses valid, referenced specs exist, dependencies resolve,
# ready/in-progress slices have test gates.
set -euo pipefail

ROOT="${COFFEEMODE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$ROOT"

MANIFEST="docs/agent/implementation-slices.md"
fail=0

if [ ! -f "$MANIFEST" ]; then
  echo "FAIL: $MANIFEST missing"
  exit 1
fi

# Parse table rows (skip header and separator)
# Use -E consistently: in ERE \| is literal pipe, | is alternation
ROWS=$(grep -E '^\|' "$MANIFEST" | grep -vE '^\| ID' | grep -vE '^\|[[:space:]]*---' || true)

echo "Checking slice statuses are valid..."
VALID_STATUSES="PENDING|IN-PROGRESS|COMPLETE|COMPLETED|BLOCKED|READY"
while IFS= read -r line; do
  [ -z "$line" ] && continue
  status=$(echo "$line" | awk -F'|' '{gsub(/^[ \t]+|[ \t]+$/, "", $4); print $4}')
  [ -z "$status" ] && continue
  if ! echo "$status" | grep -qE "^($VALID_STATUSES)$"; then
    echo "  Invalid slice status: '$status'"
    fail=1
  fi
done <<< "$ROWS"

echo "Checking referenced specs exist..."
while IFS= read -r line; do
  [ -z "$line" ] && continue
  specs_field=$(echo "$line" | awk -F'|' '{gsub(/^[ \t]+|[ \t]+$/, "", $5); print $5}')
  # Specs can be "0001" or "0001, 0002" — match against actual files
  for num in $(echo "$specs_field" | grep -oE '[0-9]{4}' || true); do
    if ! ls docs/specs/${num}-*.md &>/dev/null; then
      slice_id=$(echo "$line" | awk -F'|' '{gsub(/^[ \t]+|[ \t]+$/, "", $2); print $2}')
      echo "  Slice $slice_id references spec $num but no docs/specs/${num}-*.md exists"
      fail=1
    fi
  done
done <<< "$ROWS"

echo "Checking dependency references resolve..."
ALL_IDS=$(echo "$ROWS" | awk -F'|' '{gsub(/^[ \t]+|[ \t]+$/, "", $2); gsub(/`/, "", $2); print $2}')
while IFS= read -r line; do
  [ -z "$line" ] && continue
  deps=$(echo "$line" | awk -F'|' '{gsub(/^[ \t]+|[ \t]+$/, "", $6); print $6}')
  [ -z "$deps" ] && continue
  echo "$deps" | grep -qE '^(—|-|none)$' && continue
  for dep in $(echo "$deps" | tr ',' ' '); do
    dep=$(echo "$dep" | xargs | tr -d '`')
    [ -z "$dep" ] && continue
    [ "$dep" = "—" ] && continue
    if ! echo "$ALL_IDS" | grep -q "^${dep}$"; then
      slice_id=$(echo "$line" | awk -F'|' '{gsub(/^[ \t]+|[ \t]+$/, "", $2); gsub(/`/, "", $2); print $2}')
      echo "  Slice '$slice_id' depends on unknown slice: '$dep'"
      fail=1
    fi
  done
done <<< "$ROWS"

echo "Checking READY/IN-PROGRESS slices have test gates..."
while IFS= read -r line; do
  [ -z "$line" ] && continue
  status=$(echo "$line" | awk -F'|' '{gsub(/^[ \t]+|[ \t]+$/, "", $4); print $4}')
  if [ "$status" = "READY" ] || [ "$status" = "IN-PROGRESS" ]; then
    gates=$(echo "$line" | awk -F'|' '{gsub(/^[ \t]+|[ \t]+$/, "", $7); print $7}')
    if [ -z "$gates" ] || echo "$gates" | grep -qE '^(none|-|—)$'; then
      slice_id=$(echo "$line" | awk -F'|' '{gsub(/^[ \t]+|[ \t]+$/, "", $2); gsub(/`/, "", $2); print $2}')
      echo "  Slice '$slice_id' is $status but has no test gates"
      fail=1
    fi
  fi
done <<< "$ROWS"

echo "Checking READY slices have all dependencies COMPLETE..."
while IFS= read -r line; do
  [ -z "$line" ] && continue
  status=$(echo "$line" | awk -F'|' '{gsub(/^[ \t]+|[ \t]+$/, "", $4); print $4}')
  if [ "$status" = "READY" ] || [ "$status" = "IN-PROGRESS" ]; then
    deps=$(echo "$line" | awk -F'|' '{gsub(/^[ \t]+|[ \t]+$/, "", $6); print $6}')
    [ -z "$deps" ] && continue
    echo "$deps" | grep -qE '^(—|-|none)$' && continue
    for dep in $(echo "$deps" | tr ',' ' '); do
      dep=$(echo "$dep" | xargs | tr -d '`')
      [ -z "$dep" ] && continue
      [ "$dep" = "—" ] && continue
      dep_status=$(echo "$ROWS" | grep "$dep" | awk -F'|' '{gsub(/^[ \t]+|[ \t]+$/, "", $4); print $4}' | head -1)
      if [ "$dep_status" != "COMPLETE" ] && [ "$dep_status" != "COMPLETED" ]; then
        slice_id=$(echo "$line" | awk -F'|' '{gsub(/^[ \t]+|[ \t]+$/, "", $2); gsub(/`/, "", $2); print $2}')
        echo "  Slice '$slice_id' is $status but dependency '$dep' is '$dep_status' (must be COMPLETE)"
        fail=1
      fi
    done
  fi
done <<< "$ROWS"

echo "Checking COMPLETE slices have no active blockers..."
while IFS= read -r line; do
  [ -z "$line" ] && continue
  status=$(echo "$line" | awk -F'|' '{gsub(/^[ \t]+|[ \t]+$/, "", $4); print $4}')
  if [ "$status" = "COMPLETE" ] || [ "$status" = "COMPLETED" ]; then
    deps=$(echo "$line" | awk -F'|' '{gsub(/^[ \t]+|[ \t]+$/, "", $6); print $6}')
    # Check all deps are also complete
    for dep in $(echo "$deps" | tr ',' ' '); do
      dep=$(echo "$dep" | xargs | tr -d '`')
      [ -z "$dep" ] && continue
      [ "$dep" = "—" ] && continue
      dep_status=$(echo "$ROWS" | grep "$dep" | awk -F'|' '{gsub(/^[ \t]+|[ \t]+$/, "", $4); print $4}' | head -1)
      if [ "$dep_status" != "COMPLETE" ] && [ "$dep_status" != "COMPLETED" ]; then
        slice_id=$(echo "$line" | awk -F'|' '{gsub(/^[ \t]+|[ \t]+$/, "", $2); gsub(/`/, "", $2); print $2}')
        echo "  Slice '$slice_id' is COMPLETE but dependency '$dep' is '$dep_status'"
        fail=1
      fi
    done
  fi
done <<< "$ROWS"

if [ "$fail" -ne 0 ]; then
  echo "Implementation slices check FAILED."
  exit 1
fi

echo "Implementation slices check passed."
