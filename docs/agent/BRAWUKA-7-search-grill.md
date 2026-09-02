# BRAWUKA-7 / #135 统一无地图搜索 — Design Grill 决议与落地计划

> Explorer & Advisor — 2026-09-01 — 基于 15 题 grill + Owner 逐条批复
> 关联切片: `search-filters` (COMPLETE) 与 `map-discovery-integration` (BLOCKED, #134)
> 验收来源: GitHub #135, `docs/specs/0004:114,123-133`, `docs/specs/0001 §Search`, `docs/design/search-filters-v1.md` DG44-DG58/DG125-DG130

## Owner 已确认决议 (DG131-DG145)

| ID | 对应 Q | 决议 | 配置/代码锚点 |
|---|---|---|---|
| DG131 | Q1 | **B + 低分截断** — 结果分组：`coffeemode` 组在前，`stored_poi/google/apple` 组在后；组内 `relevance 100/80/50/10 → distance → name → id`。`secondaryMatch(10)` 仅在无更高分命中时保留，否则过滤。 | `app.yaml:search.minRelevanceScore` (新增) + `web/lib/search/search-service.ts:scoreRelevance` |
| DG132 | Q2 | **A** — 仅 `include_live=true` 时调计费的 Google live；弱结果 `total<3` (DG49) 时才出现 CTA `搜 Google / 搜 Apple`。 | `web/lib/search/search-service.ts:168-192` 已实现，补响应头 `X-Search-Mode: stored_only` |
| DG133 | Q3 | **B** — POI 失败降级：仍 200 返回自有店 + `warnings:["poi_unavailable"]`，UI 行内 `外部搜索暂不可用 + 重试`。 | `SearchResponse` 新增可选 `warnings` |
| DG134 | Q4 | **A + 开关** — 仅精确 `place_id` 去重；Apple/Google 做成开关 `app.yaml:search.externalSources{google,apple}` 控制前后端显隐，为后续展示 Apple 搜索预留。 | `app.yaml` + `search-service` 过滤 |
| DG135 | Q5 | **A，预留 C** — MVP 保持 `defaultSuggestionLimit=10 / maxSuggestionLimit=10`；C(`结果视图放宽至 50`) 为 follow-up，当 `total_count>results.length` 占比>20% 时切。 | `app.yaml:search` |
| DG136 | Q6 | **A+B 做成设置项** — 两种排序：A 相关度优先 / B 相关度+好店加成(+10封顶)。`app.yaml:search.rankingMode` + onboarding/设置让用户自选“探索好店 / 找最近的店”。 | `app.yaml:search.rankingMode` |
| DG137 | Q7 | **B→C** — VPS 内存大，B 先上(`TanStack 30s + 服务端 private,max-age=10,stale-while-revalidate=30`)，C 随后加 KV/内存边缘缓存 `city:q:filtersHash` 60s。 | `web/app/api/search` Cache-Control |
| DG138 | Q8 | **C** — 有 `lat/lng` 用用户距，无则用 `effectiveCity` 中心距且标 `距市中心`(DG58)。 | `resolveReferencePoint` + `DG128` 链路 |
| DG139 | Q9 | **确认加上** — `SearchResultItem.poi:{place_id,source,lat,lng,...}` 必须随 Top-10 完整携带，切片不裁；创建流凭此做 409 去重。新增测试“选中→创建 payload 必含 place_id”。 | `web/lib/search/types.ts:SearchResultItem` |
| DG140 | Q10 | **备选** — 确定性 fixtures `web/tests/fixtures/search-fixtures.json` + dev 仅 `?fixtures=1` 作为**备选挂载方案**；**完整 metric/可观测性方案另起设计**（见下）。 | `web/tests/fixtures/` |
| DG141 | Q11 | **B+C** — 契约：初载 4 行骨架、空 `No places match…+Reset`、错保留旧列表+重试、离线禁用外部按钮、限流 429 带 `Retry-After`；补 3 测试缺口。 | `web/tests/search/*` |
| DG142 | Q12 | **A** — `name` 相同再比 `id`，消除 `localeCompare` flaky。 | `search-service.ts:sort` |
| DG143 | Q13 | **A** — `/api/search` 不做 Apple live 扇出，仅已 `POST /api/places/external` 入库的 Apple POI 可出现；按钮受 `NEXT_PUBLIC_MAPKIT_CONFIGURED` 门控。 | `pending-user-actions.md` |
| DG144 | Q14 | **A** — live 全量展示，仅持久化 food/cafe(DG52)；非餐饮 live 加观测字段 `not_persisted_reason`。 | `poi-service` |
| DG145 | Q15 | **分阶段：A→B→C** — MVP 保持 A(10批×100 early-stop)+打点；命中 `batches==10 && filtered<limit` 先上 B(300ms 预算 + `warnings:["open_now_truncated"]`)；C(`hours_json→tsrange` GIST) 另起 migration issue，需 integration gate。 | `search-service.ts` |

## 对“不依赖地图”的澄清

- **UI 在地图上方**，但**实现与运行不依赖 MapKit JS**：`GET /api/search` 只查 Postgres + D1/KV，`poi-service/src/handlers.ts:217-332` 的 haversine 在 Worker 内完成；`search-filters-v1.md §3` 的 overlay/sidebar 均不持有 `map` 对象。后续 `map-discovery-integration` 仅把已有 `SearchResultItem[]` 叠到 marker。详见 `docs/specs/0004` 对 `search-filters` 与 `map-discovery-integration` 的拆分与 `map-home BLOCKED(#131)` 注释。

## Q10 备选与 metric 完整方案 — 说明

- **Q10 定位**：`fixtures` 为**备选挂载方案**（便于 `theme-preview`/visual-smoke/CI 无真实 DB 时验收），不作为主链路；按 Owner 意见**暂不以它替代真实度量**。
- **Metric 完整方案未就绪**：搜索可观测性（`search.open_now.batches`、`total_count>results.length` 占比、POI 降级率、`X-Search-Mode`、Q7 边缘缓存命中率等）的**指标口径、采集链路、告警阈值、看板**尚未统一设计（涉及 `docs/specs/0003` 的 testing/observability 与未来 Better Stack 集成 DG129）。本 grill 仅在 Q7/Q15 预留埋点位，**不展开完整 metric 设计**；建议另起拟新增的搜索可观测性设计文档（metrics-search-observability）或 ADR，由 Reviewer & Architect 牵头补齐后再进入 C 阶段。

## 分阶段落地计划（供 Reviewer 审，已按 15:59 深审裁决更新）

1. **Stage 1（本 PR，直达 Reviewer 复验）**：DG131(条件截断 minRelevanceScore=50，空 q 不截) + DG133(warnings) + DG134(开关 externalSources) + DG136(rankingMode localStorage+?ranking=) + DG139(测试) + DG142(id 兜底) — 均 `app.yaml` + `search-service/types` + `route`，已落码；契约已折入 `docs/specs/0001 §Search`，DG 编号保留。
2. **Stage 2**：DG137 B 缓存（`Cache-Control: private,max-age=10`）+ DG141 补 3 用例 + DG140 fixtures 双门控文件 + **P1 补齐** DG144(food/cafe 过滤)+DG132 头 `X-Search-Mode`+DG138 距市中心快照测试（原孤儿决议，现并入 Stage 2）。
3. **Stage 3（另起 issue）**：DG137 C 边缘缓存 与 DG145 C (`open_now` 推 SQL + migration 0016 — 0015 已被占用) — 需真实 PostGIS integration 验证 `isOpenAt` 与 SQL 一致性；metric 5字段最小埋点随 Stage 2 冻结，看板/告警由 Reviewer 另起 ADR。

> **P2 已纠正**：`implementation-slices.md` search-filters 行补 Q5-C/Q15-C follow-up 占位；`docs/design/search-filters-v1.md` 追加 DG131-145 附录（治理归位）。

- 分组 + 低分截断是否会误伤 `q` 为空的浏览态（建议空 `q` 时绕过截断）；
- `rankingMode` 用户设置的存储位（`profiles` vs `localStorage` + 匿名态）与 `onboarding` 文案；
- `warnings` 与 `not_persisted_reason` 的 API 形状是否需纳入 `docs/specs/0001 §Search` 的 `SearchResponse` 契约；
- Q10 fixtures 的 dev-only 门控安全性；
- metric 缺口的最小可行埋点清单是否足以支撑 Q7-C 的放开决策。
