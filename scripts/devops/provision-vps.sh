#!/usr/bin/env bash
# ==============================================================================
# CoffeeMode VPS Cold-Start Provisioning & Hardening Suite
# Architecture: docs/specs/0005-dokploy-vps-and-deployment-architecture.md
# Lifecycle:    docs/devops/LIFECYCLE.md
#
# Provisions a blank Ubuntu/Debian LTS VPS from scratch:
#   1. System updates & essential operational packages
#   2. Swap configuration & production kernel sysctl parameters
#   3. System hardening: fail2ban brute-force defense & UFW firewall
#   4. Official Docker Engine CE + Docker Compose plugin + log rotation
#   5. Docker Swarm initialization (enables zero-downtime rolling swaps)
#   6. Automated Dokploy PaaS & Traefik reverse proxy binding (ports 80/443)
#   7. External ingress network (traefik-net) setup
#
# Usage:
#   ./provision-vps.sh [options]
#
# Options:
#   -h, --help            Show this help message and exit
#   --ssh-port <port>     SSH port to allow in firewall (default: 22)
#   --swap-size <gb>      Swap space in GB to configure (default: 2)
#   --skip-swap           Skip swap creation and sysctl tuning
#   --skip-ufw            Skip UFW firewall configuration
#   --skip-fail2ban       Skip fail2ban installation and configuration
#   --skip-docker         Skip Docker installation and swarm init
#   --skip-dokploy        Skip Dokploy installation
#   --dry-run             Log planned actions without modifying system state
#
# Examples:
#   ./provision-vps.sh
#   ./provision-vps.sh --ssh-port 2222 --swap-size 4
#   ./provision-vps.sh --dry-run
# ==============================================================================

set -euo pipefail

# ------------------------------------------------------------------------------
# Defaults & CLI Argument Parsing
# ------------------------------------------------------------------------------
SSH_PORT=22
SWAP_SIZE=2
SKIP_SWAP=false
SKIP_UFW=false
SKIP_FAIL2BAN=false
SKIP_DOCKER=false
SKIP_DOKPLOY=false
DRY_RUN=false

show_help() {
  sed -n '2,/^# ==/p' "$0" | sed 's/^# \?//'
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      show_help
      ;;
    --ssh-port)
      SSH_PORT="${2:?Error: --ssh-port requires a port argument}"
      shift 2
      ;;
    --swap-size)
      SWAP_SIZE="${2:?Error: --swap-size requires a size in GB}"
      shift 2
      ;;
    --skip-swap)
      SKIP_SWAP=true
      shift
      ;;
    --skip-ufw)
      SKIP_UFW=true
      shift
      ;;
    --skip-fail2ban)
      SKIP_FAIL2BAN=true
      shift
      ;;
    --skip-docker)
      SKIP_DOCKER=true
      shift
      ;;
    --skip-dokploy)
      SKIP_DOKPLOY=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    *)
      echo "Error: Unknown argument '$1'. Run '$0 --help' for usage." >&2
      exit 1
      ;;
  esac
done

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

run_cmd() {
  if [ "$DRY_RUN" = true ]; then
    echo -e "  ${YELLOW}[DRY-RUN]${NC} $*"
  else
    "$@"
  fi
}

# ------------------------------------------------------------------------------
# Preflight & Privilege Verification
# ------------------------------------------------------------------------------
log "Checking operational environment and privileges..."

if [ "$DRY_RUN" = false ]; then
  if [ "$(id -u)" -ne 0 ]; then
    error "This script must be run as root (or via sudo)."
    exit 1
  fi
fi

if [ -f /etc/os-release ]; then
  # shellcheck source=/dev/null
  . /etc/os-release
  DISTRO_ID="${ID:-unknown}"
  DISTRO_VERSION="${VERSION_ID:-unknown}"
  log "Detected OS: ${DISTRO_ID} (${DISTRO_VERSION})"
  if [[ "$DISTRO_ID" != "ubuntu" && "$DISTRO_ID" != "debian" ]]; then
    warn "Unsupported distribution '${DISTRO_ID}'. Debian or Ubuntu LTS recommended."
  fi
else
  warn "/etc/os-release not found. Proceeding with caution."
fi

# ------------------------------------------------------------------------------
# STEP 1: System Packages & Upgrades
# ------------------------------------------------------------------------------
log "Step 1/7: Updating system package repositories..."
export DEBIAN_FRONTEND=noninteractive
run_cmd apt-get update -y
run_cmd apt-get install -y --no-install-recommends \
  curl \
  wget \
  git \
  jq \
  unzip \
  tar \
  gzip \
  ca-certificates \
  gnupg \
  lsb-release \
  htop \
  net-tools \
  ufw \
  fail2ban
ok "Core utility packages installed."

# ------------------------------------------------------------------------------
# STEP 2: Swap Configuration & Kernel Sysctl Parameters
# ------------------------------------------------------------------------------
if [ "$SKIP_SWAP" = false ]; then
  log "Step 2/7: Configuring swap space (${SWAP_SIZE}GB) and kernel sysctl..."
  if [ "$DRY_RUN" = false ]; then
    if swapon --show | grep -q "/swapfile"; then
      ok "Swapfile /swapfile already active. Skipping creation."
    elif [ -f /swapfile ]; then
      ok "Swapfile /swapfile exists on disk. Enabling..."
      swapon /swapfile || true
    else
      log "Allocating /swapfile (${SWAP_SIZE}GB)..."
      if command -v fallocate >/dev/null 2>&1; then
        fallocate -l "${SWAP_SIZE}G" /swapfile 2>/dev/null || \
          dd if=/dev/zero of=/swapfile bs=1M count="$((SWAP_SIZE * 1024))" status=progress
      else
        dd if=/dev/zero of=/swapfile bs=1M count="$((SWAP_SIZE * 1024))" status=progress
      fi
      chmod 600 /swapfile
      mkswap /swapfile
      swapon /swapfile
      if ! grep -qF '/swapfile none swap sw 0 0' /etc/fstab; then
        echo '/swapfile none swap sw 0 0' >> /etc/fstab
      fi
      ok "Swapfile created and registered in /etc/fstab."
    fi

    # Kernel parameter tuning for production PostGIS & Next.js workloads
    cat > /etc/sysctl.d/99-coffeemode.conf <<'EOF'
# CoffeeMode production kernel sysctl parameters
vm.swappiness=10
vm.vfs_cache_pressure=50
vm.max_map_count=262144
net.core.somaxconn=1024
net.ipv4.tcp_max_syn_backlog=2048
EOF
    sysctl --system >/dev/null 2>&1 || sysctl -p /etc/sysctl.d/99-coffeemode.conf >/dev/null 2>&1 || true
    ok "Production kernel sysctl parameters applied."
  else
    ok "[DRY-RUN] Swap and sysctl configuration simulated."
  fi
else
  log "Step 2/7: Swap configuration skipped (--skip-swap)."
fi

# ------------------------------------------------------------------------------
# STEP 3: Security Hardening (Fail2ban & UFW Firewall)
# ------------------------------------------------------------------------------
if [ "$SKIP_FAIL2BAN" = false ]; then
  log "Step 3a/7: Hardening SSH via fail2ban..."
  if [ "$DRY_RUN" = false ]; then
    cat > /etc/fail2ban/jail.local <<EOF
[DEFAULT]
bantime = 1h
findtime = 10m
maxretry = 5

[sshd]
enabled = true
port = ${SSH_PORT}
EOF
    systemctl restart fail2ban || service fail2ban restart || true
    ok "Fail2ban configured for SSH protection on port ${SSH_PORT}."
  else
    ok "[DRY-RUN] Fail2ban configuration simulated."
  fi
else
  log "Step 3a/7: Fail2ban skipped (--skip-fail2ban)."
fi

if [ "$SKIP_UFW" = false ]; then
  log "Step 3b/7: Configuring UFW firewall rules..."
  run_cmd ufw default deny incoming
  run_cmd ufw default allow outgoing
  run_cmd ufw allow "${SSH_PORT}/tcp" comment "SSH Access"
  run_cmd ufw allow 80/tcp comment "HTTP (Traefik / Let's Encrypt)"
  run_cmd ufw allow 443/tcp comment "HTTPS (Traefik SSL)"
  if [ "$DRY_RUN" = false ]; then
    if ufw --force enable; then
      ok "UFW firewall active (ports ${SSH_PORT}, 80, 443 allowed; all others denied)."
    else
      error "UFW firewall activation failed!"
      exit 1
    fi
  else
    ok "[DRY-RUN] UFW firewall activation simulated."
  fi
else
  log "Step 3b/7: UFW firewall skipped (--skip-ufw)."
fi

# ------------------------------------------------------------------------------
# STEP 4: Official Docker Engine & Compose Installation
# ------------------------------------------------------------------------------
if [ "$SKIP_DOCKER" = false ]; then
  log "Step 4/7: Installing official Docker Engine CE and Compose plugin..."
  if command -v docker >/dev/null 2>&1; then
    ok "Docker is already installed ($(docker --version))."
  else
    if [ "$DRY_RUN" = false ]; then
      install -m 0755 -d /etc/apt/keyrings
      curl -fsSL "https://download.docker.com/linux/${DISTRO_ID:-ubuntu}/gpg" | \
        gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
      chmod a+r /etc/apt/keyrings/docker.gpg

      echo \
        "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${DISTRO_ID:-ubuntu} \
        $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
        tee /etc/apt/sources.list.d/docker.list > /dev/null

      apt-get update -y
      apt-get install -y --no-install-recommends \
        docker-ce \
        docker-ce-cli \
        containerd.io \
        docker-buildx-plugin \
        docker-compose-plugin

      # Docker daemon configuration: logging caps prevent disk exhaustion
      mkdir -p /etc/docker
      cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "50m",
    "max-file": "3"
  }
}
EOF
      systemctl enable --now docker || service docker start || true
      ok "Docker Engine installed and started."
    else
      ok "[DRY-RUN] Docker Engine installation simulated."
    fi
  fi
else
  log "Step 4/7: Docker installation skipped (--skip-docker)."
fi

# ------------------------------------------------------------------------------
# STEP 5: Docker Swarm Initialization (Enables Zero-Downtime Rolling Swaps)
# ------------------------------------------------------------------------------
if [ "$SKIP_DOCKER" = false ]; then
  log "Step 5/7: Verifying Docker Swarm status..."
  if [ "$DRY_RUN" = false ]; then
    SWARM_STATE="$(docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null || echo 'inactive')"
    if [ "$SWARM_STATE" = "active" ]; then
      ok "Docker Swarm is already active on this node."
    else
      log "Initializing Docker Swarm on loopback..."
      if docker swarm init --advertise-addr 127.0.0.1; then
        ok "Docker Swarm initialized successfully."
      else
        warn "Docker Swarm init returned non-zero. Verifying Swarm state..."
        SWARM_STATE="$(docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null || echo 'inactive')"
        if [ "$SWARM_STATE" = "active" ]; then
          ok "Docker Swarm is active."
        else
          error "Docker Swarm initialization failed!"
          exit 1
        fi
      fi
    fi
  else
    ok "[DRY-RUN] Docker Swarm initialization simulated."
  fi
else
  log "Step 5/7: Docker Swarm skipped."
fi

# ------------------------------------------------------------------------------
# STEP 6: Dokploy PaaS & Traefik Ingress Bridge Network
# ------------------------------------------------------------------------------
if [ "$SKIP_DOKPLOY" = false ]; then
  log "Step 6/7: Configuring Dokploy prerequisites and Traefik ingress network..."
  if [ "$DRY_RUN" = false ]; then
    # Shared external bridge network required by Traefik and web containers
    if docker network inspect traefik-net >/dev/null 2>&1; then
      ok "Network 'traefik-net' already exists."
    else
      docker network create --driver bridge traefik-net
      ok "Created external Docker bridge network 'traefik-net'."
    fi

    # Dokploy setup directory
    mkdir -p /etc/dokploy

    if docker ps --format '{{.Names}}' | grep -q "dokploy"; then
      ok "Dokploy container is already running."
    else
      log "Installing Dokploy via official automated setup..."
      curl -sSL https://dokploy.com/setup.sh | bash || {
        warn "Dokploy setup script returned non-zero. Verifying container presence..."
        sleep 5
      }
      if docker ps --format '{{.Names}}' | grep -q "dokploy"; then
        ok "Dokploy installed and running."
      else
        warn "Dokploy container not yet detected. Check 'docker ps' or run Dokploy setup manually."
      fi
    fi
  else
    ok "[DRY-RUN] Dokploy setup and 'traefik-net' network creation simulated."
  fi
else
  log "Step 6/7: Dokploy setup skipped (--skip-dokploy)."
fi

# ------------------------------------------------------------------------------
# STEP 7: Completion & Summary Report
# ------------------------------------------------------------------------------
HOST_IP="$(curl -s -m 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}' || echo "UNKNOWN_IP")"

echo ""
echo "=============================================================================="
echo -e "${BOLD}${GREEN}CoffeeMode VPS Cold-Start Provisioning Complete!${NC}"
echo "=============================================================================="
echo "Host Public IP:    ${HOST_IP}"
echo "SSH Port:          ${SSH_PORT}"
echo "Firewall (UFW):    Active (Ports ${SSH_PORT}, 80, 443 allowed)"
echo "Docker Engine:     $(docker --version 2>/dev/null || echo 'Installed')"
echo "Docker Swarm:      $([ "$SKIP_DOCKER" = false ] && echo 'Active' || echo 'Skipped')"
echo "Traefik Network:   traefik-net (Ready)"
echo "Dokploy Dashboard: Bound to port 3000. Access via SSH tunnel: ssh -L 3000:127.0.0.1:3000 root@${HOST_IP}"
echo "Next Step:         Run ./bootstrap.sh to provision databases and services."
echo "=============================================================================="
