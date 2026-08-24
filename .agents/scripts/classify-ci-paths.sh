#!/usr/bin/env bash
# Classify changed repository paths into relevant CI jobs.
set -euo pipefail

application=false
integration=false
image_service=false
poi_service=false
docs=false

mark_all() {
  application=true
  integration=true
  image_service=true
  poi_service=true
  docs=true
}

if [[ "${1:-}" == "--all" ]]; then
  mark_all
else
  while IFS= read -r path; do
    [[ -n "$path" ]] || continue
    case "$path" in
      .github/workflows/*|.agents/scripts/classify-ci-paths.sh)
        mark_all
        ;;
      web/AGENTS.md|web/CLAUDE.md)
        docs=true
        ;;
      AGENTS.md|.agents/*|.codex/*|docs/*|.github/ISSUE_TEMPLATE/*|.github/pull_request_template.md|.github/prompts/*|.windsurf/*)
        docs=true
        ;;
      packages/common/*)
        application=true
        integration=true
        image_service=true
        poi_service=true
        ;;
      web/db/*|web/lib/*|web/app/api/*|web/tests/integration/*|web/tests/helpers/*|web/scripts/migrate.mjs|web/package*.json)
        application=true
        integration=true
        ;;
      web/*)
        application=true
        ;;
      image-service/*)
        image_service=true
        integration=true
        ;;
      poi-service/*)
        poi_service=true
        ;;
      docker-compose.yml)
        integration=true
        ;;
      scripts/*)
        integration=true
        ;;
    esac
  done
fi

printf 'application=%s\n' "$application"
printf 'integration=%s\n' "$integration"
printf 'image_service=%s\n' "$image_service"
printf 'poi_service=%s\n' "$poi_service"
printf 'docs=%s\n' "$docs"
