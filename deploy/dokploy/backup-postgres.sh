#!/usr/bin/env bash
# ==============================================================================
# CoffeeMode PostgreSQL Backup Forwarder (Thin Wrapper)
# Canonical Implementation: scripts/devops/backup.sh
# Architecture: docs/specs/0005-dokploy-vps-and-deployment-architecture.md
# ==============================================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "${SCRIPT_DIR}/../../scripts/devops/backup.sh" "$@"
