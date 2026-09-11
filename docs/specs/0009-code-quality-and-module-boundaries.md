# 0009. 代码质量与模块边界规范

## Goal

`docs/audit/2026-08-code-review-and-architecture-audit.md`（§§4–6）暴露的根因不是某几处写错，
而是规范缺少可执行的边界：`web/lib/db/cafes.ts` 长到 826 行无人拦截、
同一经纬度校验在三处重复无人拦截、请求校验长在持久层无人拦截。
本规范把"什么时候必须拆、什么时候必须抽、抽象用什么模式"写成可执行的判定规则，
让不了解本仓的工程师也能直接执行，让自动守卫（B-STD-2）有唯一的数字来源。

规范关键词：MUST（必须）、MUST NOT（禁止）、SHOULD（推荐，偏离需在 PR 中说明理由）。

## Stable decisions

### §0 权威归属：本规范拥有什么、不拥有什么

| 主题 | 唯一权威 | 本规范的态度 |
| --- | --- | --- |
| 路由/数据/鉴权/地图/POI/图片架构分层 | `docs/specs/0001-nextjs-migration.md` | 只引用，不复述；`lib/` 内部边界是 0001 未覆盖的空白，由本规范拥有 |
| 视觉、token、动效、无障碍 | `docs/specs/0002-design-system.md` | 不触碰；只规定 `components/**` 的 import 方向（§2），不管组件长什么样 |
| 测试分层、fixture 政策、CI 门禁、覆盖率棘轮 | `docs/specs/0003-testing-and-ci.md` | 不改动任何覆盖率数字；本规范只新增"结构门禁"维度，见 §3 |
| 编码流程与风格（早返回、命名、注释写 why） | `.agents/rules/coding.md` | 不重复；结构问题（拆分/抽取/模式选型）以本规范为准，风格问题以 coding.md 为准 |
| 阈值数字（行数/复杂度/重复/边界） | **本规范 §3（政策正文）** | 机器镜像 `web/structure.config.mjs`（+ `.jscpd.json` / `structure-baseline.json`）逐字实现，日常判定镜像 `.agents/rules/coding.md`（`### Decidable structure checks`）；改数 MUST 同 PR 改四处（改数规则） |

取舍说明：0001 规定"route handler 保持 thin、业务进 `web/lib/*`"，
但没有规定 `lib/` 内部如何分家——`cafes.ts` 正是从这个空白长出来的。
本规范把"route → lib"这条线留给 0001，把"lib 内部谁归谁"收归自己，
两份真相不重叠。冲突时按上表"唯一权威"列裁决。

### §1 模块边界与职责

`web/` 内有效层（与 0001 一致，0001 未定的 `lib/` 内部分家由本规范拍板）：

| 层 | 物理位置 | 拥有 | MUST NOT 含有 |
| --- | --- | --- | --- |
| 路由编排 | `web/app/api/*/route.ts` | 解析 query/body → 门禁 `guard()` → 调 `lib/*` → 错误映射（见 `## Data / API / UI behavior` 路由 thin 契约） | SQL/`pg` 直接调用；业务规则；超过 1 屏的分支 |
| HTTP 关注点 | `web/lib/api/*`、`web/lib/auth/*`、`web/lib/security/*`、`web/lib/rate-limit*` | 鉴权、限流、origin 校验、错误形状、query 解析 | 业务语义（如"建馆必须带首条打卡"）；SQL |
| 校验/解析 | `web/lib/validation/<domain>.ts`（纯函数；BRAWUKA-180 在并行分支落地 `cafe.ts`/`checkin.ts`，合入后以新模块为准） | 所有请求体/参数校验：`parse*`、`optString` 类 helpers | SQL；`server-only` 以外的副作用；跨 domain 引用 |
| 持久化 | `web/lib/db/*` | SQL、事务、`query`/`withTransaction` 调用、行映射 | 请求校验；sitemap/SEO 组装；展示投影（strip 字段、maintainer 文案） |
| 领域服务 | `web/lib/<domain>/*`（`places`、`images`、`stats`、`checkin`、`discovery`…） | 跨表/跨系统的业务编排 | 直写 SQL（必须经 `lib/db`）；HTTP 状态码 |
| 共享叶子 | `web/shared/*`、`web/types/*`、`web/lib/hours.ts`、`web/lib/cities.ts` | 纯常量/纯函数/类型，被所有层引用 | 引用 `lib/`、`app/`、`components/`（叶子不得长出依赖） |
| UI | `web/components/**`、`web/app/**/page.tsx` | 渲染、交互、HeroUI 装配（0002 拥有） | `import` 任何 `lib/db/**`；直连 Postgres；内联业务校验 |

真实反例（本仓现状，判定练习用）：`web/lib/db/cafes.ts`（826 行）同时承载四类职责——

- 校验：`optString`（L138）、`parseCreateCafeBody`（L153–256，经纬度/价格/营业时间/首条打卡全套规则）；
- CRUD/事务：`createCafeWithFirstCheckIn`（L306）、`listCafesNearby`（L447）、`getCafe`（L490）、`setCafeVisibility`（L610）、`deleteCafe`（L667）、`attachImageToCafe`（L808）；
- SEO：`CafeSitemapEntry` + `listCafeSitemapEntries`（L537–566，被 `web/app/sitemap.ts` 消费）；
- 展示投影：`formatCafeMaintainer`（L104）、`toPublicCafeDetail`（L522–535，strip `created_by`/gallery 作者字段）。

连锁证据：`web/app/api/cafes/route.ts` L4–9 从 `@/lib/db/cafes` 同时 import
`parseCreateCafeBody`（校验）和 `createCafeWithFirstCheckIn`（事务）——
路由被迫依赖持久层才能拿到校验函数，这就是"校验长在持久层"的可观测症状。
同类：`parseScores`/`parsePhotoIds`/`parseVisitedAt` 住在 `web/lib/db/checkins.ts`（L40–84），同属错位。

### §2 依赖方向与循环依赖禁令

允许方向（DAG，自上而下，禁止任何反向边）：

```text
components / app pages ──▶ lib（非 db）──▶ lib/db ──▶ lib/validation · lib/db/postgres
app/api routes ──────────▶ lib/*（含 db，只调不实现）
lib/* ──────────────────▶ shared/* · types/*（叶子）
```

硬禁令（政策正文归本规范；机器执行归 B-STD-2 守卫）。
落地状态分两类，下文每条末尾标注：【守卫已拦截】= `web/eslint.config.mjs` 自动变红；
【规范红线】= 暂无自动规则，靠 reviewer 按本规范打回，工具排期中：

1. `app/api/**` MUST NOT 直接引用 `pg` 系驱动或出现 SQL 模板（`select|insert into|update|delete from` 字符串）。【守卫已拦截：`api-no-driver` + `SQL_IN_API_FILES` 的 `no-restricted-syntax`】
2. `components/**` MUST NOT 在运行时 `import` `lib/db/**`（UI 需数据一律经 route handler 或 Server Component 调 `lib` 非 db 入口；纯类型 import 豁免，DTO 需要复用时先从 `lib/db` 搬出）。【守卫已拦截：`ui-no-persistence`】
3. `lib/db/**` MUST NOT `import` `components/**`（持久层向上引用 UI 是循环依赖的前兆）。【守卫已拦截：`persistence-no-ui`】
4. `lib/validation/**` MUST NOT `import` `lib/db/**`（校验层反向依赖持久层即 §1 反例重演）；迁移过渡期内允许 `lib/db` import `lib/validation`，方向不可反转。【规范红线：待 `lib/validation/` 落地（BRAWUKA-180）后补 `no-restricted-imports` 规则】
5. `shared/**`、`types/**` MUST NOT `import` `lib/**`、`app/**`、`components/**`（叶子规则）。【规范红线：规则排期中】
6. 循环依赖：任何方向的 import 环（直接或经第三模块）MUST 为零容忍，
   豁免不适用 §7（环没有 grandfather 的余地，发现即拆）。【规范红线：`madge`/`dpdm` 类检测工具排期中，落地前靠人工审查】

### §3 规模阈值（政策正文；机器镜像与改数规则见表后）

下表是政策正文；`web/structure.config.mjs`（+ `.jscpd.json` 镜像）是其机器实现，两处 MUST 逐字一致；
"按文件类型区分"只体现在"作用域/排除行"（见表后说明），不体现在数字上。

| 维度 | 阈值 | 工具 | 违反后果 |
| --- | --- | --- | --- |
| 单文件行数（硬） | 400 | ESLint `max-lines` | 同 commit 内拆分（§4），CI 变红 |
| 单文件行数（软） | 250 | 人工评审（reviewer 必问"能否拆"） | PR 必须回应，可不拆但需理由 |
| 单函数行数 | 80 | ESLint `max-lines-per-function` | 同 commit 内 Extract Function |
| 认知复杂度 | 15 | `sonarjs/cognitive-complexity` | 同 commit 内拆分支/查表/策略化 |
| 嵌套深度 | 4 | ESLint `max-depth` | 同 commit 内早返回/抽函数 |
| 参数个数 | 5 | ESLint `max-params` | Parameter Object（§4 手法 3） |
| 完全相同函数体 | 3 行以上即报 | `sonarjs/no-identical-functions` | 第 2 次出现即抽取（§5） |
| 复制粘贴块 | 单次 ≥5 行或 ≥50 token | `jscpd`（`threshold: 3`，`minLines: 5`，`minTokens: 50`，忽略 tests/dist/archive） | 第 2 次出现即抽取（§5） |
| 仓库重复率 | <3% | `jscpd` 汇总 | 超标则冻结新抽象，先还债 |

作用域说明（这就是"按文件类型区分"的全部含义）：

- ESLint 结构规则 + `check-file-size` 作用于 `SOURCE_GLOBS` / `SOURCE_SCAN`（`app`、`components`、`lib`、`shared`、`config`、`scripts`）；**测试文件（含 `tests/`、`*.test.*`）明确排除在外**——测试体积预算归 `docs/specs/0003-testing-and-ci.md` 所有，本规范不给测试定数字、不扫描测试（`SOURCE_GLOBS` 注释原文："Tests are deliberately absent: spec 0003 owns test-maintenance budgets"）。
- `jscpd` 忽略 `tests/`、生成物、`dist/`、`_archive-*`（`.jscpd.json` 落仓值与本表一致）。
- 生成物/migration/`_archive-*` 不计入任何阈值。
- `poi-service/`、`image-service/` 同样适用本表（Workers 代码无豁免）。

改数规则：阈值变更 MUST 同 PR 改四处——本规范 §3（政策正文）、`web/structure.config.mjs`（机器源）、`.jscpd.json`（`duplication` 镜像，`check:structure` 会断言镜像一致）、`.agents/rules/coding.md`（`### Decidable structure checks` 日常判定镜像）；只改部分位置（或改工具不改文档）的 PR 视为 P0 违规（两份真相）。

### §4 "同 commit 拆分"规则与拆分手法

硬规则：任何 commit 使文件越过任一硬阈值（§3 标 CI 变红的行），
MUST 在当次提交内完成拆分。不允许"顺手加一行"把超标文件继续推高，
不允许"下次再拆"的 TODO（coding.md 已禁 TODO，此处重申后果：CI 直接变红）。

触发矩阵（reviewer 按此打回）：

| 信号 | 判定 | 手法 |
| --- | --- | --- |
| 文件 >400 行 | 按关注点切模块 | 手法 1 |
| 函数 >80 行或复杂度 >15 | 切小函数/查表/策略 | 手法 2（+ §5 策略化） |
| 参数 >5 个 | 打包参数对象 | 手法 3 |
| 一文件多关注点（如 §1 cafes.ts 反例） | 按职责分文件 | 手法 4 |

手法 1 — Extract Module：按 §1 表把文件切到归属层。
`cafes.ts` 示范拆分（示例方向，非强制文件名）：
`parseCreateCafeBody` + `optString` → `web/lib/validation/cafes.ts`；
`listCafeSitemapEntries` + `CafeSitemapEntry` → `web/lib/db/cafe-sitemap.ts`（SEO 查询仍是 SQL，归持久层子模块，不与 CRUD 主文件混放）；
`toPublicCafeDetail` + `formatCafeMaintainer` → 展示投影归领域服务；
`web/lib/db/cafes.ts` 只留 CRUD/事务。路由改从新位置 import（依赖方向见 §2）。

手法 2 — Extract Function：被测行为优先抽。
`deleteCafe`（L667–760，含 checkin 归属判定/owner 转移/shell 保留分支）按分支抽
`assertDeletable`/`transferOrShell` 纯判定函数，目标单函数 ≤80 行且复杂度 ≤15。

手法 3 — Parameter Object：`createCafeWithFirstCheckIn` 类多入参入口
（cafe 字段 + checkin 字段 + photoIds + visitedAt）收敛为已存在的
`CreateCafeInput`（L125）单一对象，调用点禁止逐字段展开传递第 6 个参数。

手法 4 — Split by concern：同一文件出现 §1 表中两个"拥有"列的动词
（如既 `query` 又 `fail(` 校验），先移校验后谈逻辑。
`parseScores`/`parsePhotoIds`/`parseVisitedAt` 从 `web/lib/db/checkins.ts` 迁往
`web/lib/validation/checkins.ts` 即本手法的标准动作。
（BRAWUKA-180 在并行分支执行本动作：`lib/validation/cafe.ts` + `checkin.ts` 已抽出，`db/cafes.ts` → `db/cafes/` 子模块；合入后 §1 反例行号以新模块为准，判定逻辑不变。）

### §5 重复与抽象判定

总则：同一逻辑第 2 次出现即抽取。不以"3 次法则"拖延（3 次法则适用于"是否值得抽象"的犹豫，不适用于本仓：audit 已证明拖延即永久重复）。

判定流程（按顺序问）：

1. 一字不差（≥3 行函数体 / ≥5 行或 ≥50 token 块）？→ 直接抽 helper，同名同参，调用点替换。工具：`sonarjs/no-identical-functions` + `jscpd`。
2. 同"形状"（字段/结构/流程骨架相同，细节不同）？→ 工厂函数或组合函数，差异点做参数。本仓正例见下。
3. 同"算法族"（同一接口多种实现：内存/Postgres 限流、多窗口桶）？→ Strategy：接口 + 多实现 + 工厂选择。
4. 跨系统适配（Next ↔ POI/D1/KV、Next ↔ image-service/R2、Google/Apple POI 归一化）？→ Adapter：把对方形状转成我方类型，SQL/HTTP 细节封在适配器内。
5. 第三方边界（Supabase Auth、`pg` Pool、MapKit token）？→ Facade：收敛为最小调用面（`getCurrentUser`、`query`、`apiError`），调用点禁止直达第三方 SDK。
6. 可测试性替换或可配置依赖（真实 DB 查询器 vs 内存假实现、系统时钟、随机数）？→ DI（依赖注入）：依赖以函数一等参数或带生产默认值的配置对象传入，调用点显式组装。**红线：MUST NOT 引入 InversifyJS / TypeDI 类重型装饰器容器**——本仓的 DI = 参数注入，不是容器。

本仓正例（照着学）：

- Strategy + Facade + 工厂 + 单例：`web/lib/rate-limit/types.ts`（`RateLimiterLike` 接口，L19）→ `web/lib/rate-limit.ts`（内存 `RateLimiter` 实现 + `createRateLimiter` 工厂 + `rateLimiter` 懒单例代理）→ `web/lib/rate-limit/postgres.ts`（原子 UPSERT 后端，fail-open）。路由经 `guard()` 间接调用（`guard` 内聚 `checkRateLimit`；旧直调形态见 PR #359 前）。
- Facade：`web/lib/api/response.ts`（`apiError` 统一错误形状 L19、query 解析 `parseQueryPositiveInt` L58）；`web/lib/config.ts`（`rateLimits`/`appConfig` 冻结单例 + `rateLimitConfig` 访问守卫，YAML 数字归 `web/config/*.yaml`，DG107）。
- 门禁 Facade（已定型，PR #359）：`web/lib/api/guard.ts` 的 `guard(request, { bucket, requireAuth, route })` 是唯一门禁入口——桶名编译期 + 运行时双校验 → 鉴权（401）→ clientId → 多窗口限流（429），`{ ok, user, clientId } | { ok: false, response }` 显式返回；`readJsonBody` 同模块收敛 body 解析。路由 MUST 经它进入，MUST NOT 手抄门禁样板（`scripts/check-route-guards.mjs` 全仓强制）。
- 形状复用：`web/shared/places/geo.ts`（`haversineKm` 跨服务唯一真相）。
- DI：`web/lib/stats/aggregate.ts`（`QueryFn` 类型 L36 + `defaultRunInTransaction()` 生产默认值 L47，聚合函数经 `query: QueryFn` L99、L204 / `runInTransaction` L69、L128 注入——单测传假查询器即可覆盖，无需起库）。

本仓反例（禁止重演，括号内为正确动作）：

- FNV-1a Stable ID 在 `poi-service/src/handlers.ts` 与 `web/components/cafe/apple-place-search.tsx` 逐字重复（→ 收敛到 `web/shared/places/geo.ts`，audit §4.1）。
- Maps 分享链接校验在 `web/lib/places/validate-maps-url.ts` 与 `poi-service/src/url.ts` 各写一套正则（→ 并入 `web/shared/places/` 唯一实现，audit §4.1）。
- 经纬度越界检查在 `web/lib/db/cafes.ts` L167–171 与 `web/app/api/cafes/route.ts` L43 内联重复，且 audit 点名的 `isValidCoordinate` 至今不存在（→ 在 `web/shared/places/geo.ts` 新建并三处替换；本规范生效后第 2 处重复即触发 §5 流程）。
- `web/components/cafe/cafe-creation-sheet.tsx` 曾硬编码 `MAX_UPLOAD_BYTES = 10MB`（audit §4.2 指出后已整改：常量收敛至 `web/shared/images/constants.ts`，由 `web/shared/images/validation.ts`、`web/lib/images/client-upload.ts`、`web/lib/images/processor.ts` 共用——DG107"数字进 YAML/共享常量"的正例定型）。
- `web/lib/search/distance.ts`：2 行透传重导出，唯一调用点是 `web/tests/search/distance.test.ts`（→ 删除，指测试直引 `@shared/places/geo`）。单用一次的抽象不是抽象，是间接层（见 §6）。
- DI 反例：为测试在模块全局声明可变 mock 单例，或把简单函数包进 class 只为"可注入"（→ 改传参，删容器）。

### §6 抽象否决项

1. 单一使用者否决：新抽象只有一处调用点时 MUST NOT 合并（`distance.ts` 为判例）。
   例外：Strategy/Adapter/Facade 面向"已知第 2 个实现"（如新限流后端、新第三方）时，
   PR 必须写明第 2 个实现是什么，否则按单用否决。
2. 投机否决：coding.md 已禁 speculative options/TODO/placeholder；本规范补充——
   新增抽象必须在 PR 说明写清所选模式（Factory / Strategy / Adapter / Facade / DI）
   与被否替代方案的原因（父单硬规则），缺此说明 reviewer MUST 打回。
3. 层越位否决：为"复用"把校验塞进 `lib/db`、把 SQL 塞进 `components` 的 PR，
   无论省多少行 MUST 打回（省行数不能购买层越位）。

### §7 例外机制：祖父清单与"只降不升"

确需超标的文件走登记制，不走口头豁免。存量豁免有**两张**机器登记表（政策正文在本节，两处镜像与正文 MUST 1:1，增删同 PR）：

| 文件 | 当前行数 | 超标项 | 只降不升基线 | 复核到期 | 责任人 |
| --- | --- | --- | --- | --- | --- |
| `web/components/discovery/checkin-feed.tsx` | 433 | 文件硬 400 | 433（只允许减少） | 2026-12-31 | BRAWUKA-175 |
| `web/lib/db/profile.ts` | 431 | 文件硬 400 | 431 | 2026-12-31 | BRAWUKA-175 |
| `web/lib/config-schema.ts` | 424 | 文件硬 400 | 424 | 2026-12-31 | BRAWUKA-175 |

`web/lib/db/cafes.ts`（826）与 `web/lib/db/checkins.ts`（758）已由 BRAWUKA-180 (#356)
拆分毕业，按 §7.4「毕业行直接删除」从表与机器基线移除，基准值随之下降。
机器镜像：`web/structure-baseline.json` 的 `files`（每条含 `lines`、`owner` 与 `reviewBy`），
由 `scripts/check-file-size.mjs` 读取。`checkin-drawer.tsx`（730，守卫合入前 main 上
BRAWUKA-185 (#358) 造成的 +5）已由 BRAWUKA-197 (#370) 拆分为表单分区 + hooks 并毕业；`checkin-feed` 的 440 是 BRAWUKA-73 (#349) 造成的 +1，
已由 BRAWUKA-73 (#361) 在 main 上压到 433，登记值同步下调（BRAWUKA-200，PR 标题写 434、
合入后的树实测 433）；`config-schema.ts` 是 BRAWUKA-184 (#357) 引入；基线自记录值起只降不升。

第二张表：规则级豁免（`web/eslint-suppressions.json`，当前 46 文件 / 56 条目 / 61 处违规）。
用途：结构规则（函数行数/复杂度/`max-depth`/同构函数）对存量文件的逐条 suppress；
读取方：**ESLint 自身的 bulk suppressions 机制**（`eslint.config.mjs` 不读该文件、不按路径关规则），
棘轮由 `scripts/check-suppressions.mjs` 校验，预算登记在
`web/structure-baseline.json` 的 `eslintSuppressions`（`files` / `entries` / `perRule` / `reviewBy`）。
同样**只降不升**：文件数、条目数或任一规则的违规数增长即 CI 失败，
`check:structure` 会打印 `suppressed violations: N (budget M)` 让存量在日志里可见；
`npx eslint --prune-suppressions` 可剪已自愈条目，重构 PR 应当顺手清除；
缺少 `reviewBy` 或复核到期未处理同样按失败处理（§7.1、§7.3）。
BRAWUKA-180 (#356) 拆分后存量违规 72 → 68、条目数 60 → 60、文件数 44 → 48：
一个 god module 拆成多个模块会把同一批豁免摊到更多文件上。三项都是硬棘轮，
因此这种"债务总量下降但分布变宽"的重构 MUST 同 PR 更新预算并说明（本条即该说明），
预算 diff 本身进入 review；未说明的增长一律 CI 失败。

规则：

1. 申请：新超标需求 MUST 开 issue（标题含 `[STRUCT-EXEMPT]`），说明超标维度、行数/条目数、到期日、拆分计划，reviewer（非作者）批准后方可合入，清单同步 +1 行（含 `structure-baseline.json` / `eslint-suppressions.json` 镜像）。**新规则级豁免同样必须由非作者 reviewer 批准并写明到期日**，无到期日的 suppressions 不得合入。
2. 只降不升：清单文件的行数 / suppressions 条目数 MUST 单调递减；任何使其上升的 commit（即使未过硬阈值增量）CI 按失败处理。重构 PR 应当顺手削减清单数字、清除自愈条目。**登记值本身同样单调递减**：文件缩小后（仍 > 硬阈值 400）登记值大于实际行数即 CI 失败（`check-file-size` 报 stale 并给出应下调到的数字）——棘轮只有在登记值与实际行数同步时才真正收紧，允许"文件已缩小、登记值不动"等于把旧上限永久保留；确需保留余量（如本 PR 后续还要在同一文件加回几行）MUST 在 PR 说明理由并由非作者 reviewer 批准，且登记值仍 MUST ≤ 原值。
3. 到期复核：每季度末（3/6/9/12 月末）复核清单；到期未拆 MUST 续期（更新到期日 + 说明）或升级为 P1 技术债 issue。循环依赖（§2.6）不适用本节。
4. 删除即胜利：`profile-view.tsx` 900+ 行 → ~93 行 + 组件簇（audit §5.4 已还债）是清单毕业的范本：毕业行直接删除，不留"曾超标"纪念。

## Data / API / UI behavior

路由 thin 契约（0001 拥有"thin"原则，本规范只固定入口与顺序，顺序错即打回）。
`web/app/api/*/route.ts` 处理顺序 MUST 为：origin 校验 → 解析 → 校验（调 `lib/validation`）→
门禁 `guard(request, { bucket, requireAuth, route })`（鉴权 + 限流合一，401/429 信封内聚；只读匿名边界见 BRAWUKA-163 结论）→
调 `lib` 业务 → 错误映射（`apiError` 形状 + 状态码约定）。`web/app/api/cafes/route.ts` GET/POST 为参照实现
（`const gate = await guard(request, { bucket: "cafes-read", route: "GET /api/cafes" }); if (!gate.ok) return gate.response;`）。
路由编排澄清：上式是显式编排契约。门禁侧已收敛为唯一合法共享入口（`guard()` 调用显式、五步顺序写在函数文档注释、返回值可见——正是 §5 Facade 的定型形态）；
禁止的是**把业务编排藏进黑盒**（为消行数而套高阶包装隐藏业务顺序）。门禁一致性由"顺序契约 + `guard()` + `check-route-guards` 自动拦截"三重保证。

错误形状、状态码、DG 编号语义归既有约定所有，本规范不复述；
需要改动时更新 owning spec（coding.md 路由章节已有此要求）。

## Edge cases

1. `lib/db` 的 SQL 常量（`LIST_SITEMAP_SQL` 等）与 `query` 调用留在 `lib/db` 是合法的；
   非法的是校验/投影/Sitemap"概念"与 CRUD 主文件混放——拆的是概念归属，不是 ban SQL。
2. `withTransaction` 跨 `cafes`/`checkins` 的 fused 写入（建馆即首条打卡，0001 拥有）
   是合法的跨表事务；合法不等于可堆：事务内的纯判定 MUST 先抽成可单测函数（手法 2）。
3. 展示投影（`toPublicCafeDetail` 类 strip 逻辑）MUST 有归属层（领域服务），
   MUST NOT 以"就几行"为由留在 `lib/db`（§6.3）。
4. Workers（`poi-service/`、`image-service/`）阈值与本表相同；跨服务重复
   （FNV-1a、Maps 校验判例）唯一真相收敛到 `web/shared/`，Workers 不各自为政。
5. 测试文件（体积、拆分手法、状态隔离、DB 断言策略）全部归 0003 所有；本规范对测试唯一的建议是：跨 `it` 共享可变状态（如模块级 `let cafe1Id`）是脆弱写法，新测试 SHOULD 每个 `it` 自建数据，存量迁移按 0003 排期。
6. 事务客户端适配器已收敛（BRAWUKA-182，`main` `7609e64`）：canonical 来源是
   `web/lib/db/postgres.ts`（`TxQueryFn` / `RunInTransaction` / `txQueryFrom(client)` /
   `txRunnerFrom(client)`）；`cafes/create|delete`、`checkins/create|update` 的 5 处
   `inSameTx` 闭包，以及 `db/cafes/create.ts`、`db/checkins/create.ts`、
   `images/complete.ts`、`stats/aggregate.ts` 的 4 处 `client.query.bind(client) as …`
   结构转换，全部改为复用标准适配器；
   `complete.ts`（`CompleteQueryFn`）、`stats/aggregate.ts`（`QueryFn`）、
   `db/image-uploads.ts`（`IntentQueryFn`）、`images/provision-photos.ts`
   （`ProvisionQueryFn`）的手写形状收敛为别名。新代码 MUST 复用 canonical 类型，
   MUST NOT 再定义等价形状；`withTransaction` 仍是唯一事务边界（单次尝试、无自动重试
   —— 重试从外层经 `withTransaction` 重进，幂等由 DG61 保证）。

## Tests / acceptance criteria

作者自检清单（合入前逐项勾选，缺一即返工）：

- [ ] 新增/改动文件对照 §3 表：行数/函数/复杂度/深度/参数无硬超标，或超标部分已同 commit 拆分。
- [ ] 新增逻辑全文搜索无第 2 处重复（`jscpd` 本地通过）；新增抽象写明模式 + 被否方案（§6.2）。
- [ ] 无 §2 禁令边（其中第 1–3 条及 SQL 由守卫自动拦截，第 4–6 条靠人工按【规范红线】打回）。
- [ ] 阈值数字与本规范 §3 一致；如改了数字，§3 + `structure.config.mjs` + `.jscpd.json` + `.agents/rules/coding.md` 已同 PR 同步（§3 改数规则）。
- [ ] 祖父清单文件行数未上升（`git diff --stat` 对照 §7 基线）。

 reviewer 清单：软 250 文件是否回应；§4 触发矩阵是否命中；例外申请是否有 issue + 到期日。

验收（对 issue B-STD-1）：陌生工程师凭 §1–§5 能独立完成一次拆分/抽取；
与 B-STD-2 阈值逐字一致（本规范 §3 表 = 守卫配置值，无"文档 400 / 工具 250"式矛盾）；
`.agents/scripts/docs-review-packet.sh` + 独立语义评审结论齐全。

## 附录 A：5 分钟判定速查

```text
要加代码？先看 250/400 线：超 400 → 边写边拆（§4）；250–400 → 写完问 reviewer。
要复制？第 2 次就是最后一次：直接抽（§5），jscpd 会替 reviewer 先看到。
要新建抽象？先答：调用点 ≥2（§6.1）+ 模式名 + 被否方案（§6.2），缺一不建。
要破层？只有 §7 登记一条路，且循环依赖无路（§2.6）。
要改数字？§3 + structure.config.mjs + .jscpd.json + .agents/rules/coding.md 同 PR 改（改数规则），少一处就是 P0。
```
