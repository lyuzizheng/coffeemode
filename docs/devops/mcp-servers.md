# MCP Servers Runbook

Agent-facing MCP servers that live on the Dokploy VPS. Both are deployed from
the CoffeeMode project's `infrastructure` environment so they stay out of the
staging/prod app stacks.

| Server | Dokploy app | Endpoint | Auth |
|---|---|---|---|
| `mcp-grafana` | `coffeemode-mcp-grafana` | `https://mcp.cafemood.app/mcp` | Cloudflare Access service token + caller bearer token |
| `dokploy-mcp` | `dokploy-mcp` (compose) | `http://192.168.5.103:3005/mcp` | none — LAN only |

`dokploy-mcp` has no auth of its own: any device on the LAN can drive the
Dokploy API through it. Accepted for now (the VPS LAN is trusted), but it is a
known exposure — if that assumption stops holding, front it with Cloudflare
Access or a firewall rule the same way as `mcp-grafana`.

## mcp-grafana (BRAWUKA-600)

Gives agents read/write access to the Grafana Cloud stack: dashboards, alert
rules, datasources, PromQL/LogQL queries. Image `grafana/mcp-grafana:1.5.1`,
streamable HTTP on container port 8000.

### Deployment shape

- **Dokploy app** `coffeemode-mcp-grafana` (`applicationId jqpe5DMzNn2Ij8BncSizq`),
  source type `docker`, image `grafana/mcp-grafana:1.5.1`.
- **Command override** — Dokploy's `command` field *replaces* the image
  entrypoint, so the binary path must be included:

  ```
  /app/mcp-grafana -t streamable-http --address 0.0.0.0:8000 --allowed-hosts mcp.cafemood.app --usage-stats disabled
  ```

  `--allowed-hosts` is required: the default allowlist is loopback-only, and
  Traefik forwards the public `Host` header. `--usage-stats disabled` keeps the
  server from phoning home to Grafana.
- **Resources** — `memoryLimit 536870912` / `memoryReservation 134217728`.
  Dokploy's memory fields take **bytes**, not `512M`. Leave `cpuLimit` /
  `cpuReservation` unset: any value trips a swarm validation error
  (`invalid cpu value 1e-09`).
- **Ingress** — Cloudflare DNS `CNAME mcp.cafemood.app` → tunnel `n150`
  (`b3753c85-7266-43fe-ac2b-c48c2c0aa25e`), tunnel ingress rule
  `mcp.cafemood.app → http://localhost:80`, then Traefik → container 8000.
  TLS terminates at Cloudflare, so the Dokploy domain is `https: false` /
  `certificateType: none` — same as the web apps.

### Auth

Two independent layers, both required:

1. **Cloudflare Access** — app `CafeMood Grafana MCP`, single policy
   `Allow MCP Service Token` (`non_identity`) bound to service token
   `cafemood-mcp-grafana-token`. Callers send `CF-Access-Client-Id` and
   `CF-Access-Client-Secret`. Without them the edge returns 403.
2. **Caller bearer token** — `MCP_GRAFANA_SERVER_TOKEN` in the app env.
   Without it the server returns 401.

The Grafana service account token (`GRAFANA_SERVICE_ACCOUNT_TOKEN`) is a third
credential, held only by the container.

### Rotating the caller bearer token

```bash
TOKEN=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')
```

Set `MCP_GRAFANA_SERVER_TOKEN` to `$TOKEN` in the Dokploy app env, redeploy,
then update the `grafana` entry's `Authorization` header in
`~/.omp/agent/mcp.json`.

### Rotating the Access service token

Create a replacement in Cloudflare Zero Trust → Access → Service Auth, point
the `Allow MCP Service Token` policy at it, then update
`CF-Access-Client-Id` / `CF-Access-Client-Secret` in `~/.omp/agent/mcp.json`.
Tokens expire after 12 months (`cafemood-mcp-grafana-token` expires
2027-09-21).

### Verifying

The Access app covers the whole hostname — `/healthz` has no bypass — so both
checks below need the same URL and differ only in headers.

```bash
# edge + tunnel + container up (200 only with the two CF-Access headers)
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
  https://mcp.cafemood.app/healthz   # 200

# same URL without them: 403 is Access working, not an outage
curl -s -o /dev/null -w '%{http_code}\n' https://mcp.cafemood.app/healthz   # 403

# full MCP handshake (expect a JSON-RPC result with serverInfo mcp-grafana)
curl -s -X POST https://mcp.cafemood.app/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
  -H "authorization: Bearer $MCP_GRAFANA_SERVER_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
```

A `tools/call` that returns `dial tcp ... connection refused` on
`localhost:3000` means the MCP transport is fine but `GRAFANA_URL` is still
empty — see `docs/agent/pending-user-actions.md` §10.

### Client wiring

`~/.omp/agent/mcp.json` carries a `grafana` server entry with the endpoint and
all three headers inline (the file is mode 600). Values are literal rather than
`${VAR}` references so the server connects regardless of which shell launched
omp.
