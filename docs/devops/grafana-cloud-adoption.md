# Grafana Cloud 采用与迁移评审

Stack 已经授权可用（BRAWUKA-604），但**数据面是空的**。这份文档盘点现状、划清 Cloudflare 与 Grafana 的分工边界，并给出**直接切换、全量删除 Better Stack** 的迁移方案。

## 0. 结论先行

1. **分工原则：Cloudflare 管边缘，Grafana 管应用。** 边缘能免费拿到的（前端 RUM、Worker 日志、流量/安全分析）不要重复建设；边缘拿不到的（应用日志聚合、traces、应用告警、跨信号关联）才上 Grafana。
2. **最高杠杆的一步是在 VPS 上跑 Alloy。** 应用已经在往 stdout 打单行 JSON（`web/lib/observability/server-log.ts`），但没有任何东西收它 —— 日志只活在容器里。零代码改动就能接进 Loki。
3. **第二高杠杆是给 Next.js 加 OpenTelemetry。** 一次埋点同时换来 traces、service map、RED 指标（`traces_spanmetrics_*` 由 metrics-generator 自动生成）和 exemplar。
4. **直接切，全删 Better Stack。** 但顺序必须是「先在 Grafana 建好、验证通过、再删 Better Stack」，否则告警面出现空窗。
5. **rate-limit 保留逐条日志**，带 `client_id`（`user:<uuid>` / `anon:<ip-hash>`）、`request_id`、`route`、`bucket`。这要求去掉现有的 10s 节流。

## 1. 现状盘点

### 1.1 Grafana Cloud 侧

| 项 | 值 |
|---|---|
| Stack | `lyuzizheng`，区域 `ap-southeast-1`（新加坡） |
| Grafana 版本 | v13.3.0 |
| 版本档位 | **Cloud Free** |
| MCP 身份 | `brabalawuka` / lvzizhengde@gmail.com，Main Org. Admin |
| 数据源 | 12 个，全部就绪 |
| **应用数据** | **无** |
| 告警规则 | 0 |
| CoffeeMode dashboard | 0 |

空栈的证据：Loki `label names` 返回 `[]`；Tempo 只有 intrinsic scope，没有任何 resource/span 属性；Prometheus 查不到任何非 `grafanacloud_*` 的 series；`/api/v1/provisioning/alert-rules` 返回 `[]`。

### 1.2 Better Stack 侧（待删除）

| 类型 | 内容 |
|---|---|
| 日志 source | `coffeemode-rate-limit-staging` (2766431)、`coffeemode-rate-limit-prod` (2766432) |
| Dashboard | `CoffeeMode API Errors (staging)` (1131239)、`CoffeeMode API Errors (prod)` (1131240) |
| Chart alert | 4 条 enabled：`5xx sustained on a route`、`Worker upstream_error spike`（staging / prod 各一套） |
| Uptime monitor | `coffeemood.com`（status 类型） |
| Heartbeat | 无 |
| Status page | 无 |

### 1.3 应用侧

| 组件 | 现状 |
|---|---|
| `web/lib/observability/server-log.ts` | 输出单行 JSON（`{"type":"error","request_id":…}`）到 stdout。**没人收。** |
| `web/lib/observability/rate-limit-alert.ts` | 限流命中时 `console.warn`（10s 节流）+ fire-and-forget POST 到 Better Stack（**不**节流） |
| `web/lib/rate-limit.ts` | `getClientIdentifier()` → `user:<uuid>` 或 `anon:<sha256(cf-connecting-ip)[:32]>` |
| `/api/health` | `{ok, version, boot_time}` |
| `/api/heartbeat` | 真实 DB round-trip，Better Stack 轮询它 |
| `poi-service` / `image-service` | `console.error` + wrangler `[observability]`（数据留在 Cloudflare 侧） |
| `scripts/devops/smoke-test.sh` | 10 条部署后契约，bash + curl，手动跑 |
| OTel / Sentry / prom-client / Faro | **都没有** |

## 2. 分工原则：Cloudflare 管边缘，Grafana 管应用

### 2.1 Cloudflare 免费档实测能做什么

zone `cafemood.app` 是 **Free Website** 计划。实测结果：

| 能力 | 免费档 | 实测状态 |
|---|---|---|
| **Web Analytics (RUM)** | ✅ 免费无限 | **已自动安装 3 个站点**（`auto_install: true`，其中一个建于 2026-09-14） |
| **Workers Logs + Query Builder** | ✅ 200k 事件/天，**3 天保留** | `poi-service-prod` 已开启（`logs.enabled`、`persist`、`invocation_logs`、`head_sampling_rate: 1`） |
| **Notifications** | ✅ 免费 | 3 条默认策略；可用类型含 Traffic Monitoring、Workers Observability、Tunnel、SSL/TLS、DoS Protection、Security Insights、Script Monitor、Web Analytics |
| **GraphQL Analytics API** | ✅ 免费 | 可用（旧的 Zone Analytics REST API 已 sunset） |
| **Security Events / Analytics** | ✅ 免费 | 手动查看（`docs/devops/security-observability.md` 的清单） |
| **Health Checks（uptime）** | ❌ **要 Pro** | 0 条配置；文档明确 Free = No，Pro = 10 条 |
| **Logpush（zone 级）** | ❌ **要 Enterprise** | 0 个 job |
| **Workers Logpush** | ❌ **要 Workers Paid** | 未启用 |

### 2.2 边界表

| 需求 | 用谁 | 理由 |
|---|---|---|
| 前端 Core Web Vitals / 页面浏览 / 来源 | **Cloudflare Web Analytics** | 免费无限，已自动装好，零代码。Faro 的 50k sessions/月 先留着不用 |
| Worker 日志（poi / image service） | **Cloudflare Workers Logs** | 已开启，免费 200k/天。3 天保留够排障；要长期留存再考虑进 Loki |
| 边缘流量 / 安全事件分析 | **Cloudflare GraphQL Analytics** | 免费，数据本来就在边缘 |
| 边缘类告警（Tunnel 断、SSL 到期、DoS、Worker 错误率） | **Cloudflare Notifications** | 免费，离事件源最近 |
| **网站 uptime 探测** | **Grafana Synthetic Monitoring** | Cloudflare Health Checks 要 Pro；SM 免费 100k 次/月且多区域 |
| **应用日志聚合**（`server-log.ts` 的 error/warn、rate-limit） | **Grafana Loki** | Cloudflare 拿不到容器 stdout；Logpush 要 Enterprise |
| **Traces / service map / RED 指标** | **Grafana Tempo + Mimir** | Cloudflare 没有应用侧 tracing |
| **应用告警**（5xx、限流、DB） | **Grafana Alerting** | 需要跨日志/指标/trace 关联 |
| **Dashboard** | **Grafana** | 一个面板同时查 Loki + Prometheus + Tempo |

一句话：**Cloudflare 能免费给的，不要用 Grafana 重做；Cloudflare 拿不到的（容器日志、traces、跨信号关联），才上 Grafana。**

## 3. Grafana Cloud 能力清单

按账单维度整理（数据来自 stack 的 Billing/Usage dashboard 与 grafana.com/pricing）。

| 能力 | 计费维度 | 免费档额度 | 对 CoffeeMode 的价值 | 建议 |
|---|---|---|---|---|
| **Metrics** (Mimir) | billable series | 10k series / 14d | 高 —— RED、业务计数 | 做 |
| **Logs** (Loki) | GB ingested | 50 GB / 14d | 高 —— 应用已有 JSON 日志 | 做 |
| **Traces** (Tempo) | GB ingested | 50 GB / 14d | 高 —— 顺带产出 RED + service map | 做 |
| **Synthetic Monitoring** | test executions | 100k API + 10k browser / 月 | 高 —— 替代 uptime monitor | 做 |
| **Grafana Alerting** | 免费 | — | 高 —— 替代 4 条 chart alert | 做 |
| **Dashboards** | 免费（1,000 上限） | — | 高 —— 替代 2 个 Better Stack dashboard | 做 |
| **Application Observability** | host hours | 2,232 host hours | 高 —— 随 traces 自动生效 | 做（被动） |
| **k6** | VUh | 500 VUh | 中 —— 发布前压测 | 做（小规模） |
| **Frontend Observability** (Faro) | sessions | 50k sessions / 月 | 中 —— **Cloudflare Web Analytics 已覆盖大部分** | **缓**（见 §2.2） |
| **IRM / OnCall** | active users | 3 users | 中 —— 现在只有一个人 | 缓 |
| **Database Observability** | host hours | 2,232 host hours | 中 —— PostGIS 慢查询 | 缓 |
| **Profiles** (Pyroscope) | GB ingested | 50 GB / 14d | 低 —— 没有明确的 CPU/内存问题 | 缓 |
| **Grafana Assistant** | tokens | 40M/用户 + 25M 系统池 | 中 —— MCP 已经在用 | 已可用 |
| **Kubernetes Monitoring** | host/container hours | 2,232 + 37,944 | 无 —— Dokploy 是单机 Docker | 不做 |
| **Adaptive Metrics / Traces** | 省成本 | — | 低 —— 量太小，省不出钱 | 不做 |
| **Knowledge Graph / Sift** | — | — | 低 —— 需要更多数据才有意义 | 不做 |

### 免费档硬约束

- **14 天保留期**（metrics / logs / traces / profiles / k6）。Better Stack 现在是 3 天（logs），所以是改善，但别指望季度对比。
- **10k active series**。`traces_spanmetrics_*` 会按 route × status × service 展开，路由多的话要盯着。
- **3 个 Grafana 活跃用户**、**3 个 IRM 活跃用户**。
- **MCP 连接算 Assistant 活跃用户**，会消耗 40M token 配额。

### 接入端点（区域 ap-southeast-1）

| 信号 | 端点 | instance ID |
|---|---|---|
| Metrics (remote_write) | `https://prometheus-prod-37-prod-ap-southeast-1.grafana.net/api/prom/push` | 3599798 |
| Logs (Loki push) | `https://logs-prod-020.grafana.net/loki/api/v1/push` | 1795570 |
| Traces (Tempo) | `https://tempo-prod-14-prod-ap-southeast-1.grafana.net/tempo` | 1789871 |
| OTLP (all signals) | `https://otlp-gateway-prod-ap-southeast-1.grafana.net/otlp` | — |

四个端点都已探测：未认证请求返回 401，说明在线且只等凭据。

## 4. 迁移方案：直接切，全删 Better Stack

### 4.1 切换顺序（关键）

**不能先删后建。** 正确顺序：

1. Alloy 上 VPS → Loki 有日志。
2. OTel 进 Next.js → Tempo 有 traces，spanmetrics 产出 RED。
3. 在 Grafana 建好 4 条告警规则 + 3 个 dashboard + Synthetic checks。
4. **验证**：制造一次真实的 5xx / 限流，确认 Grafana 侧告警真的响。
5. 改应用：删掉 `BETTER_STACK_INGEST_URL` / `BETTER_STACK_INGEST_TOKEN`，`rate-limit-alert.ts` 改为纯 stdout 输出。
6. 删 Better Stack：2 个 source、2 个 dashboard、4 条 chart alert、1 个 monitor。
7. 更新 `docs/devops/security-observability.md` 与 `docs/agent/pending-user-actions.md`。

### 4.2 P0 — 让数据进来

#### P0-1 Logs：VPS 上跑 Alloy → Loki

**为什么**：应用已经在打 JSON 行，只差一个采集器。这是投入产出比最高的一步。

**怎么做**：Dokploy 加一个 Alloy 容器（compose，`grafana/alloy` 镜像）：

- `discovery.docker` 发现容器，`loki.source.docker` 读 stdout。
- `loki.process` 解析 JSON，把 `level`、`route`、`request_id`、`type`、`event` 提出来。
- `loki.write` 推到 `https://logs-prod-020.grafana.net/loki/api/v1/push`，Basic auth = instance ID + API token。

**标签纪律**（免费档 5,000 active streams 上限）：

- label 只留 `env`、`service`、`container`、`level`。
- `request_id`、`route`、`client_id`、`user_id` 一律进 structured metadata，**不能**做 label —— 否则 stream 数爆炸。

**先过滤再发**：Next.js 的请求日志量最大，先只收 `web` 容器 + `level != "debug"`，观察一周配额再放开。

#### P0-2 Traces：Next.js 加 OpenTelemetry → Tempo

**为什么**：一次埋点换来四样东西 —— traces、service map、RED 指标、exemplar。不用手写 Prometheus 客户端。

**怎么做**：

- Next.js 用 `@vercel/otel`（官方推荐，和 App Router 兼容）或 `@opentelemetry/sdk-node` + `instrumentation.ts`。
- `OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-prod-ap-southeast-1.grafana.net/otlp`，Basic auth = instance ID + token。
- `OTEL_RESOURCE_ATTRIBUTES=service.name=coffeemode-web,deployment.environment=staging|prod`。

**采样**：见 §5。起步 10%。

#### P0-3 Metrics：先靠 spanmetrics，再补业务指标

不要急着上 `prom-client`。spanmetrics 已经给出每个 route 的 rate / error / duration。

需要额外补的（用 OTLP metrics 或 Alloy 的 `prometheus.exporter`）：

- rate-limit 命中计数（counter，按 `bucket` 分）。
- Postgres 连接池（活跃 / 空闲 / 等待）。
- Cloudflare Worker 调用延迟与错误（从 web 侧观测，Worker 侧数据留在 CF）。

### 4.3 P1 — 替代 Better Stack

#### P1-1 Synthetic Monitoring 替代 uptime monitor

现在只有 Better Stack 一个 `coffeemood.com` status monitor。Cloudflare Health Checks 在免费档不可用，所以这块必须用 Grafana。

目标：

- HTTP check 覆盖 `/api/health`、`/api/heartbeat`、`/`，从多个 probe region 跑。
- 一个 scripted check 覆盖搜索主流程 —— 把 `scripts/devops/smoke-test.sh` 的 10 条契约里挑核心几条改写成 k6。
- 断言必须让 `probe_success` **真的失败**：用 `expect()` / `fail()`，不是裸 `check()`。裸 `check()` 只记结果不改 `probe_success`，告警永远不响。
- 附带收益：TLS 证书到期告警。

**配额**：3 个 check × 3 region × 1 分钟 = 388k 次/月，**超免费档 100k**。间隔放宽到 5 分钟 ≈ 77,760 次/月。

#### P1-2 Grafana Alerting 替代 4 条 chart alert

现在 Better Stack 有 `5xx sustained on a route` 和 `Worker upstream_error spike`，staging / prod 各一套。

目标：Grafana-managed alert rules，数据源用 Loki（日志派生）或 spanmetrics（trace 派生）。

- 通知先接 Slack / 邮件 contact point。
- notification policy 按 `env` label 分流，staging 低优先级。
- 保留 `for:` 窗口避免抖动。

#### P1-3 Dashboards 替代 2 个 Better Stack dashboard

- `CoffeeMode — API RED`：一个 dashboard，`env` 变量切换 staging/prod。
- `CoffeeMode — Rate limits`：命中分布、top bucket、top client。
- `CoffeeMode — Edge & Workers`：Cloudflare 侧的错误与延迟（数据从 GraphQL Analytics 或 Worker 侧来）。

### 4.4 P2 — 新增能力

| 项 | 理由 | 备注 |
|---|---|---|
| **k6** | 发布前压测 `/api/search` | 500 VUh 够 smoke + 小规模 load |
| **Database Observability** | PostGIS 空间查询慢的时候需要 `pg_stat_statements` | 需要 Supabase 侧开扩展 + 建监控用户 |
| **IRM / OnCall** | 3 个免费用户 | 现在一个人，Alerting + Slack 就够，等有轮值再上 |
| **Faro** | 只在需要 session replay 或浏览器→后端 trace 关联时再开 | Cloudflare Web Analytics 已覆盖 CWV 与页面分析 |

### 4.5 不建议现在做

- **Kubernetes Monitoring** —— 没有 K8s，Dokploy 是单机 Docker。硬套只会产生噪音。
- **Adaptive Metrics / Adaptive Traces** —— 量太小，省不出钱，反而多一层配置。
- **Profiles** —— 没有明确的 CPU / 内存问题要查。等有具体性能问题再开。
- **Knowledge Graph / Sift** —— 需要更多数据才有意义。

## 5. OTel 采样率是采样什么

**采样的是 trace（请求链路），不是日志、不是指标。**

一次用户请求 = 一条 trace，trace 由多个 span 组成（HTTP 入口 → 路由处理 → DB 查询 → 外部调用）。采样率决定**百分之多少的请求会被完整记录并上传到 Tempo**。

- `parentbased_traceidratio = 0.1` → 每 10 个请求记 1 条完整 trace。
- 采样是**整条链路一致**的：入口决定采不采，下游服务跟随（`parentbased`），所以不会出现「只有半条 trace」。
- **不采样的请求不会进 Tempo**，因此也不会产生对应的 spanmetrics —— 但 spanmetrics 是**按采样后的 span 统计**的，10% 采样下 RED 指标的**比例**（错误率、P95）依然准确，只是**绝对量**要乘 10。

**为什么需要采样**：免费档 traces 只有 50 GB / 月。全量记录每个请求的每条 span 会很快吃满。

**建议**：

- 起步 `parentbased_traceidratio = 0.1`（10%）。
- **错误请求强制采样**：加一个 `parentbased_always_on` 的尾部规则，或者用 Grafana Cloud 的 Adaptive Traces 做尾部采样（免费档量小，先手动）。
- 观察一周 `grafanacloud_traces_instance_bytes_received_per_second`，再决定升到 100% 还是降到 1%。

**和日志的区别**：日志不采样（`server-log.ts` 的每一行都进 Loki），所以错误排查时日志是完整的，trace 是抽样的。两者通过 `trace_id` / `request_id` 关联。

## 6. rate-limit 事件：保留逐条日志

**决定：保留逐条日志，带关键 IP / 用户信息。**

### 现状问题

`emitRateLimitAlert` 现在有两条路径，节流不一致：

- `console.warn` —— **10s 节流**（`EMIT_THROTTLE_MS`），只用于本地/Cloudflare 日志。
- Better Stack POST —— **不节流**，每条都发。

如果改成「靠 Alloy 收 stdout」，10s 节流会让事件数**大幅变少**（突发限流时 10 秒内的几十条只剩 1 条）。所以迁移时必须**去掉节流**。

### 目标事件形状

```json
{
  "type": "rate_limit",
  "level": "warn",
  "event": "rate_limited",
  "request_id": "…",
  "route": "GET /api/search",
  "bucket": "search",
  "client_id": "anon:1606d3de…",
  "user_id": null,
  "window_ms": 60000,
  "max_requests": 30,
  "retry_after": 0.5,
  "ts": "2026-09-21T02:47:31.672Z"
}
```

### 关于 IP 与用户信息

`getClientIdentifier()` 已经给出关键身份，**不需要额外记录原始 IP**：

- 已登录 → `user:<uuid>`，同时单独出 `user_id` 字段便于查询。
- 匿名 → `anon:<sha256(cf-connecting-ip)[:32]>`。

**为什么是哈希而不是原始 IP**：这是 BRAWUKA-282 P1-2 的刻意设计 —— 原始 IP 只在 `cf-connecting-ip` 上可信，且直接落库会引入隐私面。哈希足够做「同一客户端重复命中」的聚合，又不留原始地址。**如果确实需要原始 IP，那是一个独立的隐私决策，不在本次迁移范围内。**

### 实现要点

1. `rate-limit-alert.ts` 去掉 `shouldEmit` 节流，每条都 `console.warn` 一行 JSON（和 `server-log.ts` 同形状）。
2. 删掉 `betterStackUrl()` / `betterStackToken()` 与整个 POST 分支。
3. 删掉 `BETTER_STACK_INGEST_URL` / `BETTER_STACK_INGEST_TOKEN` 环境变量（Dokploy staging + prod）。
4. 保留 `_resetAlertThrottleForTests` 的删除或改写（节流没了，测试要跟着改）。
5. 同时补一个 **counter 指标**（`rate_limit_denied_total{bucket,route}`）—— 日志给细节，counter 给趋势和告警，两者不冲突。

### 量级控制

限流事件本身被限流器约束（一个 bucket 在窗口内最多拒绝到边缘规则上限），但突发时仍可能一次几十条。Alloy 侧加一条 `loki.process` 规则：`client_id` 进 structured metadata，不进 label，避免 stream 爆炸。

## 7. 风险与注意

1. **免费档配额**：50 GB logs / 50 GB traces / 10k series / 14 天保留。Alloy 全量收 Docker stdout 会吃掉 logs 配额 —— 先只收 `web` 容器并丢 debug。
2. **切换空窗**：直接切意味着没有双写兜底。必须先在 Grafana 侧验证告警真的会响，再删 Better Stack（§4.1 的顺序）。
3. **rate-limit 节流**：见 §6 —— 不去掉节流会丢事件。
4. **标签基数**：Loki 只留低基数 label；Prometheus 不要用 `client_id`、`request_id` 做 label（`route` 在 spanmetrics 里是受控集合，可以）。
5. **MCP 计费**：Grafana 把每个通过 MCP 连接的用户算作 Assistant 活跃用户，消耗 40M token 配额。
6. **Synthetic 配额**：3 个 check × 3 region × 1 分钟 = 388k 次/月，超免费档。间隔要放宽到 5 分钟。
7. **Cloudflare 免费档天花板**：Health Checks 要 Pro、Logpush 要 Enterprise。如果以后需要边缘日志长期留存或边缘 uptime 探测，要么升 Cloudflare 计划，要么继续用 Grafana 侧方案。

## 8. 待办清单

- [ ] Alloy 容器上 Dokploy（compose），接 Loki。
- [ ] Next.js 加 OTel，接 Tempo，采样 10%。
- [ ] 建 3 个 Grafana dashboard。
- [ ] 建 4 条 Grafana 告警规则（替代 Better Stack chart alerts）。
- [ ] 建 Synthetic checks（3 个 HTTP + 1 个 scripted，5 分钟间隔）。
- [ ] 验证告警真的会响（制造一次 5xx / 限流）。
- [ ] 改 `rate-limit-alert.ts`：去节流、去 Better Stack、加 `user_id`、加 counter。
- [ ] 删 Dokploy 的 `BETTER_STACK_INGEST_*` 环境变量（staging + prod）。
- [ ] 删 Better Stack：2 source、2 dashboard、4 chart alert、1 monitor。
- [ ] 更新 `docs/devops/security-observability.md`（Better Stack 段落改为 Grafana）。
- [ ] 更新 `docs/agent/pending-user-actions.md` §7。
