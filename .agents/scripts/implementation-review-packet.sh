#!/usr/bin/env bash
# Generate an implementation review handoff packet for one slice.
# Pins base/head commits and a working-tree fingerprint so the reviewer
# inspects the exact same cumulative diff.
# Adapted from CanCan's implementation-review-packet.sh.
set -euo pipefail

ROOT="${COFFEEMODE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$ROOT"

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo "Usage: .agents/scripts/implementation-review-packet.sh <slice-id> [base]"
  exit 1
fi

slice_id="$1"
base="${2:-HEAD}"
base_sha="$(git rev-parse --verify "${base}^{commit}")"
head_sha="$(git rev-parse --verify "HEAD^{commit}")"

.agents/scripts/context-for-slice.sh "$slice_id" >/dev/null

worktree_fingerprint="$({
  git diff --binary "$head_sha" -- .
  while IFS= read -r -d '' path; do
    printf '\0untracked\0%s\0' "$path"
    git hash-object -- "$path"
  done < <(git ls-files --others --exclude-standard -z)
} | git hash-object --stdin)"

echo "# CoffeeMode Implementation Review Handoff"
echo
echo "- Slice ID: $slice_id"
echo "- Base commit: $base_sha"
echo "- Head commit: $head_sha"
echo "- Working tree fingerprint: $worktree_fingerprint"
echo "- Canonical source index: run .agents/scripts/context-for-slice.sh $slice_id from this head"

echo
echo "# Required External Handoff"
echo
echo "Provide these author/tester inputs alongside this generated packet:"
echo
echo "- Exact user request"
echo "- Author assumptions and scope boundary"
echo "- Verifiable success criteria"
echo "- Selected execution tier and justification"
echo "- Canonical sources inspected at the exact head commit, listing every indexed path"
echo "- Exact verification commands and results"
echo "- UI evidence when the change is user-visible"
echo "- Previous findings and resolutions when this is a re-review"

echo
echo "# Implementation Diff"
echo
echo "## Working tree"
git status --short

echo
echo "## Changed files against $base_sha"
git diff --name-status "$base_sha" -- .
git ls-files --others --exclude-standard | sed 's/^/A\t/'

echo
echo "## Diff stat"
git diff --stat "$base_sha" -- .

echo
echo "## Rename and deletion summary"
git diff --summary --find-renames "$base_sha" -- .

echo
echo "## Repository inspection"
echo "Before inspection, verify this shared checkout still matches the packet; regenerate the packet if either value differs."
echo "- HEAD check: test \"\$(git rev-parse --verify HEAD^{commit})\" = \"$head_sha\""
echo "- Packet refresh: .agents/scripts/implementation-review-packet.sh $slice_id $base_sha"
echo "- Require the refreshed Head commit and Working tree fingerprint to match this packet."
echo "Inspect the complete cumulative diff directly from the verified shared working tree."
echo "- Committed changes: git diff --no-ext-diff $base_sha $head_sha -- ."
echo "- Working-tree changes after head: git diff --no-ext-diff $head_sha -- ."
echo "- Untracked files: open every path marked A above directly"
echo "- Re-run repository searches required by .agents/workflows/review-code.md"
