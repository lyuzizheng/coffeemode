#!/usr/bin/env bash
# Generate a docs review packet for independent semantic review.
# Usage: docs-review-packet.sh <base-ref>
# Outputs a self-contained text packet to stdout.
set -euo pipefail

ROOT="${COFFEEMODE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$ROOT"

BASE="${1:-HEAD~1}"
SCOPE=(docs/ .agents/ .codex/ .github/ .windsurf/ AGENTS.md README.md web/AGENTS.md web/CLAUDE.md .cursor/ .cursorrules .vscode/ .trae/)

echo "# CoffeeMode Docs Review Packet"
echo ""
echo "- Generated: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "- Base ref: $BASE"
echo "- Head commit: $(git rev-parse HEAD 2>/dev/null || echo 'no-git')"
echo ""

echo "# Changed files (docs/agents/harness)"
echo ""
git diff --name-only "$BASE" -- "${SCOPE[@]}" 2>/dev/null || echo "(git diff unavailable)"
echo ""

echo "# Untracked docs/agents files"
echo ""
git ls-files --others --exclude-standard -- "${SCOPE[@]}" 2>/dev/null || echo "(git unavailable)"
echo ""

echo "# Diff stat"
echo ""
git diff --stat "$BASE" -- "${SCOPE[@]}" 2>/dev/null || echo "(unavailable)"
echo ""

echo "# Full diff"
echo ""
git diff --no-ext-diff "$BASE" -- "${SCOPE[@]}" 2>/dev/null || echo "(unavailable)"
echo ""

echo "# Untracked file contents"
echo ""
while IFS= read -r path; do
  [[ -n "$path" ]] || continue
  echo "## $path"
  sed 's/^/    /' "$path"
  echo ""
done < <(git ls-files --others --exclude-standard -- "${SCOPE[@]}" 2>/dev/null || true)

echo "# Canonical context"
echo ""
echo "## docs/STRUCTURE.md"
echo '```'
cat docs/STRUCTURE.md 2>/dev/null || echo "(missing)"
echo '```'
echo ""
echo "## docs/agent/current-state.md"
echo '```'
cat docs/agent/current-state.md 2>/dev/null || echo "(missing)"
echo '```'
echo ""
echo "## docs/specs/README.md (index)"
echo '```'
cat docs/specs/README.md 2>/dev/null || echo "(missing)"
echo '```'
echo ""

echo "# Preflight result"
echo ""
if .agents/scripts/preflight.sh 2>&1; then
  echo "preflight: PASSED"
else
  echo "preflight: FAILED"
fi
echo ""

echo "# End of packet"
