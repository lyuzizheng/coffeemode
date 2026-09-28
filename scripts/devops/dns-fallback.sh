#!/usr/bin/env bash
# ==============================================================================
# CafeMood Host DNS Upstream Fallback (BRAWUKA-764 incident, BRAWUKA-770 contract)
# Runbook: docs/devops/LIFECYCLE.md §6 "Host DNS upstream fallback"
#
# Why this exists
#   Docker snapshots the host /etc/resolv.conf into every container's embedded
#   resolver (127.0.0.11) at container-creation time, and it never refills a
#   running container after the host recovers. When dhcpcd regenerated
#   /etc/resolv.conf during the n150 WiFi outage with no DHCP nameserver, every
#   container created in that window was stuck on "NO EXTERNAL NAMESERVERS
#   DEFINED": staging deploys stopped for ~19h and the web→POI proxy answered
#   502. Owner decision (BRAWUKA-764 thread): keep DHCP nameservers first and
#   append 1.1.1.1 as a fallback — never replace the DHCP entries.
#
# How the guarantee works
#   dhcpcd's resolv.conf hook (dhcpcd-base 10.1.0 on n150:
#   /usr/lib/dhcpcd/dhcpcd-hooks/20-resolv.conf) appends /etc/resolv.conf.tail
#   to every /etc/resolv.conf it regenerates — including the branch that runs
#   when DHCP returned no nameserver at all (it rebuilds from the per-interface
#   state and still appends the tail). So a one-line tail file keeps the host
#   file non-empty in exactly the window that broke BRAWUKA-764, and any
#   container created afterwards snapshots a working upstream.
#
# Usage:
#   ./dns-fallback.sh apply [--dry-run]   # idempotently install the fallback
#   ./dns-fallback.sh check               # verify it and report the snapshot risk
#   ./dns-fallback.sh revert [--dry-run]  # remove the line this script added
#
# Options:
#   --dry-run   Log planned actions without modifying system state
#   -h, --help  Show this help message and exit
#
# Environment:
#   SYSROOT   Root prefix for host paths (default: empty = the real "/"). The
#             fixture tests in web/tests/devops/dns-fallback.test.ts use it to
#             run this script against a scratch tree instead of the host.
#
# Exit codes:
#   apply    0 = fallback installed or already present, or not applicable to this
#               host's resolver manager (reported as `not-applicable`)
#   check    0 = fallback verified or not applicable; 1 = applicable host whose
#               fallback (or live nameserver set) is missing
#   revert   0 = the fallback line is gone (removed now or already absent)
# ==============================================================================

set -euo pipefail

# ------------------------------------------------------------------------------
# Policy constant — the Owner-selected fallback resolver
# ------------------------------------------------------------------------------
FALLBACK_NAMESERVER="1.1.1.1"
FALLBACK_LINE="nameserver ${FALLBACK_NAMESERVER}"

# ------------------------------------------------------------------------------
# Host paths (SYSROOT-prefixed so fixture tests never touch the real host)
# ------------------------------------------------------------------------------
SYSROOT="${SYSROOT:-}"
SYSROOT="${SYSROOT%/}"
RESOLV_CONF="${SYSROOT}/etc/resolv.conf"
TAIL_FILE="${SYSROOT}/etc/resolv.conf.tail"
# dhcpcd ships its hooks in one of these locations depending on distro/version.
HOOK_CANDIDATES=(
  "${SYSROOT}/usr/lib/dhcpcd/dhcpcd-hooks/20-resolv.conf"
  "${SYSROOT}/lib/dhcpcd/dhcpcd-hooks/20-resolv.conf"
  "${SYSROOT}/etc/dhcpcd-hooks/20-resolv.conf"
)

# ------------------------------------------------------------------------------
# CLI Argument Parsing
# ------------------------------------------------------------------------------
DRY_RUN=false
COMMAND=""

show_help() {
  sed -n '2,/^# ==/p' "$0" | sed 's/^# \?//'
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      show_help
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    apply|check|revert)
      if [[ -n "$COMMAND" ]]; then
        echo "Error: command '${COMMAND}' already given (got '${1}' too)." >&2
        exit 2
      fi
      COMMAND="$1"
      shift
      ;;
    *)
      echo "Error: Unknown argument '$1'. Run '$0 --help' for usage." >&2
      exit 2
      ;;
  esac
done

if [[ -z "$COMMAND" ]]; then
  echo "Error: a command is required (apply | check | revert). Run '$0 --help'." >&2
  exit 2
fi

# ------------------------------------------------------------------------------
# Logging Utilities
# ------------------------------------------------------------------------------
BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

log()   { echo -e "${BOLD}${BLUE}[INFO]${NC}  $*"; }
ok()    { echo -e "${BOLD}${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${BOLD}${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${BOLD}${RED}[ERROR]${NC} $*" >&2; }

# The final line is the machine-readable status; provisioning summarises it.
status() { echo "dns-fallback: $1"; }

# ------------------------------------------------------------------------------
# Resolver manager detection
# ------------------------------------------------------------------------------
# Sets MANAGER (`dhcpcd` or `other`), REASON, and HOOK_PATH.
MANAGER="other"
REASON=""
HOOK_PATH=""

detect_manager() {
  if [[ -L "$RESOLV_CONF" ]]; then
    REASON="${RESOLV_CONF} is a symlink to $(readlink "$RESOLV_CONF" 2>/dev/null || echo '<unknown>') — managed by systemd-resolved, NetworkManager, or netplan, not dhcpcd"
    return 0
  fi

  if command -v resolvconf >/dev/null 2>&1; then
    REASON="openresolv's resolvconf is installed, so dhcpcd delegates to it and never appends ${TAIL_FILE}"
    return 0
  fi

  local candidate
  for candidate in "${HOOK_CANDIDATES[@]}"; do
    if [[ -f "$candidate" ]]; then
      HOOK_PATH="$candidate"
      break
    fi
  done

  if [[ -z "$HOOK_PATH" ]]; then
    REASON="no dhcpcd resolv.conf hook found (looked in ${HOOK_CANDIDATES[*]})"
    return 0
  fi

  if ! grep -q 'resolv\.conf\.tail' "$HOOK_PATH"; then
    REASON="dhcpcd hook ${HOOK_PATH} never references ${TAIL_FILE}, so the fallback would not reach the generated file"
    return 0
  fi

  MANAGER="dhcpcd"
  REASON="dhcpcd hook ${HOOK_PATH} appends ${TAIL_FILE} to every regenerated ${RESOLV_CONF}"
}

# Print the interface whose DHCP lease owns /etc/resolv.conf, when discoverable.
detect_interface() {
  local iface=""
  if command -v ip >/dev/null 2>&1; then
    iface="$(ip route show default 2>/dev/null | awk 'NR==1 {print $5}' || true)"
  fi
  printf '%s' "$iface"
}

regenerate_hint() {
  local iface
  iface="$(detect_interface)"
  echo "dhcpcd ${iface:-<interface>}"
}

# Count `nameserver` lines in a resolv.conf-style file.
count_nameservers() {
  local file="$1"
  [[ -f "$file" ]] || { printf '0'; return 0; }
  grep -c '^[[:space:]]*nameserver[[:space:]]' "$file" || true
}

tail_has_fallback() {
  [[ -f "$TAIL_FILE" ]] || return 1
  grep -qx "[[:space:]]*${FALLBACK_LINE}[[:space:]]*" "$TAIL_FILE"
}

# ------------------------------------------------------------------------------
# apply
# ------------------------------------------------------------------------------
cmd_apply() {
  detect_manager

  if [[ "$MANAGER" != "dhcpcd" ]]; then
    warn "Not applicable on this host: ${REASON}."
    log "No fallback was written. Docker's own resolver defaults cover the resolved/NetworkManager stub cases; for any other manager, see docs/devops/LIFECYCLE.md §6."
    status "not-applicable (${REASON})"
    return 0
  fi

  log "Applicable: ${REASON}."

  if tail_has_fallback; then
    ok "${TAIL_FILE} already carries '${FALLBACK_LINE}' — leaving it untouched."
  elif [[ "$DRY_RUN" = true ]]; then
    ok "[DRY-RUN] Would append '${FALLBACK_LINE}' to ${TAIL_FILE} (existing entries preserved)."
  else
    if [[ -f "$TAIL_FILE" ]]; then
      printf '%s\n' "$FALLBACK_LINE" >> "$TAIL_FILE"
      ok "Appended '${FALLBACK_LINE}' to ${TAIL_FILE} (existing entries preserved)."
    else
      mkdir -p "$(dirname "$TAIL_FILE")"
      printf '%s\n' "$FALLBACK_LINE" > "$TAIL_FILE"
      ok "Created ${TAIL_FILE} with '${FALLBACK_LINE}'."
    fi
  fi

  # The tail only reaches /etc/resolv.conf when dhcpcd regenerates it.
  local live_count
  live_count="$(count_nameservers "$RESOLV_CONF")"
  if [[ "$live_count" -eq 0 ]]; then
    warn "${RESOLV_CONF} currently has no nameserver line. Containers created before the next dhcpcd regeneration would still snapshot an empty upstream set."
    log "Regenerate now: $(regenerate_hint)   # then re-run: $0 check"
  elif ! grep -qx "[[:space:]]*${FALLBACK_LINE}[[:space:]]*" "$RESOLV_CONF"; then
    log "${RESOLV_CONF} does not carry the fallback yet — it is applied at the next dhcpcd regeneration."
    log "To apply it now: $(regenerate_hint)"
  else
    ok "${RESOLV_CONF} already carries the fallback."
  fi

  status "ok (fallback '${FALLBACK_LINE}' present in ${TAIL_FILE})"
}

# ------------------------------------------------------------------------------
# check
# ------------------------------------------------------------------------------
cmd_check() {
  detect_manager

  if [[ "$MANAGER" != "dhcpcd" ]]; then
    warn "Not applicable on this host: ${REASON}."
    status "not-applicable (${REASON})"
    return 0
  fi

  log "Manager: dhcpcd (${HOOK_PATH})."

  local live_count
  live_count="$(count_nameservers "$RESOLV_CONF")"

  if ! tail_has_fallback; then
    error "${TAIL_FILE} does not carry '${FALLBACK_LINE}'. The next dhcpcd regeneration can leave ${RESOLV_CONF} with no upstream resolver, and containers created in that window would snapshot an empty resolver set."
    log "Fix: $0 apply"
    status "fail (fallback missing from ${TAIL_FILE})"
    return 1
  fi
  ok "${TAIL_FILE} carries '${FALLBACK_LINE}'."

  if [[ "$live_count" -eq 0 ]]; then
    error "${RESOLV_CONF} has no nameserver line right now — a container created at this moment snapshots an empty upstream set."
    log "Regenerate now: $(regenerate_hint)   # then re-run: $0 check"
    log "Containers already created keep their stale snapshot: recreate them (docker restart <name>, docker service update --force <service>) instead of waiting for the host to recover."
    status "fail (live ${RESOLV_CONF} has no nameserver line)"
    return 1
  fi
  ok "${RESOLV_CONF} has ${live_count} nameserver line(s)."

  if grep -qx "[[:space:]]*${FALLBACK_LINE}[[:space:]]*" "$RESOLV_CONF"; then
    ok "Fallback active in the live resolver file — containers created from now on snapshot it."
  else
    warn "Live ${RESOLV_CONF} has not picked up the fallback yet (it applies at the next dhcpcd regeneration)."
    log "To apply it now: $(regenerate_hint)"
  fi

  log "Reminder: a container created during an outage keeps its empty snapshot — recreate it rather than waiting."
  status "ok (fallback in ${TAIL_FILE}, ${live_count} live nameserver line(s))"
}

# ------------------------------------------------------------------------------
# revert
# ------------------------------------------------------------------------------
cmd_revert() {
  if [[ ! -f "$TAIL_FILE" ]]; then
    ok "${TAIL_FILE} does not exist — nothing to revert."
    status "ok (no fallback installed)"
    return 0
  fi

  if ! tail_has_fallback; then
    ok "${TAIL_FILE} carries no '${FALLBACK_LINE}' line — nothing to revert."
    status "ok (no fallback installed)"
    return 0
  fi

  if [[ "$DRY_RUN" = true ]]; then
    ok "[DRY-RUN] Would drop '${FALLBACK_LINE}' from ${TAIL_FILE} and delete the file if nothing else remains."
  else
    local tmp
    tmp="$(mktemp "${TAIL_FILE}.XXXXXX")"
    grep -vx "[[:space:]]*${FALLBACK_LINE}[[:space:]]*" "$TAIL_FILE" > "$tmp" || true
    if [[ -z "$(tr -d '[:space:]' < "$tmp")" ]]; then
      rm -f "$tmp" "$TAIL_FILE"
      ok "Removed ${TAIL_FILE} (it held only the fallback line)."
    else
      cat "$tmp" > "$TAIL_FILE"
      rm -f "$tmp"
      ok "Removed '${FALLBACK_LINE}' from ${TAIL_FILE}; other entries preserved."
    fi
  fi

  log "The live ${RESOLV_CONF} keeps the fallback until dhcpcd regenerates it: $(regenerate_hint)"
  status "ok (fallback removed)"
}

# ------------------------------------------------------------------------------
# Dispatch
# ------------------------------------------------------------------------------
case "$COMMAND" in
  apply)  cmd_apply ;;
  check)  cmd_check ;;
  revert) cmd_revert ;;
esac
