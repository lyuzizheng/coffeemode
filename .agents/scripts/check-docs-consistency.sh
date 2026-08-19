#!/usr/bin/env bash
# Doc alignment / consistency checks for CoffeeMode.
# Adapted from CanCan's check-docs-consistency.sh — no private fixtures,
# no financial-data layers, but keeps the authority-separation discipline.
set -euo pipefail

ROOT="${COFFEEMODE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$ROOT"

fail=0

echo "Checking harness does not own current priorities..."
if grep -rn '^## Current Priorit' .agents --include='*.md' 2>/dev/null; then
  echo "Current priorities belong only in docs/agent/current-state.md."
  fail=1
fi

echo "Checking legacy procedure locations are not referenced..."
legacy_refs='docs/agent/(reading-order|iteration-protocol|coding-conventions|issue-guidelines|progress-log(-archive)?)\.md|[.]cursor/|[.]cursorrules|[.]vscode/|[.]trae/'
if grep -rnE "$legacy_refs" AGENTS.md docs .agents .codex .github .windsurf web/AGENTS.md web/CLAUDE.md --include='*.md' --include='*.toml' 2>/dev/null; then
  echo "Legacy agent procedure location is still referenced."
  fail=1
fi

echo "Checking removed editor-specific folders stay removed..."
for removed in .cursor .cursorrules .vscode .trae; do
  if [[ -e "$removed" ]]; then
    echo "Removed editor-specific path exists: $removed"
    fail=1
  fi
done

echo "Checking backticked repo file references..."
while IFS= read -r entry; do
  reference="${entry##*:}"
  reference="${reference#\`}"
  reference="${reference%\`}"
  case "$reference" in
    *'*'*) continue ;;
  esac
  if [ ! -e "$reference" ]; then
    echo "Missing repo file reference: $entry"
    fail=1
  fi
done < <(grep -rn -oE '`(docs|[.]agents)/[^`]+\.(md|sh)`' AGENTS.md docs .agents --include='*.md' 2>/dev/null || true)

echo "Checking ADR statuses..."
if ls docs/adr/*.md &>/dev/null; then
  for adr in docs/adr/*.md; do
    [ "$(basename "$adr")" = "README.md" ] && continue
    status="$(awk '/^## Status$/{getline; while ($0 == "") getline; print; exit}' "$adr")"
    case "$status" in
      Proposed|Accepted|Superseded|Deprecated|Rejected) ;;
      *)
        echo "Invalid or missing ADR status in $adr: ${status:-<empty>}"
        fail=1
        ;;
    esac
  done
else
  echo "  (no ADRs yet — skipped)"
fi

echo "Checking whitespace errors in docs/harness files..."
if grep -rn '[[:blank:]]$' AGENTS.md docs .agents .github/workflows --include='*.md' --include='*.sh' --include='*.yml' --include='*.yaml' 2>/dev/null; then
  echo "Trailing whitespace found."
  fail=1
fi

echo "Checking spec files have canonical headings..."
for spec in docs/specs/[0-9]*.md; do
  [ -f "$spec" ] || continue
  NAME=$(basename "$spec")
  # Goal and Stable decisions are always required independently
  for heading in "## Goal" "## Stable decisions"; do
    if ! grep -q "$heading" "$spec"; then
      echo "$NAME missing heading: $heading"
      fail=1
    fi
  done
  # Acceptance criteria: either spelling is acceptable
  if ! grep -q "## Acceptance criteria" "$spec" && ! grep -q "## Tests / acceptance criteria" "$spec"; then
    echo "$NAME missing heading: ## Acceptance criteria (or ## Tests / acceptance criteria)"
    fail=1
  fi
done

echo "Checking every spec is indexed in README..."
for spec in docs/specs/[0-9]*.md; do
  [ -f "$spec" ] || continue
  NAME=$(basename "$spec")
  if ! grep -q "$NAME" docs/specs/README.md; then
    echo "$NAME not in docs/specs/README.md index"
    fail=1
  fi
done

echo "Checking docs/agent/current-state.md exists and has Phase..."
if [ -f docs/agent/current-state.md ]; then
  if ! grep -q '^## Phase' docs/agent/current-state.md; then
    echo "current-state.md missing ## Phase heading"
    fail=1
  fi
else
  echo "docs/agent/current-state.md missing"
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  echo "Doc consistency check FAILED."
  exit 1
fi

echo "Doc consistency check passed."
