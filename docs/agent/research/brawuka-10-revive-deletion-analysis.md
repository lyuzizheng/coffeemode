# BRAWUKA-10 — Cafe Lifecycle: Deletion Guard + Visibility (ex-Revive) (#229)

**Issue:** https://github.com/lyuzizheng/coffeemode/issues/229
**Depends on:** #225 (tombstone lifecycle + creator-only DELETE), #228 (revive conflict safety + 404 race), #207/#219 closed
**Status:** Decided — owner veto on revive (2026-09-02), Reviewer & Architect裁定已入（BRAWUKA-28/PR#297 作废, S1-3 已拆单）
**Author:** Explorer & Advisor (5835b282) — 2026-09-01, updated 2026-09-02 per owner + architect
**Supersedes note:** §4.1/§5 的 `POST /revive` + 409 `replacement_id` 方案已被 owner 否决（"首先不能取消删除"），保留作决策记录，不再实施；BRAWUKA-28 已取消，`reviveCafe` 连测试在 S1 中删除。

---

## 0. 本次更新摘要（给 Reviewer 的 diff）

| 旧决策（2026-09-01 propose） | 新决策（2026-09-02 owner + architect裁定，owner 可推翻） |
|---|---|
| revive：creator-only `POST /api/cafes/[id]/revive`, 409 带 `replacement_id` | **不再做 revive**。删除不可逆，改为 `visibility public|private` 可逆 hide。`reviveCafe` 删除，旧 tombstone 保持 404+recovery 不迁移。 |
| 删除守卫：creator-only 按 `created_by`，`null` 行 API 不可删 | **删除改为 checkin 级分流**：有"其他人活 checkin >=1" 时禁止删 cafe，只能删自己的 checkin + 移交 owner 到 service account；`=0/1` 且只有自己的那条时删 checkin 后留空壳。 |
| `created_by IS NULL` 展示/权限 | 后端读时 fallback 到 service account（typed config），写时预置固定 UUID `00000000-0000-4000-a000-000000000001` 的 `profiles` 行；`profiles.id` 无 FK 到 `auth.users`（`0001_init.sql:8` 已核实）。 |
| private 计分 | 冻结 `work_stats`（旧 propose）| **不冻结**，visibility 只做读过滤，聚合照算。 |
| 空壳 | 旧 propose：Q2-A 留搜索 + Q7 排除 自矛盾 | **裁定：空壳公开可见，但 sitemap 排除 + n=0 详情 noindex，MVP 不做排名降级。** 同 POI 重建仍 409（壳占索引）。 |
| DELETE 确认 | 前端自觉 | **契约化**：无 `{confirm:true}` → `403 {code: cafe_has_other_checkins, n}` 零变更；带 confirm 才 `FOR UPDATE` 事务执行（`withTransaction`/`postgres.ts:115`）。 |
| visibility 列类型 | 未定 | `text + CHECK`，不用 PG enum。 |

新 scope 已拆单（串行，单 writer）：S1 `BRAWUKA-29 cafe-delete-guard`（stage1, Gemini 已启动）= DELETE 事务化 + service account 迁移 + 空壳 sitemap/noindex + 删 `reviveCafe` + DG125；S2 `BRAWUKA-30 cafe-visibility`（stage2, backlog）= visibility 列 + PATCH + 读过滤 + null fallback + DG126；S3 `BRAWUKA-31 cafe-lifecycle-ui`（stage3, backlog 前端）。

---

## 1. Problem being removed (updated)

Two product decisions were deliberately deferred when the tombstone system shipped. Owner 2026-09-02 已裁定新模型：

* **不再提供 revive**。删除是用户层面不可逆的"再也看不到"，可逆的是 `visibility` hide。`reviveCafe()` 回到死代码，S1 删除。
* **删除不再是删 cafe 行**。cafe 行在新模型下永远不被用户删除（"cafe 还是在那里"）。删除是删 checkin：`>=1` 别人的活 checkin 时禁止删 cafe，只能删自己的那条 + owner 移交；只有自己的那条时删后留 `n=0` 空壳。
* **旧 tombstone (`deleted_at IS NOT NULL`) 保持原状**：404 + `GET /recovery` 附近推荐，不做数据迁移。

---

## 2. Current state (evidence) — unchanged, for audit

| Area | What exists | Citation |
|---|---|---|
| Soft delete | `softDeleteCafe(id, userId?)` — `update cafes set deleted_at = now() where id = $1 and created_by = $2 and deleted_at is null`. Route probes `cafeExists(id)` before write and re-probes on `false` to split 404/403. | `web/lib/db/cafes.ts:485`, `web/app/api/cafes/[id]/route.ts:89-103` |
| Tombstone indexes | `0011` makes `idx_cafes_gplace`/`idx_cafes_apple_poi_id` partial `where deleted_at is null`. `idx_cafes_active` on `(id) where deleted_at is null` duplicates PK. | `web/db/migrations/0011_cafe_tombstone_lifecycle.sql` |
| Revive lib (to be deleted in S1) | `reviveCafe(id)` — `update ... set deleted_at=null where ... and deleted_at is not null`, catches `23505→false`. No caller outside tests. | `web/lib/db/cafes.ts:511` |
| Tests | Pool-mock unit for DELETE 400/401/404/403/200 and revive. Real-Postgres covers tombstone↔re-import↔revive conflict, sitemap/recompute exclusion. | `web/tests/cafes.test.ts`, `web/tests/integration/db.integration.test.ts:788-1100` |
| Null-created_by | Seed/import rows `created_by=null`. `softDeleteCafe(id,userId)` never matches them. | `web/lib/db/cafes.ts:485-498`, `0001_init.sql:33` |

Constraints inherited as Accepted: one VPS, `RATE_LIMIT_BACKEND=memory`, anonymous DTOs "A nomad", Supabase Auth no admin role, no offline queue, POI service holds Google keys, 34a Supabase hosts Postgres, harness rule spec-update-in-same-PR.

---

## 3. Questions requiring an owner call — resolved

| # | Question | 裁定（2026-09-02 final，含 06-18 补充） |
|---|---|---|
| Q1 | 谁能删 cafe？按什么口径？需要 `is_deleted` 列吗？ | 计**其他人的活 checkin >=1**（不是总数>=2，也不是去重人数）。**不需要为 cafes 新增 `is_deleted` boolean**：守卫查的是 `checkins`（`where cafe_id=$1 and user_id!=$caller and deleted_at is null`），现有 `idx_checkins_cafe / idx_checkins_user_cafe where deleted_at is null` 已覆盖；如需加速可加 `idx_checkins_cafe_other_live on checkins(cafe_id) where deleted_at is null`，用 `deleted_at is null` 建 partial index 即可，`is_deleted` 是冗余的 boolean 镜像（且与 visibility 的 `text+CHECK` 设计重复）。`cafes.deleted_at` 保留作旧 tombstone，不再用于新删除。 |
| Q2 | `n==1` 删后空壳怎么处理？进不进搜索/sitemap/排名？ | **A，公开可见，但 sitemap 排除 + n=0 详情 noindex，MVP 不做排名降级。** 业主确认 Q2 A。空壳仍占部分唯一索引，同 POI 重建 409。 |
| Q3 | `n>=2` 多人时删 checkin + owner 移交怎么做？放哪里？ | **放在 env**：`SERVICE_ACCOUNT_ID=00000000-0000-4000-a000-000000000001`，`profiles` 预置 `INSERT ... ON CONFLICT DO NOTHING`（无 FK 到 `auth.users`，已核实 `0001_init.sql:8`），后续由 Supabase 新建真实 service account + admin 网站接管。移交只改 `created_by`，不碰 `owner_id`（post-MVP）。`getUserCafes` 按活 checkin 聚合，删 checkin + 移交后自然消失。typed config DG107 改为 env 读取（业主 06-18 决策覆盖 architect 的 typed config 建议）。 |
| Q4 | `created_by IS NULL` 读/写 fallback？ | **ok**：读时 fallback 到 service account（`toPublicCafeDetail` 展示层），写时预置行同 Q3。后建 admin account。 |
| Q5 | private 计分冻不冻结？ | **不冻结**。visibility 只做读过滤（公共列表/搜索/附近/sitemap 排除，非 owner 详情 404），`work_stats` 照算。 |
| + | DELETE 二次确认是前端自觉还是契约？ | **契约化**：无 `{confirm:true}` → `403 {code: cafe_has_other_checkins, n}` 零副作用；带 confirm 才 `FOR UPDATE` 事务执行（`withTransaction` / `postgres.ts:115`）。 |
| + | visibility 列类型 | `text + CHECK (visibility in ('public','private'))`，不用 PG enum，方便以后扩。 |
---

## 4. Options & tradeoffs (with owner veto annotated)

### 4.1 Revive entry point — ❌ REJECTED by owner, kept as decision record

> Owner原话：0. "首先不能取消删除，用户可以选择 hide（visibility），但是删除后就是用户层面删掉了，再也看不到了"；Q1 "不能 revive 了，但是我们可以引入 visibility feature，public private"。Reviewer 已裁定 BRAWUKA-28 取消、PR#297 不合并（revive 方向已被否决；CI 本来也在红），`reviveCafe` 连测试在 S1 删除。新模型下 cafe 行永远不被用户删除，没有可复活对象，留着只会诱人接线。

For the record, the 2026-09-01 proposal was: creator-only `POST /api/cafes/[id]/revive` symmetric with DELETE, `cafes-write` bucket, `requireSameOrigin`, `23505→409 {replacement_id}` via `findLiveCafeByExternalId`. Rejected. The 409 `replacement_id` / `GET /recovery` enhancement is also out of scope under the new model. Old tombstones stay 404+recovery, no migration.

保留一行供追溯：若将来需要管理员"复活误删的旧 tombstone"，应另起 admin 工具，不走用户侧 revive。

### 4.2 Deletion authorization — 旧三选项 → 新分流模型（Decided）

| 旧选项（2026-09-01） | 新模型（2026-09-02 decided） |
|---|---|
| A 保持 creator-only 不可删 `null` 行 | **替代为**：有别人活 checkin >=1 → 禁止删 cafe（`403 cafe_has_other_checkins`），只能删自己的 checkin + `created_by` 移交 service account；只有自己那条 → 删 checkin 留空壳 (`n=0` 仍可见)。 |
| B report-driven | 延后，post-MVP 再议（与 `owner_id` 认领一起）。 |
| C admin role | 延后；Q4 的 service account 是固定系统账号，不是 RBAC admin。 |

Null-`created_by` 旧分析（`softDeleteCafe` 对 null 行永远不命中）仍成立，但新模型下 cafe 行本就不删，`null` 只在展示层 fallback。

### 4.3 Visibility vs Delete（新增，Decided）

* `cafes.visibility text default 'public' check (visibility in ('public','private'))`，默认 public。
* **hide 可逆，delete 不可逆**：hide = `PATCH /api/cafes/[id]/visibility` 仅 owner，可逆；delete = `DELETE /api/cafes/[id]`（分流语义），不可逆。
* private 读过滤：公共列表/搜索/附近/`GET /api/cafes/[id]`（非 owner 404）/ sitemap 排除；`work_stats` 不冻结。
* 空壳 (`n=0`) 读过滤：公共可见，但 sitemap 排除 + 详情 `noindex`，空状态"暂无打卡"。

---

## 5. Proposed DG / spec delta (updated to S1+S2)

**S1 DG125 — Cafe delete guard + service account + orphan shell (随 BRAWUKA-29 入册)**

> 删除按"其他人活 checkin >=1" 分流：有别人时 `DELETE /api/cafes/[id]` 无 confirm → `403 {code: cafe_has_other_checkins, n}` 零变更；带 `{confirm:true}` 时在 `FOR UPDATE` 事务内删调用者自己的活 checkin，并将 `cafes.created_by` 移交至固定 service account `00000000-0000-4000-a000-000000000001`（typed config `serviceAccountId`，`profiles` 预置 `INSERT ... ON CONFLICT DO NOTHING`，`profiles.id` 无 FK 到 `auth.users`）；只有自己的那条时删 checkin 后保留空壳 cafe（`n=0`，公共可见但 sitemap 排除、详情 noindex，MVP 不做排名降级）。同 POI 重建仍 409（空壳占部分唯一索引）。旧 `deleted_at` tombstone 保持 404+recovery，不迁移。`cafes-write` 桶 + `requireSameOrigin`。

Spec 0004 API2 / 0001 增量随 S1 PR 同步，含空壳 noindex 细节；旧 `reviveCafe` 相关 spec 文案删除。

**S2 DG126 — Cafe visibility (随 BRAWUKA-30 入册)**

> `cafes.visibility`∈`{public,private}`（`text + CHECK`，非 PG enum，DG107 typed config），`PATCH /api/cafes/[id]/visibility` 仅 owner。private 仅对读过滤（公共列表/搜索/附近/sitemap 排除，非 owner 详情 404），不冻结 `work_stats`。`created_by IS NULL` 展示层 fallback 到 service account。

S2 另含 null fallback 展示、读过滤全路径、DG126 入册。

**S1 schema notes**

* 删 `reviveCafe` 及其 unit/integration 测试；可选清 `idx_cafes_active`（`where deleted_at is null` 冗余于 PK）。
* 新增 `INSERT` 预置 service account 的 migration（`ON CONFLICT DO NOTHING`）。
* `cafes.created_by` 保持 nullable（fallback 读时处理，不在 S1 改 `NOT NULL`）。
* S2 才加 `visibility` 列。

---

## 6. Slice definition (updated, serial single writer)

### S1 — `BRAWUKA-29 cafe-delete-guard` (stage 1, Doing, Gemini)

| Field | Value |
|---|---|
| Title | DELETE 事务化分流 + service account + 空壳 sitemap/noindex + 删 reviveCafe |
| Specs | 0001 §Edge cases/Phases, 0004 API2, DG125 |
| Depends on | `cafe-creation`, `auth-foundation` (both COMPLETE) |
| Scope | `DELETE /api/cafes/[id]` 改为：`GET` 鉴权后计 `otherLiveCheckins = count(*) where cafe_id=$1 and user_id!=$caller and deleted_at is null`；`>=1` 且无 confirm → `403 {code,n}`；带 confirm → `withTransaction` 内 `SELECT ... FOR UPDATE` → 删 caller 的活 checkin（`deleted_at=now()` + `work_stats` 重算）+ `UPDATE cafes created_by=serviceId where id=$1 and created_by=$caller`；`==0` 分支同事务删 checkin 留空壳；空壳 sitemap 排除 + 详情 `noindex`；删 `reviveCafe` + 旧测试；service account migration + `app.yaml`/`config.ts` typed id；spec 增量同 PR。 |
| Not in scope | visibility 列/路由、通用 `PATCH`、admin/report、前段 UI |
| Test gates | `typecheck`, `unit` (403/confirm/移交/空壳/sitemap/noindex/mock), `integration` (RUN_INTEGRATION=1: 有别人时无confirm 403 零变更、带confirm删自己checkin+移交、纯个人删后空壳可见但 sitemap/noindex、同 POI 409), `build` |
| Outcome | 删除不再删 cafe 行，多人 cafe 受保护，纯个人删后留可恢复的空壳，无可复活对象，spec 不再指向 #229。 |

Pattern: `FOR UPDATE` 锁 cafe 行 + 单事务删 checkin + 条件移交；完全复用 `checkins` 软删对 `work_stats`/`gallery` 的既有路径。

### S2 — `BRAWUKA-30 cafe-visibility` (stage 2, Backlog)

| Field | Value |
|---|---|
| Title | visibility 列 + PATCH + 读过滤 + null fallback |
| Specs | 0001, 0004, DG126 |
| Depends on | S1 |
| Scope | `alter table cafes add column visibility text default 'public' check (...)`, `PATCH /api/cafes/[id]/visibility` 仅 owner, `cafes-write` + same-origin, 读过滤（列表/搜索/附近/sitemap/非 owner 详情 404），`work_stats` 不冻，`toPublicCafeDetail` 对 `null created_by` fallback 到 service account，DG126。 |
| Test gates | `typecheck`, `unit`, `integration`, `build` |

### S3 — `BRAWUKA-31 cafe-lifecycle-ui` (stage 3, Backlog, Frontend)

| Field | Value |
|---|---|
| Title | 确认弹窗 + hide 开关 + 空壳态 |
| Depends on | S1, S2 |
| Scope | 按 `403 cafe_has_other_checkins` 弹确认、visibility toggle、空壳"暂无打卡"态 |
| Test gates | `typecheck`, `unit`, `build`, `visual` |

---

## 7. Migration & rollout (updated)

* S1：预置 service account `INSERT ... ON CONFLICT DO NOTHING`；删 `reviveCafe`；空壳/sitemap/noindex 为读逻辑，无数据迁移；旧 `deleted_at` tombstone 不动。
* S2：加 `visibility` 列 `default 'public'`，存量零回填。
* 串行单 writer，S1→S2→S3。

---

## 8. Verification sketch (updated)

```ts
// S1 integration (RUN_INTEGRATION=1)
it("多人 cafe 无 confirm 403 且零变更，带 confirm 删自己 checkin + 移交 service account", async () => {
  // cafe has A(owner) + B(other) live checkins
  // DELETE without confirm → 403 {code: cafe_has_other_checkins, n:1} and cafe still live
  // DELETE with {confirm:true} by A → A's checkin soft-deleted, cafes.created_by == SERVICE_ID, cafe still live
});
it("纯个人 cafe 删除留空壳且 sitemap/noindex", async () => {
  // only owner's checkin → DELETE 200, checkin soft-deleted, cafe visible with n=0, excluded from sitemap
});
```

---

## 9. Recommendation to owner — closed

1. 接受 Q1-Q3、Q5 四项裁定与两条架构裁定（confirm 契约化、`text+CHECK`）—— 已裁定，owner 可推翻。
2. 不再以 `POST /revive` 立项，`reviveCafe` 在 S1 删除。
3. 按 S1→S2→S3 串行交付。

---

## 10. Decision record — rejected proposal retained

`POST /api/cafes/[id]/revive` + `409 {replacement_id}` (2026-09-01 §4.1/§5) 已被 owner veto，保留于本节作审计，不再实施。若将来需要管理员复活旧 tombstone，应另起 admin 工具，不走用户侧 revive。
