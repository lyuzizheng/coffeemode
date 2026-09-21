# MCP Servers Runbook

Agent-facing MCP servers for CoffeeMode. Grafana is consumed as a hosted
service; only `dokploy-mcp` still runs on the Dokploy VPS.

| Server | Where it runs | Endpoint | Auth |
|---|---|---|---|
| `grafana` | Grafana Cloud (hosted) | `https://mcp.grafana.com/mcp` | OAuth 2.1 (dynamic client registration) |
| `dokploy-mcp` | Dokploy VPS (compose) | `http://192.168.5.103:3005/mcp` | none — LAN only |

`dokploy-mcp` has no auth of its own: any device on the LAN can drive the
Dokploy API through it. Accepted for now (the VPS LAN is trusted), but it is a
known exposure — if that assumption stops holding, front it with Cloudflare
Access or a firewall rule.

## grafana — Grafana Cloud MCP (official)

Gives agents read/write access to the Grafana Cloud stack: dashboards, alert
rules, datasources, PromQL/LogQL queries, incidents. Hosted by Grafana at
`https://mcp.grafana.com/mcp`; nothing to deploy or patch.

### Why not self-hosted

BRAWUKA-600 deployed `grafana/mcp-grafana:1.5.1` in Dokploy behind Cloudflare
Access at `https://mcp.cafemood.app/mcp`. It worked, but it needed three
credentials to be minted and rotated by hand (Access service token, caller
bearer token, Grafana service account token) and it still could not talk to
anything until a Grafana Cloud stack existed. The official endpoint replaces
all of that with one OAuth consent, so the self-hosted app, its DNS record,
tunnel ingress rule, Access app and service token were all torn down on
2026-09-21.

### Prerequisites

- A hosted Grafana Cloud stack (`https://<stack>.grafana.net`). The free tier
  is enough. Self-hosted Grafana is **not** supported by this endpoint.
- The `Assistant Cloud MCP User` role on that stack — Editor or higher has it
  by default.
- Billing: Grafana counts each user who connects over MCP as an active Grafana
  Assistant user.

### OAuth shape

The server advertises its own authorization server; clients register
themselves dynamically, so no client ID or secret is provisioned by hand.

| | |
|---|---|
| Protected resource metadata | `https://mcp.grafana.com/.well-known/oauth-protected-resource/mcp` |
| Authorization server metadata | `https://mcp.grafana.com/.well-known/oauth-authorization-server/mcp` |
| Registration | `https://mcp.grafana.com/mcp/oauth/register` |
| Authorize / token | `https://mcp.grafana.com/mcp/oauth/authorize` · `/oauth/token` |
| PKCE | `S256` |
| Scopes | `grafana:read`, `grafana:query`, `grafana:write` |

During consent you enter the stack URL and pick read or read+write access.

### Client wiring

**omp** — `~/.omp/agent/mcp.json` carries a bare `grafana` entry; omp discovers
the metadata above and runs the browser flow on first connect:

```json
"grafana": { "type": "http", "url": "https://mcp.grafana.com/mcp", "timeout": 120000 }
```

**Hermes** — installed from the catalog (`hermes mcp install grafana`), which
writes `mcp_servers.grafana` in `~/.hermes/config.yaml` with `auth: oauth` and
excludes `ask_assistant` / `agento11y_*`. Authorize with
`hermes mcp login grafana`.

### Verifying

```bash
# unauthenticated POST must be 401 with a resource_metadata pointer
curl -s -D - -o /dev/null -X POST https://mcp.grafana.com/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}' \
  | grep -i '^www-authenticate'
```

A `401` means the endpoint is up and waiting for OAuth — not an outage. Once
authorized, `tools/list` in an agent session is the real check.

### Troubleshooting

- **`401` after authorizing** — the token is bound to one stack. Re-run the
  consent flow and enter the stack URL again.
- **`403` / role error** — the Grafana user lacks `Assistant Cloud MCP User`.
- **Tools missing in a session** — omp and Hermes both load MCP servers at
  session start; restart the session after authorizing.
