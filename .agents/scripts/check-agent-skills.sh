#!/usr/bin/env bash
# Validate repo-local agent skills: frontmatter shape, name uniqueness,
# directory/name match, and a trigger phrase in the description.
# Adapted from CanCan's check-agent-skills.sh.
set -euo pipefail

ROOT="${COFFEEMODE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$ROOT"

fail=0
seen_names=""

for skill in .agents/skills/*/SKILL.md; do
  [ -f "$skill" ] || continue
  name_line="$(sed -n '2p' "$skill")"
  description="$(sed -n '3p' "$skill")"
  close="$(sed -n '4p' "$skill")"
  name="${name_line#name: }"
  directory_name="$(basename "$(dirname "$skill")")"

  if [ "$(sed -n '1p' "$skill")" != "---" ] || [ "$close" != "---" ]; then
    echo "Invalid frontmatter fence: $skill"
    fail=1
  fi

  if ! printf '%s\n' "$name_line" | grep -Eq '^name: [a-z0-9-]+$'; then
    echo "Invalid skill name line: $skill"
    fail=1
  fi

  if [ "$name" != "$directory_name" ]; then
    echo "Skill name must match directory: $skill ($name != $directory_name)"
    fail=1
  fi

  if printf '%s\n' "$seen_names" | grep -Fxq "$name"; then
    echo "Duplicate skill name: $name"
    fail=1
  fi
  seen_names="${seen_names}${seen_names:+$'\n'}${name}"

  if ! printf '%s\n' "$description" | grep -Eq '^description: .+Use when .+'; then
    echo "Description must include trigger phrase 'Use when': $skill"
    fail=1
  fi

  if ! grep -q '^# ' "$skill"; then
    echo "Skill body must contain a title: $skill"
    fail=1
  fi
done

if [ "$fail" -ne 0 ]; then
  echo "Agent skill check failed."
  exit 1
fi

echo "Agent skill check passed."
