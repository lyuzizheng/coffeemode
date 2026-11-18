#!/usr/bin/env bash
# ==============================================================================
# Shared Postgres client execution for the backup/restore lifecycle
# (BRAWUKA-1015)
#
# Two facts shape this helper:
#
#   1. A custom-format (`pg_dump -Fc`) archive is only loadable into a server
#      of the same or a newer major version. A client NEWER than the server
#      writes header `SET` statements the server rejects — PostgreSQL 17+
#      clients emit `SET transaction_timeout = 0`, which a 16 server answers
#      with `unrecognized configuration parameter`. pg_restore then exits 1
#      although every object restored, so a recovery drill fails for a
#      version-skew reason the archive cannot fix. Dump and restore must
#      therefore run with the server's own major version.
#
#   2. On the Dokploy VPS the host has no `postgresql-client` at all and the
#      database port is internal to `dokploy-network` (no published port, see
#      spec 0005 §2). The database container already ships the matching
#      client, so the tools run there via `docker exec` — no port is exposed
#      and no extra image is pulled.
#
# `pg_client_plan <url> <tool>...` decides once per run and sets:
#   PG_CLIENT_MODE             "host" | "container"
#   PG_CLIENT_CONTAINER_NAME   container name when mode is "container"
#
# Resolution order:
#   1. `PG_CLIENT_CONTAINER` (explicit operator override) — container
#   2. every tool on PATH and (client major == server major, or the probe could
#      not answer) — host, the historical behaviour
#   3. a single database container matched by the URL — container
#   4. otherwise fail closed with the remedy (no credential is printed)
#
# `pg_run <tool> ...` then executes in the planned mode. Planning is
# side-effect free; nothing here mutates the database or the host.
#
# Usage: source "${SCRIPT_DIR}/lib/pg-client.sh"
# ==============================================================================

PG_CLIENT_MODE="host"
PG_CLIENT_CONTAINER_NAME=""

# pg_url_host <connection-string> — hostname without userinfo, port, or path.
pg_url_host() {
  local rest="${1#*://}"
  rest="${rest##*@}"
  rest="${rest%%[/?#]*}"
  rest="${rest%:*}"
  printf '%s' "$rest"
}

# pg_url_port <connection-string> — explicit port, else 5432.
pg_url_port() {
  local rest="${1#*://}"
  rest="${rest##*@}"
  rest="${rest%%[/?#]*}"
  if [[ "$rest" =~ :([0-9]+)$ ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
  else
    printf '5432'
  fi
}

# pg_client_version_major <pg_dump|pg_restore|psql> — first version number in
# `--version` output, or empty when the binary cannot answer.
pg_client_version_major() {
  local bin="$1" out major
  out="$("$bin" --version 2>/dev/null)" || return 1
  major="$(printf '%s' "$out" | sed -nE 's/^[^0-9]*([0-9]+).*/\1/p')"
  [[ -n "$major" ]] || return 1
  printf '%s' "$major"
}

# pg_server_major <url> — server major from `server_version_num`, or empty.
# A newer client may connect to an older server; only the archive format is
# version-bound, so this probe is safe with whatever client is on the host.
pg_server_major() {
  local url="$1" num major
  command -v psql >/dev/null 2>&1 || return 1
  num="$(PGCONNECT_TIMEOUT=5 psql "$url" -X -v ON_ERROR_STOP=1 -tA \
    -c "SHOW server_version_num" 2>/dev/null | tr -d '[:space:]')" || return 1
  [[ "$num" =~ ^[0-9]+$ ]] || return 1
  major="$(( num / 10000 ))"
  printf '%s' "$major"
}

# pg_client_container <url> — the one running container that fronts the URL.
# A loopback host is matched by its published port (dev/CI compose). Any other
# host is matched three ways, first hit wins:
#   1. container name prefix (Dokploy `<service>.1.<task>`, compose `<name>-1`)
#   2. the host is a network alias on that container (Dokploy's internal DNS
#      name often differs from the container name, e.g.
#      a Dokploy service alias that differs from the container name)
#   3. the host is the container's own name in `docker inspect`
# Ambiguity returns 1 so the operator names `PG_CLIENT_CONTAINER` instead of
# the script guessing.
pg_client_container() {
  local url="$1" host port names host_re name aliases
  command -v docker >/dev/null 2>&1 || return 1
  host="$(pg_url_host "$url")"
  port="$(pg_url_port "$url")"
  [[ -n "$host" ]] || return 1

  if [[ "$host" == "localhost" || "$host" == "127.0.0.1" || "$host" == "::1" ]]; then
    names="$(docker ps --filter "publish=${port}" --format '{{.Names}}' 2>/dev/null || true)"
  else
    host_re="$(printf '%s' "$host" | sed 's/[.[\*^$()+?{|]/\\&/g')"
    names="$(docker ps --format '{{.Names}}' 2>/dev/null \
      | grep -E "^${host_re}([._-]|$)" || true)"
    if [[ -z "$names" ]]; then
      names="$(while IFS= read -r name; do
        [[ -n "$name" ]] || continue
        aliases="$(docker inspect "$name" --format \
          '{{range .NetworkSettings.Networks}}{{range .Aliases}}{{println .}}{{end}}{{end}}{{println .Config.Hostname}}' \
          2>/dev/null || true)"
        printf '%s\n' "$aliases" | grep -Fxq "$host" && printf '%s\n' "$name"
      done < <(docker ps --format '{{.Names}}' 2>/dev/null || true))"
    fi
  fi

  [[ -n "$names" ]] || return 1
  [[ "$(printf '%s\n' "$names" | grep -c .)" == "1" ]] || return 1
  printf '%s' "$names"
}

# pg_client_plan <url> <tool>... — choose the execution mode for this run.
# Prints one diagnostic on stderr when it switches to a container or when it
# refuses; never prints a credential (host and port only).
pg_client_plan() {
  local url="$1"
  shift
  local -a tools=("$@")
  local tool="${tools[0]:-}"
  local host port missing=0 t client_major="" server_major="" container=""

  PG_CLIENT_MODE="host"
  PG_CLIENT_CONTAINER_NAME=""

  if [[ -z "$url" || -z "$tool" ]]; then
    echo "pg-client: a connection string and at least one tool are required." >&2
    return 1
  fi
  host="$(pg_url_host "$url")"
  port="$(pg_url_port "$url")"

  if [[ -n "${PG_CLIENT_CONTAINER:-}" ]]; then
    PG_CLIENT_MODE="container"
    PG_CLIENT_CONTAINER_NAME="$PG_CLIENT_CONTAINER"
    return 0
  fi

  for t in "${tools[@]}"; do
    command -v "$t" >/dev/null 2>&1 || missing=1
  done

  if [[ $missing -eq 0 ]]; then
    client_major="$(pg_client_version_major "$tool" 2>/dev/null || true)"
    server_major="$(pg_server_major "$url" 2>/dev/null || true)"
    # Unknown on either side keeps the historical host behaviour: the caller
    # still fails loudly on its own if the archive or the connection is bad.
    if [[ -z "$client_major" || -z "$server_major" || "$client_major" == "$server_major" ]]; then
      return 0
    fi
  fi

  if container="$(pg_client_container "$url")"; then
    PG_CLIENT_MODE="container"
    PG_CLIENT_CONTAINER_NAME="$container"
    if [[ $missing -eq 0 ]]; then
      echo "[pg-client] host ${tool} is major ${client_major}, server ${host}:${port} is major ${server_major}; running ${tool} inside container '${container}' so the archive matches the server." >&2
    else
      echo "[pg-client] ${tools[*]} not on PATH; running inside database container '${container}'." >&2
    fi
    return 0
  fi

  if [[ $missing -eq 1 ]]; then
    echo "pg-client: ${tools[*]} not found on PATH, and no running database container matched ${host}:${port}." >&2
    echo "pg-client: set PG_CLIENT_CONTAINER=<container name from 'docker ps'> and rerun." >&2
  else
    echo "pg-client: host ${tool} is major ${client_major} but ${host}:${port} is major ${server_major}." >&2
    echo "pg-client: an archive written by a newer client is not loadable into an older server (e.g. 'SET transaction_timeout')." >&2
    echo "pg-client: set PG_CLIENT_CONTAINER=<database container from 'docker ps'> so the client runs at the server's major version." >&2
  fi
  return 1
}

# pg_run <tool> [args...] — execute in the mode chosen by pg_client_plan.
pg_run() {
  local tool="$1"
  shift
  if [[ "$PG_CLIENT_MODE" == "container" ]]; then
    docker exec -i "$PG_CLIENT_CONTAINER_NAME" "$tool" "$@"
  else
    "$tool" "$@"
  fi
}
