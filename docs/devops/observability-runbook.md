# 可观测性与告警 Runbook（一页）

BRAWUKA-969。适用对象：CoffeeMode 值班人（当前只有 Owner）与 DevOps agent。
所有告警只在 Grafana Cloud 一处评估和路由；Cloudflare / Dokploy 不直接发通知。

## 1. 谁收告警

| 通道 | 接收人 | 说明 |
|---|---|---|
| `coffeemode-email`（email） | `lvzizhengde@gmail.com` | 人类值班通道。root policy 的 receiver，staging 24h 重复、prod 4h 重复。 |
| `coffeemode-autopilot`（webhook） | Multica `grafana-alert` autopilot | 自愈：自动建 `[AUTO-OPS] 运维告警自愈` issue 给 DevOps agent。所有 `team="coffeemode"` 告警并行投递（`continue: true`），不影响邮件。 |

路由树（`Alerting → Notification policies`，uid 见 Grafana）：

```
root → coffeemode-email            group_wait 30s, group_interval 5m, repeat 4h
├─ team="coffeemode" → coffeemode-autopilot   repeat 4h, continue: true
├─ env="staging"     → coffeemode-email       repeat 24h
├─ env="prod"        → coffeemode-email       repeat 4h
└─ env=""            → coffeemode-email       repeat 4h
```

规则本身不设 `notification_settings.receiver`，路由只在这一棵树里决定。

## 2. 收到告警后：5 分钟确认流程

1. **看哪条规则**：`Alerting → Alert rules`（<https://lyuzizheng.grafana.net/alerting/list>）。
   点规则看 instance 的 `route` / `env` 标签和当前值。
2. **看业务面**：
   - RED / 5xx / 延迟：`CoffeeMode — API RED`（<https://lyuzizheng.grafana.net/d/coffeemode-api-red>）
   - 5xx by route、auth 失败、图片上传失败、搜索降级、uptime：`CoffeeMode — Launch Health`
     （<https://lyuzizheng.grafana.net/d/coffeemode-launch-health>）
   - 限流：`CoffeeMode — Rate limits`（<https://lyuzizheng.grafana.net/d/coffeemode-rate-limits>）
   - 边缘 / Worker / 4xx5xx / DB：`CoffeeMode — Edge & Workers`
     （<https://lyuzizheng.grafana.net/d/coffeemode-workers-db>）
3. **看原始数据**：
   - 日志：`gcx logs query '{service_name="coffeemode-web", deployment_environment_name="staging"}' --since 30m`
     过滤 `| log_type="error"`、`| code="rate_limited"`、`| status=~"5.."`。
   - trace：`gcx traces query '{resource.service.name="coffeemode-web"}' --since 15m`。
   - uptime 探针：<https://probe.cafemood.app/status>（Access service token）。
4. **确认通知真的发出**：
   `gcx alert notification-history list --since 1h`，要求 `outcome: success`，`receiver` 是
   `coffeemode-email`（人）或 `coffeemode-autopilot`（自愈）。
5. **止血**：staging 先按 §3；prod 见 §4。修完把告警 instance 恢复观察 10 分钟。

## 3. staging 处置

- 5xx / 限流：先看 `Launch Health` 的 `route`，需要时 `SILENCE`（`Alerting → Silences`）限制在
  `env="staging"` 且带到期时间，不要静音 root。
- 回滚或重启：Dokploy → `coffeemode-web-staging` → Redeploy；数据库走
  `scripts/devops/restore.sh --env staging`。
- 验证恢复：`curl -sS -o /dev/null -w '%{http_code}' https://staging.cafemood.app/api/health` = 200。

## 4. prod 处置与回滚

prod 当前**未部署**（BRAWUKA-500），prod 规则在 `2026-10-29` 前被 silence `3b366013-9ef2-494a-9167-28534861e9c6`
（`env="prod"`，到点自动失效）。prod 部署后**先删除该 silence**，否则所有 prod 邮件被吞。

回滚：

```bash
# 只解析计划，不动系统（安全）
./scripts/devops/rollback-prod.sh --plan-only
# 演练：打印将执行的动作
./scripts/devops/rollback-prod.sh --dry-run
# 真回滚（需要 VPS 上的 backups/prod/releases.log 有边界）
./scripts/devops/rollback-prod.sh --yes
```

2026-10-26 本地 `--dry-run` 结果：`backups/prod/releases.log` 不存在 → 没有可解析的回滚边界
（prod 从未发布）。prod 首次发布后该演练才有意义，届时把输出贴回 BRAWUKA-500 / 本单。

## 5. 升级

1. 邮件到达后 30 分钟未处置 → 由 Owner 决定是否回滚（prod）或直接热修（staging）。
2. 自愈 autopilot 已自动开 issue；若 issue 里没有结论，DevOps agent 接手。
3. 需要产品/数据判断（例如搜索降级是上游配额还是代码）→ 升级给 Coffee Architect &
   Orchestrator（Multica agent）；迁移/数据损坏 → 升级给 Owner。
4. 付费/账号级问题（Cloudflare 套餐、Grafana 配额）只能 Owner 处理。

## 6. 规则与看板清单

| uid | 规则 | env | 备注 |
|---|---|---|---|
| `dfyxcvqotxjwgc` | 5xx sustained on a route (staging) | staging | A→reduce→threshold，>5/min 持续 3m（§7.1 实测 4m08s 内到邮件） |
| `ffyx58xman94wc` | 5xx sustained on a route (prod) | prod | 同上 `for: 3m`，prod 未部署 |
| `ffyxcvrixphxcb` | Rate-limit flood (staging) | staging | >50/min 持续 10m |
| `ffyx58xwrpxc0b` | Rate-limit flood (prod) | prod | >50/min 持续 10m |
| `afyx59iufl14we` | Worker upstream_error spike (prod) | prod | >3/min 持续 5m |
| `ffyxcvr6b7z0ga` | Worker upstream_error spike (staging) | staging | >3/min 持续 5m |
| `dfza5w8cynoxsd` | Search POI degraded rate | 派生 | 7d 比率 |
| `afza5w97twirke` | Search latency regression (p95) | 派生 | 7d 比率 |
| `ffza5w9gak4xsb` | Edge cache dead (hit rate 0) | 派生 | |
| `ffyx59j4rnwn4b` | Uptime probe failing | prod | Infinity 读 `/api/health`；502 时按 Error 触发 |
| `cfz754r541mgwd` | Uptime probe: heartbeat failing | prod | cron Worker 探针 |
| `ffz754rem5ptsf` | Uptime probe: canary-demo failing | prod | BRAWUKA-608 故意失败，不是故障 |

看板：`coffeemode-api-red`、`coffeemode-launch-health`、`coffeemode-rate-limits`、
`coffeemode-workers-db`（都在 Grafana 的 `CoffeeMode` 目录，`coffeemode-api-red` 在 General）。

## 7. 2026-10-26 验收记录（BRAWUKA-969）

- **测试邮件**：05:28 UTC 通过 `POST /apis/notifications.alerting.grafana.app/v1beta1/namespaces/stacks-1837787/receivers/{uid}/test`
  发送，返回 `{"status":"success","duration":"3s143ms"}`。收件确认由 Owner 在邮箱完成。
- **真实 5xx 事件**：staging `GET /api/search?q=%00`（NUL 字节 → Postgres
  `invalid byte sequence`），05:32:10–05:41:30 UTC 以约 12 次/分钟持续请求。
  - 规则 05:32:30 UTC 进入 pending，05:37:30 UTC firing（当时 `for: 5m`，已按 §7.1 收紧）。
  - 05:38:02 autopilot `success`；05:38:05 email `success`。
  - 05:43:02 autopilot `resolved`；05:43:04 email `resolved`。
- **规则修好前的错误**：6 条日志规则报
  `invalid format of evaluation results for the alert definition B: looks like time series data,
  only reduced data can be alerted on`；已改为 `A → B(reduce last) → C(threshold)`，并把 9 条
  规则的 `execErrState` 设为 `Alerting`，查询本身坏掉时会告警而不是静默。
- **遥测**：Tempo 有 `coffeemode-web` trace；`traces_spanmetrics_calls_total/latency` 带路由模板
  `span_name`；`coffeemode_cafe_created_total`、`coffeemode_auth_login_total` 可查；Loki 有
  staging 日志；两个 Dokploy app env 的 `OTEL_EXPORTER_OTLP_HEADERS` 存在且一致。
- **看板**：`CoffeeMode — Launch Health`（<https://lyuzizheng.grafana.net/d/coffeemode-launch-health>），
  8 个面板；2026-10-26 补 `DB pool connections (application pool)`（面板 8，见 §8），
  并把 auth 失败面板收紧为 `status="401"`（原先 `4xx` 会把 `forbidden_origin` 403 计入）。
- **备份失败告警**：本地 hook 收到
  `{"job":"postgres-backup","env":"prod","error":"backup exited 1",…}`；成功路径不发。
- **`rollback-prod.sh --dry-run`**：`backups/prod/releases.log` 不存在，无可回滚边界
  （prod 从未发布，见 §4）。

### 7.1 五分钟通知时限实测（2026-10-26 06:12–06:33 UTC）

**延迟预算（估算）** = 评估相位 δ（事件起点→下一次评估，0–60s）+ `for` + `group_wait` 30s
+ 邮件投递。邮件腿以 Grafana Cloud 返回 `success` 为终点，SMTP 实际入库时间未在本单测量
（Owner 收件确认仍是独立门禁），按正常秒级投递估算。因此 `for: 4m` 的估算上限为 5m35s，
无法硬性满足 5 分钟；`for: 3m` 的估算上限为 4m35s。

**探针实测（管道时序）**：staging 的 NUL 500 注入点已被 BRAWUKA-973 修掉，无法再制造
真实 5xx；A/B 用临时规则 `cmtimingprobe1`（日志信号
`log_type="warn" | status=403 | code="forbidden_origin"`）验证同一 notification policy、
同一 `group_wait` 下的进入→送达时序，与 5xx 规则同 `ruleGroup`、同 labels；验证后已删除。

| 运行 | `for` | 事件起点 | pending | firing | 邮件 firing（Grafana `success`） | 起点→邮件 | 结果 |
|---|---|---|---|---|---|---|---|
| A | 4m | 06:12:52 | 06:13:30 | 06:17:30 | 06:18:05 | 5m13s | 超时 |
| B | 3m | 06:23:57 | 06:24:30 | 06:27:30 | 06:28:04 | 4m08s | 达标 |

- 两次的 resolve 邮件都按 `group_interval: 5m` 在 firing 邮件后约 5 分钟发出
  （A：06:23:05；B：06:33:04 `resolved`）。
- **与真实 5xx 证据的区别**：上面的 05:32–05:43 记录是真实 5xx 的端到端证据（当次
  `for: 5m`，起点→邮件 5m55s，firing 与 resolve 双通道 `success`）；A/B 只校准通知时限，
  不是 5xx 复现。5xx 规则现已 `for: 3m`，同类真实事件的估算上限为 4m35s。

## 8. DB 连接池指标契约（BRAWUKA-976）

指标：`coffeemode.db.pool.connections` → Prometheus `coffeemode_db_pool_connections`。
一条 gauge、三个有界 `state`，由 `web/lib/observability/metrics.ts` 在 `getPool()` 创建
连接池时注册，复用同一个 OTel `MeterProvider` 与 OTLP 管道；不新增 exporter、凭据、
数据库 exporter 或采集器。

| state | 含义 |
| --- | --- |
| `active` | 应用池中已借出或正在建立的连接数（`totalCount - idleCount`） |
| `idle` | 空闲可复用的连接数 |
| `waiting` | 排队等待连接的请求数——不是新的已打开连接 |

**语义边界**：这是 `coffeemode-web` 进程自己的 `node-postgres` 连接池，不是 PostgreSQL
全服务器连接总数；数据库上还有 Supabase pooler、迁移、备份等其他客户端。

**无数据 ≠ 0**：进程尚未创建连接池（或未配置 OTLP endpoint）时没有数据点；连接池存在但
没有连接时输出三个 0。看板上的 "no data" 不能读成 0 连接。

**面板规格**（`CoffeeMode — Launch Health`，面板 id 8，由 Coffee DevOps 落地）：

- 标题 `DB pool connections (application pool)`，类型 time series。
- 查询：`sum by (state) (coffeemode_db_pool_connections{deployment_environment_name="$env"})`
- Legend `{{state}}`；单位 `short`；description 写明 waiting 是排队请求，不是额外连接。
- 环境沿用看板变量 `$env`（`staging` / `production`）。

**本地验证**：`web/tests/integration/db-pool-metrics.integration.test.ts` 用真实 Postgres
证明 idle → 占用 → 排队 → idle 的计数，以及无数据与实测 0 的区别。

**staging 证据（2026-10-26 06:44 UTC，`6a76485c` 部署后）**：`coffeemode_db_pool_connections`
出现三条 series（`state=active|idle|waiting`，`deployment_environment_name="staging"`），
空载时均为实测 0；`Launch Health` 面板 id 8 的 PromQL 在 `$env=staging` 返回三值。

## 9. 已知缺口（不是告警噪音）

- **Cloudflare WAF / AI 爬虫比例无法从本机读取**：当前 wrangler OAuth token 只有 `zone:read`，
  GraphQL `firewallEventsAdaptiveGroups` 与 ruleset 读取都返回 authz 错误。要观测
  BRAWUKA-967 的 block/challenge 比例，需要 Owner 给一个带
  `Zone Analytics: Read` + `Zone WAF: Read` 的 API token，或在 Dashboard 里看。
  已知规则：`BRAWUKA-966` 已合入 AI 爬虫拒绝规则，不能用 `cf.client.bot` 一刀切。
- **prod 每日备份告警已接线，等 prod 部署生效**：`scripts/devops/backup.sh` 在非零退出时把
  `{"job":"postgres-backup",...}` POST 到 `MULTICA_AUTOPILOT_WEBHOOK_URL`（未设置时静默跳过；
  成功路径不发）。prod 的 Dokploy 定时任务目前随 `coffeemode-web-prod` 一起未部署
  （BRAWUKA-500），部署时把备份 cron 挂上去即可，无需再改脚本。
- **`/api/search` 的 NUL 500 已由 BRAWUKA-973 修复**：`validateSearchQuery` 拒绝 `\p{Cc}`，
  staging 现返回 400 `q must not contain control characters`。该 500 曾是 5xx 规则的压测源；
  后续需要注入 5xx 时需另找入口（或经授权用 staging 测试会话）。
