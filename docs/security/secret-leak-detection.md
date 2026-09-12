## 目标与边界

回答「怎么系统性检查密钥泄漏」：一套跨仓库可复用的检测方法、分层防线、判定标准与处置顺序。

- 本文档只给方法与命令，不做取证：4 个仓库的历史取证结论在 BRAWUKA-227，不在这里重复。
- CoffeeMode 仓库的 hook 与 CI 落地（`.pre-commit-config.yaml`、`workflows`、`AGENTS.md` 变更）在 BRAWUKA-228；本文只引用其约定，不改那些文件。
- 本文档与评论中不得出现真实密钥原文，示例一律用伪造字符串。

适用仓库：CoffeeMode MonoRepo 为主文档宿主；CanCan、Our Village、LZZ Blog 的接入方式见 §9。

工具版本基线（2026-09-12 本地实测）：`gitleaks 8.30.1`、`trufflehog 3.97.4`、`git 2.50.1`。
CI 与 hook 中必须 pin 住版本（action pin 到 commit SHA，pre-commit pin 到 rev），不要用 `latest`。

## 判定标准：什么算真实密钥

与 BRAWUKA-227 取证口径一致，复制到这里是为了让排查的人当场可判，不用翻另一个 issue。

算（按紧急度降序）：

1. 可直接换钱或换数据的：支付 key、邮件发送 key、LLM provider key、GitHub PAT。
2. 可直接进生产基础设施的：带密码的数据库连接串、Cloudflare API token、VPS/Dokploy SSH 私钥或部署 token、R2/S3 access key + secret。
3. 可伪造身份的：Supabase `service_role` key、JWT signing secret、私有证书与私钥。

不算（不要报为漏洞，最多记为卫生问题）：`samplesecret`、`changeme`、`xxx`、`your-key-here`、
`<YOUR_TOKEN>`、占位符、`*.example` 模板、本地 dev 默认值、公开的 Supabase anon key、测试里的固定假值。

判定流程（三步，缺一不可）：

1. 看上下文：key 出现在 `.env*.example`、测试 fixture、文档示例里，且值是占位符形状 → 直接判为非密钥。
2. 看形状：高熵随机串 + 厂商前缀（如 `sbp_`、`sk-`、`ghp_`、`xoxb-` 等形状）→ 嫌疑上升；`local-dev-token`、
   `REPLACE_ME`、`a0eebc99-…` 这类测试 UUID → 嫌疑解除。
3. 能验证的才验证：`trufflehog` 的 verified 结果可直接采信；unverified 结果必须人工走完前两步，
   不许只凭扫描器输出就定性。

特例：Supabase anon key 设计上就是公开的（前端 bundle 里可见），泄漏到仓库不算漏洞；
`service_role` key 泄漏算 P0。两者不要混为一谈。

## 分层防线

五层按「离提交越近越便宜」排列。每一层都写明命令、覆盖范围、预期输出与失败表现。

### L1 本地 pre-commit（提交前最后一道，毫秒级）

目的：让密钥根本进不了本地 commit。

命令（BRAWUKA-228 负责把下面这条接进 hook，本文只定义行为）：

```bash
gitleaks protect --source . --staged --verbose --redact
```

- 通过：输出 `no leaks found`，exit code `0`，提交继续。
- 拦截：打印命中规则与文件位置（`--redact` 下密钥正文被打码），exit code `1`，提交中止。
- 安装与版本 pin、绕过流程（`--no-verify` 禁止条件）由 BRAWUKA-228 定义。

覆盖范围：仅 staged 内容。不覆盖：未 `git add` 的文件、已进历史的密钥、`.env` 这类
被 `.gitignore` 忽略但通过 `-f` 强加的文件（hook 照样扫 staged，所以强加也拦得住）。

取舍：规则用 gitleaks 默认全集，不要按 `--enable-rule` 裁剪。本地误报成本低（当场 `git reset`
改掉就行），漏报成本高（进历史就得走 §6 的昂贵流程）。

### L2 CI 每次 push（防「没装 hook」与「`--no-verify`」）

目的：抓漏网之鱼。任何绕过本地 hook 的提交都在这里被拦下。

增量扫描（每个 push / PR 必跑）：

```bash
git fetch origin main --unshallow  # 确保能 diff；actions/checkout 用 fetch-depth: 0 等效
gitleaks detect --source . --log-opts="origin/main..HEAD" --verbose --redact
```

全历史扫描（独立 job，同一切换分支都跑，或至少每周 cron 一次）：

```bash
gitleaks detect --source . --no-git --verbose --redact  # 工作区全量，含 untracked 例外见下
gitleaks git file://. --verbose --redact                # 完整历史，含已删除文件
```

- 通过：exit code `0`。失败：exit code `1`，job 红，PR 不可合。
- 注意 `gitleaks detect --source .` 默认尊重 `.gitignore`，`--no-git` 仍尊重 ignore 规则；
  真正想扫被忽略文件用 `gitleaks protect --staged`（L1 已覆盖）或显式 `--no-git --follow-symlinks` 组合，
  以 `--help` 为准，不要想当然。

取舍：CI 全量 job 允许用 baseline（`--baseline-path`）压住「历史已知、已轮换、仅等改写窗口」
的旧命中，但 baseline 条目必须带 issue 链接与到期日；到期未清则红。新增命中永远红，不许进 baseline。

### L3 平台侧（GitHub Secret scanning / Push protection）

目的：厂商规则库兜底 + 推送时刻服务端拦截。覆盖前两层不认识的新厂商 token 形状。

开启（按仓库可见性，行为不同，先确认再勾 §8 清单）：

- Public 仓库：Secret scanning 自动可用；Push protection 在 Settings → Code security → Secret protection 下开启。
- Private 仓库：需要 GitHub Advanced Security（付费）才有 Secret scanning / Push protection；
  没有预算时 L1+L2 就是全部防线，必须在 §8 清单里明确标出此缺口与责任人。

覆盖范围：push 到 GitHub 的瞬间。本地历史、第三方云（Dokploy 环境变量、Cloudflare dashboard）
不在其范围内。

取舍：平台告警走 Security → Secret scanning alerts，指定唯一接收人（§8 清单）。
Dismiss 告警必须写理由且仅限「占位符/测试值」两类；`Won't fix` 需要第二人确认，
不许提交者自己 dismiss 自己的告警。

### L4 历史全量查（取证与 periodic sweep）

目的：回答「历史上到底漏过什么」。也是 BRAWUKA-227 取证用的方法，本节是其可复用版本。

主扫描（广度优先，宁可误报）：

```bash
gitleaks git file://. --verbose --redact --report-format json --report-path findings.json
git log --all --full-history -- "*token*" "*secret*" "*.pem" "*.key"  # 文件名维度交叉核对
git log --all -p -S 'BEGIN PRIVATE KEY' -- . ':!*.example'             # 内容维度定点核对示例
```

二次确认（精度优先，只认验出活的）：

```bash
# trufflehog v3：--results 控制输出类别；旧版 --only-verified 在 v3 已被 --results=verified 取代
trufflehog git file://. --results=verified,unknown --json --fail
```

`--results` 取值与何时用：

| 取值 | 含义 | 何时用 |
| --- | --- | --- |
| `verified` | 调厂商 API 确认仍然有效 | 分诊：决定今晚轮换哪几个，先干这个 |
| `verified,unknown`（推荐默认） | 加上「验证出错、无法定性」的 | 日常 sweep：unknown 必须人工判，不能 silently drop |
| `verified,unverified,unknown`（v3 默认全集） | 加上「形似但验出无效」 | 取证：BRAWUKA-227 这类要穷尽历史的场合 |

只用 `verified` 做门禁、用全集做取证：门禁求 action 精度（半夜被告警必须能动手），
取证求召回（失效的 key 也要知道它曾经漏过，见 §5 复盘）。

预期输出：`gitleaks git` 逐 commit 打印命中；`trufflehog --fail` 有命中时 exit code `183`，
无命中时 `0`。JSON 报告里只保留脱敏指纹（类型 + 前后各 4 位或 sha256 前 12 位），
原始值不许落盘到仓库目录（`findings.json` 写到仓库外或扫完即删）。

### L5 运行时（泄漏发生时把 blast radius 压到最小）

检测只能降低概率，运行时决定损失上限：

- 密钥轮换：所有生产密钥可独立轮换（换一个不用重启全站）；轮换步骤写成 runbook，
  不要只存在某个人脑子里。发现泄漏后的第一动作永远是轮换，见 §5。
- 最小权限：Cloudflare token 按 API / 账号 / TTL 收敛；Supabase `service_role` 只出现在服务端；
  R2 key 只给对应 bucket。被扫到的 key 权限越小，§6「只需轮换」的适用面越大。
- 环境隔离：生产密钥只活在运行环境（Dokploy Application Environment Variables、
  Cloudflare dashboard、GitHub Actions secrets），staging 与 production 互不复用；
  仓库里只允许 `*.example` 占位模板（参考 `web/.env.example`、
  `deploy/dokploy/.env.staging.example` 的占位写法）。

## 发现后的标准动作顺序

先轮换 → 再清理 → 最后复盘。顺序不能反，理由：清理历史（改写/删除）不吊销密钥，
攻击者手里的复本不会因为你删了 commit 就失效。

1. 轮换（0–24h）：吊销并重发所有命中密钥，按 §2 紧急度排序；确认新密钥生效、旧密钥已失效
   （调一次真实接口 inspi 验证，不要只看 dashboard 状态）。
2. 清理（轮换确认后）：按 §6 判定改写历史还是仅轮换；PR 描述只写脱敏指纹，
   不许贴密钥原文（即使已吊销）。
3. 复盘（7 天内）：补全漏掉的那一层（没装 hook？CI 没跑全量？allowlist 太宽？），
   落到 §8 清单或 BRAWUKA-228 的配置变更上；更新本文的误报模式库（§7）。

## 历史改写：适用条件、代价、协作事项

工具二选一：`git filter-repo`（官方推荐，功能全）或 BFG Repo-Cleaner（快，但只擅长删大文件/换文本）。
两者本地均未预装（2026-09-12 实测 `git filter-repo` 不存在），用前先装并在 §8 清单里记下安装方式。

适用条件（同时满足才改写）：

- 命中是真实密钥（§2 定义），且已确认轮换完成、旧值彻底失效；
- 仓库协作者少、或能召集到所有有 clone 的人（改写后旧 clone 里还有密钥，`git pull` 会产生诡异合并）；
- 有 force-push 权限与窗口（保护分支规则需临时放行，Owner 批准）。

代价：改写变更所有后续 commit SHA，open PR 全 rebase，CI 全重跑，fork 全部断裂。
公开仓库还要假设「密钥已被爬虫存档」——改写只是卫生动作，不降低轮换的优先级。

只需轮换、不值得改写历史的情况：

- 命中经 §2 判定是非密钥（占位符、测试值、anon key）：进 allowlist（§7），连轮换都不需要。
- 密钥已失效且是低权限/已下线服务（如 staging 已销毁）：轮换确认 + 记录即可，省下改写成本。
- 私有仓库 + 协作者多 + 密钥权限已收敛：轮换后把改写排到低优先级，不要为了一次性卫生中断所有人。

协作注意事项：改写前在仓库发公告（影响分支、时间窗口、之后每人必须重新 clone）；
改写后验证 `gitleaks git file://.` 干净且所有分支/tag 都被覆盖（`--all` 容易漏掉 stash 与
已删分支的 reflog，重要仓库加跑 `git fsck --lost-found` 抽查）。

## 误报治理规则

目标：allowlist 只压「已证明是误报」的模式，永远不许变成「关规则」。

允许进 allowlist 的（需同时满足）：

- 模式类误报，有至少两处独立命中证明是系统性的。已知实例：gitleaks `generic-api-key`
  规则命中测试文件内的 `*_KEY = "<测试 UUID>"` 赋值（如 `web/tests/checkins.test.ts`
  的幂等键 fixture——UUID 测试常量被当成 API key；值本身是假数据，不是密钥）。
- 写法限定：按文件路径 + 规则 ID 精确放行（如 `web/tests/**` + `generic-api-key`），
  不许全局关掉某条规则，更不许 `--exclude-detectors` 整类关闭。
- 占位模板（`*.example`、`samplesecret`、`your-*-here`）走 gitleaks 默认 allowlist 或
  仓库 `.gitleaks.toml` 的 allowlist 段，不要逐条加 ignore 注释。

审批：allowlist 变更与代码同评审（PR 内），BRAWUKA-228 的 owner 为默认审批人；
`gitleaks:allow` 行内注释视为 allowlist 的一种，同样需要评审，不许私自加。

防腐化：每季度（或每次复盘，§5）重跑 L4 全量，对比 allowlist 条目是否还在命中；
已无命中的条目删除；allowlist 文件本身纳入 CI 扫描（改 allowlist 的 PR 必须跑全量 job）。

## 新仓库上线检查清单

给新仓库（第 5 个及以后）照着做。逐项勾选，责任人填名。

首次配置：

- [ ] `.gitignore` 覆盖 `.env*`、`*.pem`、`*.key`、`*.p12`、`.dev.vars`、`.wrangler/`、
  云端 env 文件（如 `deploy/dokploy/.env.*`，只留 `*.example` 进仓库）——责任人：
- [ ] 仓库里只有 `*.example` 占位模板，逐个确认无真实值（跑一遍 L1 命令自证）——责任人：
- [ ] 本地 hook 一条命令装好（BRAWUKA-228 的安装脚本），新克隆验证：伪造 key 提交被拦、
  占位符提交放行——责任人：

CI 接入：

- [ ] 每次 push/PR 增量扫描 job 接入并设为合入门禁——责任人：
- [ ] 全历史扫描 job + 每周 cron 接入，baseline（含到期日）评审通过——责任人：
- [ ] allowlist 文件就位，首批条目有评审记录——责任人：

平台侧开关：

- [ ] Secret scanning 状态确认（可用/需 Advanced Security/无预算缺口）——责任人：
- [ ] Push protection 开启（或记录「不可用 + 补偿措施」）——责任人：
- [ ] 告警唯一接收人指定，dismiss 双人规则传达到——责任人：

运行时：

- [ ] 生产密钥全部来自运行环境注入，无一来自仓库文件——责任人：
- [ ] 轮换 runbook 存在且本季度演练过（或约好首次演练日期）——责任人：
- [ ] staging 与 production 密钥互不复用——责任人：

## 其余 3 个仓库的接入方式

本文命令跨仓库通用，逐个仓库落地时只做三处替换（以各仓库 BRAWUKA-227 取证结论为准，
先读结论再动手）：

- CanCan（`lyuzizheng/cancan`）：把 L1–L2 的扫描根目录换成该仓库根；若其已有
  `check-docs-consistency.sh` 同源脚本，allowlist 评审规则（§7）直接复用，只改审批人。
- Our Village（`Generation-Growth/our_village`，Go 服务端）：L4 另加文件名维度
  `git log --all --full-history -- "*.pem" "serviceAccountKey.json"`（Firebase/云服务私钥常见名）；
  其余层不变。
- LZZ Blog（`lyuzizheng/lzz-blog`）：静态站点，重点是 L2 全量 job 与 L3 平台开关；
  部署 token（Cloudflare/pages）按 §2 第 2 类处理。

各仓库的 hook/CI 实际 PR 由各仓库 owner 排期，本文不代劳；排期前先用 L4 命令自扫一遍，
有历史包袱的先走 §5 顺序（轮换优先），不要带着真密钥去配「防泄漏」。

## 命令速查

```bash
# L1 本地提交前
gitleaks protect --source . --staged --verbose --redact          # 期望：no leaks found / exit 0

# L2 CI 增量与全量
gitleaks detect --source . --log-opts="origin/main..HEAD" --verbose --redact
gitleaks git file://. --verbose --redact --report-format json --report-path /tmp/findings.json

# L4 取证二次确认（trufflehog v3 用法；旧版 --only-verified 等价于 --results=verified）
trufflehog git file://. --results=verified,unknown --json --fail  # 有命中 exit 183
trufflehog filesystem . --results=verified,unknown --json         # 工作区文件系统维度

# 文件名与内容定点核对
git log --all --full-history -- "*token*" "*secret*" "*.pem" "*.key"
git log --all -p -S 'BEGIN PRIVATE KEY' -- . ':!*.example'
```
