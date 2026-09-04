#!/usr/bin/env bash
# ==============================================================================
# CoffeeMode Release Deployment Forwarder (Thin Wrapper)
# Canonical Implementation: scripts/devops/upgrade-staging.sh & upgrade-prod.sh
# Architecture: docs/specs/0005-dokploy-vps-and-deployment-architecture.md
# ==============================================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  echo "Usage: ./deploy-release.sh [staging|prod] [options...]"
  echo "Delegates to scripts/devops/upgrade-staging.sh or scripts/devops/upgrade-prod.sh."
  echo "For environment options, run:"
  echo "  ../../scripts/devops/upgrade-staging.sh --help"
  echo "  ../../scripts/devops/upgrade-prod.sh --help"
  exit 0
fi

ENV="${1:-staging}"

if [[ "$ENV" == "prod" ]]; then
  shift || true
  exec "${SCRIPT_DIR}/../../scripts/devops/upgrade-prod.sh" "$@"
else
  shift || true
  exec "${SCRIPT_DIR}/../../scripts/devops/upgrade-staging.sh" "$@"
fi
