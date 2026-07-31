# Coffee Mode — Vite → Next.js 迁移计划

> 创建日期：2026-07-31
> 状态：待执行
> 分支：`feat/nextjs-migration`

---

## 1. 可行性评估

### 1.1 项目现状

| 维度 | 现状 |
|---|---|
| 规模 | ~70 个源文件，单页应用（无路由） |
| 框架 | React 19 + Vite 6 + TypeScript 5.7 |
| 样式 | TailwindCSS v4 + Shadcn UI (Radix) |
| 数据 | Tanstack Query v5 + Axios |
| 地图 | 抽象层（Google Maps JS API + MapLibre GL / OpenFreeMap） |
| 状态管理 | 3 个 Context Provider（Config / User / Query） |
| 环境变量 | `import.meta.env.VITE_*` |
| 构建 | `tsc -b && vite build` |

### 1.2 为什么现在迁移

1. **成本最低点** — 项目只有一个页面（`App.tsx`），没有路由，迁移工作量最小
2. **路由需求迫近** — Cafe 详情页、用户 Profile、登录页都要加，与其装 react-router 不如直接上 Next.js 文件路由
3. **SEO 是刚需** — "新加坡适合工作的咖啡店" 这类搜索流量对产品的生死攸关，SSR/SSG 是必须的
4. **CORS 消灭** — Next.js API Routes 代理 Spring 后端，前后端同源，开发体验大幅提升
5. **已有信号** — `package.json` 里已经装了 `next-themes`，说明之前就考虑过

### 1.3 主要挑战

| 挑战 | 难度 | 说明 |
|---|---|---|
| 地图组件 (Google Maps / MapLibre) | ⭐⭐ | 纯客户端，需 `"use client"` + `dynamic(() => import(...), { ssr: false })` |
| TailwindCSS v4 配置 | ⭐ | `@tailwindcss/vite` → `@tailwindcss/postcss`，CSS 变量和 `@theme inline` 语法不变 |
| `import.meta.env` → `process.env` | ⭐ | 全局替换，改成 `NEXT_PUBLIC_*` 前缀 |
| `window` / `document` / `navigator` 引用 | ⭐⭐ | 地图和 geolocation 相关，加客户端守卫 |
| Google Maps 脚本注入 | ⭐ | 手动 `createElement("script")` → `next/script` lazy 加载 |
| MapLibre CSS 导入 | ⭐ | 组件内 `import "maplibre-gl/dist/maplibre-gl.css"` → 全局 CSS `@import` |

### 1.4 结论

**完全可行，建议执行。** 预估总工期 ~5.5 天。

---

## 2. 迁移策略

采用**并行项目**策略：在同级目录创建 `coffeemode-next/`，旧项目 `coffeemode-frontend/` 保持不动，直到新项目验证通过后再切换。

```
coffeemode/
├── coffeemode-frontend/   # 旧 Vite 项目（保持不动）
├── coffeemode-next/       # 新 Next.js 项目（迁移目标）
└── coffeemode-backend/    # Spring 后端（不变）
```

---

## 3. 分阶段执行计划

### Phase 0：项目初始化（~0.5 天）

**目标：Next.js 骨架跑起来，TailwindCSS 主题对齐**

#### 0.1 创建分支

```bash
git checkout -b feat/nextjs-migration
```

#### 0.2 初始化 Next.js 项目

```bash
npx create-next-app@latest coffeemode-next \
  --typescript --tailwind --eslint --app --src-dir \
  --import-alias "@/*" --use-pnpm
```

选择：
- App Router（不是 Pages Router）
- TypeScript
- TailwindCSS（create-next-app 会配置 v4 + `@tailwindcss/postcss`）
- ESLint
- `src/` 目录
- `@/*` import alias

#### 0.3 对齐 TailwindCSS v4 主题

1. 把 `coffeemode-frontend/src/index.css` 的内容复制到 `coffeemode-next/src/app/globals.css`
2. 确认 `postcss.config.mjs` 使用 `@tailwindcss/postcss`（create-next-app 默认配置）
3. 删除 `tailwind.config.ts`（TailwindCSS v4 不需要 JS 配置文件，所有配置在 CSS 里）
4. 验证：`pnpm dev` 后页面背景色应该是 `hsl(44.00 42.86% 93.14%)`（暖米色）

#### 0.4 复制静态资源

```bash
# 图片、SVG 等
cp -r coffeemode-frontend/src/assets/ coffeemode-next/src/assets/

# Google Maps 本地代理脚本
cp coffeemode-frontend/public/js/mapsJavaScriptAPI.js coffeemode-next/public/js/
```

#### 0.5 安装额外依赖

```bash
cd coffeemode-next
pnpm add @tanstack/react-query @tanstack/react-query-devtools axios maplibre-gl sonner next-themes
pnpm add -D @types/google.maps
```

> Shadcn UI 组件通过 CLI 按需安装：`pnpm dlx shadcn@latest add button card input dialog avatar badge tooltip scroll-area`

#### 0.6 验证

- [ ] `pnpm dev` 启动无报错
- [ ] 页面显示正确的背景色和字体
- [ ] `pnpm build` 成功

---

### Phase 1：基础设施层（~1 天）

**目标：Providers、API 客户端、工具函数、类型定义全部就位**

#### 1.1 环境变量迁移

创建 `coffeemode-next/.env.local`：

```env
# 前端可见（NEXT_PUBLIC_ 前缀）
NEXT_PUBLIC_API_URL=http://localhost:8080
NEXT_PUBLIC_ENABLE_ANALYTICS=false
NEXT_PUBLIC_ENABLE_NOTIFICATIONS=false

# 仅服务端可见（API 代理用）
BACKEND_API_URL=http://localhost:8080
```

对照表：

| Vite (旧) | Next.js (新) | 说明 |
|---|---|---|
| `VITE_API_URL` | `NEXT_PUBLIC_API_URL` | 客户端 API 地址 |
| `VITE_ENABLE_ANALYTICS` | `NEXT_PUBLIC_ENABLE_ANALYTICS` | 功能开关 |
| `VITE_ENABLE_NOTIFICATIONS` | `NEXT_PUBLIC_ENABLE_NOTIFICATIONS` | 功能开关 |
| `import.meta.env.VITE_*` | `process.env.NEXT_PUBLIC_*` | 访问方式 |
| `import.meta.env.MODE` | `process.env.NODE_ENV` | 环境判断 |
| — | `BACKEND_API_URL` | 🆕 服务端代理用，不暴露给客户端 |

#### 1.2 直接复制（无需改动）的文件

```
src/lib/utils.ts                    # cn() 函数
src/types/cafe.ts                   # Cafe 类型
src/types/user.ts                   # User 类型
src/types/api.ts                    # ApiResponse 类型
src/types/googleMaps.ts             # Google Maps 类型
src/types/linkPreview.ts            # Link Preview 类型
src/types/google-maps.d.ts          # Google Maps 全局声明
src/constants/storage.ts            # localStorage keys
src/constants/user.ts               # 用户常量
src/hooks/useLocalStorage.ts        # localStorage hook
src/hooks/useLinkPreview.ts         # 链接预览 hook
src/hooks/cafe/useCafe.ts           # Cafe 查询 hooks
src/hooks/cafe/index.ts             # barrel export
src/hooks/googleMaps/useResolvePlace.ts  # Google Maps 解析 hook
src/services/api.ts                 # Axios 客户端
src/services/googleMaps.ts          # Google Maps 服务
src/services/linkPreview.ts         # 链接预览服务
```

#### 1.3 需要改动的文件

**`src/providers/ConfigProvider.tsx`** — 环境变量访问方式：

```typescript
// 改前
apiUrl: import.meta.env.VITE_API_URL || "http://localhost:3000",
environment: (import.meta.env.MODE as AppConfig["environment"]) || "development",
features: {
  enableAnalytics: import.meta.env.VITE_ENABLE_ANALYTICS === "true",
  enableNotifications: import.meta.env.VITE_ENABLE_NOTIFICATIONS === "true",
},

// 改后
apiUrl: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080",
environment: (process.env.NODE_ENV as AppConfig["environment"]) || "development",
features: {
  enableAnalytics: process.env.NEXT_PUBLIC_ENABLE_ANALYTICS === "true",
  enableNotifications: process.env.NEXT_PUBLIC_ENABLE_NOTIFICATIONS === "true",
},
```

**`src/providers/Providers.tsx`** — 加客户端指令：

```typescript
"use client";  // ← 加在文件第一行

import { ReactNode } from "react";
// ... 其余不变
```

**`src/providers/QueryProvider.tsx`** — 加客户端指令：

```typescript
"use client";  // ← 加在文件第一行
// ... 其余不变
```

**`src/providers/UserProvider.tsx`** — 加客户端指令：

```typescript
"use client";  // ← 加在文件第一行
// ... 其余不变
```

**`src/services/api.ts`** — SSR 安全守卫：

```typescript
export const getApiClient = (baseUrl: string): AxiosInstance => {
  // SSR 环境下不缓存实例（每次请求创建新的）
  if (typeof window === "undefined") {
    return axios.create({
      baseURL: baseUrl,
      headers: { "Content-Type": "application/json" },
      timeout: 10000,
    });
  }

  // 客户端：使用单例
  if (!apiClientInstance) {
    // ... 原有逻辑不变
  }
  apiClientInstance.defaults.baseURL = baseUrl;
  return apiClientInstance;
};
```

#### 1.4 复制 Shadcn UI 组件

从旧项目复制 `src/components/ui/` 下所有文件：

```
button.tsx, card.tsx, input.tsx, dialog.tsx, avatar.tsx,
badge.tsx, tooltip.tsx, scroll-area.tsx, sonner.tsx, alert.tsx, index.ts
```

这些组件不需要改动（已经是标准的 Shadcn 组件）。

#### 1.5 验证

- [ ] `pnpm build` 无类型错误
- [ ] 在测试页面中渲染 `<Button>` 确认 Shadcn 样式正确
- [ ] 确认 `useConfig()` 返回正确的 `apiUrl`

---

### Phase 2：地图层迁移（~1.5 天）⭐ 最核心

**目标：地图抽象层在 Next.js 中正常工作**

#### 2.1 文件清单

```
src/components/map/
├── types/types.ts           # IMapProvider 接口（不改）
├── MapContainer.tsx         # 统一容器（改：dynamic import）
├── GoogleMap.tsx            # Google Maps 实现（改：next/script）
├── OpenFreeMap.tsx          # MapLibre 实现（改：CSS 导入方式）
├── LocateMeButton.tsx       # 定位按钮（不改）
├── openmapstyle_light.json  # MapLibre 样式（不改）
├── openmapstyle.json        # MapLibre 样式备用（不改）
├── style.json               # Google Maps 样式（不改）
└── index.ts                 # barrel export（不改）
```

#### 2.2 所有地图组件加 `"use client"`

在以下文件第一行加 `"use client";`：
- `MapContainer.tsx`
- `GoogleMap.tsx`
- `OpenFreeMap.tsx`
- `LocateMeButton.tsx`

#### 2.3 MapContainer.tsx — 动态导入地图实现

```typescript
"use client";

import dynamic from "next/dynamic";

// 替换直接 import，使用 dynamic + ssr: false
const OpenFreeMap = dynamic(() => import("./OpenFreeMap"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-muted animate-pulse flex items-center justify-center">
      <span className="text-muted-foreground text-sm">Loading map...</span>
    </div>
  ),
});

const GoogleMap = dynamic(() => import("./GoogleMap"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-muted animate-pulse flex items-center justify-center">
      <span className="text-muted-foreground text-sm">Loading map...</span>
    </div>
  ),
});
```

#### 2.4 MapContainer.tsx — Geolocation 守卫

```typescript
// 改前
useEffect(() => {
  if (!navigator.geolocation) { ... }
  // ...
}, []);

// 改后
useEffect(() => {
  if (typeof window === "undefined" || !navigator.geolocation) {
    console.warn("Geolocation is not supported by this browser.");
    return;
  }
  // ... 其余不变
}, []);
```

#### 2.5 GoogleMap.tsx — 用 next/script 替代手动脚本注入

```typescript
"use client";

import Script from "next/script";

// 删除 useEffect 中的 document.createElement("script") 逻辑
// 改为在 JSX 中渲染：

return (
  <>
    <Script
      src="/js/mapsJavaScriptAPI.js"
      strategy="lazyOnload"
      onLoad={() => {
        if (!googleMapInstanceRef.current && window.initMap) {
          window.initMap();
        }
      }}
      onError={() => console.error("Google Maps script failed to load.")}
    />
    <div
      ref={mapRef}
      className={cn("w-full h-full", className)}
      aria-label="Google Map"
      tabIndex={0}
    />
  </>
);
```

同时简化 `useEffect`：只负责初始化地图（`window.initMap` 的定义），不再负责脚本加载。

#### 2.6 OpenFreeMap.tsx — CSS 导入方式

```typescript
// 改前（组件内导入，Next.js 不允许）
import "maplibre-gl/dist/maplibre-gl.css";

// 改后：删除组件内的 CSS import
// 在 src/app/globals.css 顶部添加：
// @import "maplibre-gl/dist/maplibre-gl.css";
```

#### 2.7 验证

- [ ] OpenFreeMap 默认加载正常，地图瓦片渲染
- [ ] Google Maps 切换后加载正常
- [ ] LocateMe 按钮触发 geolocation 并居中
- [ ] 地图拖拽/缩放后 `onViewChange` 回调正常
- [ ] `pnpm build` 无 SSR 相关报错（`window is not defined` 等）

---

### Phase 3：页面路由搭建（~1 天）

**目标：建立 App Router 页面结构，首页 = 当前地图视图**

#### 3.1 目录结构

```
src/app/
├── layout.tsx              # 根布局（Providers + metadata）
├── page.tsx                # 首页 = 地图视图
├── globals.css             # 全局样式（原 index.css）
├── cafe/
│   └── [id]/
│       └── page.tsx        # Cafe 详情页（Phase 6 实现，先建占位）
├── profile/
│   └── page.tsx            # 用户 Profile（Phase 6 实现，先建占位）
└── api/
    └── [...proxy]/
        └── route.ts        # API 代理 → Spring 后端
```

#### 3.2 根布局 `src/app/layout.tsx`

```tsx
import type { Metadata } from "next";
import { Providers } from "@/providers/Providers";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Coffee Mode — Find Your Perfect Work Spot",
    template: "%s | Coffee Mode",
  },
  description:
    "Discover cafes, libraries, and public spaces in Singapore with reliable Wi-Fi, power outlets, and the right vibe for working and studying.",
  keywords: ["cafe", "singapore", "remote work", "study spot", "wifi", "coworking"],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

#### 3.3 首页 `src/app/page.tsx`

```tsx
"use client";

import { CafeCarousel } from "@/components/cafe";
import { Header } from "@/components/layout";
import MapContainer from "@/components/map/MapContainer";
import { AddPlaceButton } from "@/components/ui";

export default function HomePage() {
  return (
    <div className="relative h-screen overflow-hidden bg-background">
      {/* Map Background */}
      <MapContainer className="absolute inset-0 w-full h-full z-0" />

      {/* Floating Header */}
      <Header className="absolute top-4 left-4 right-4 z-20" />

      {/* Cafe Carousel */}
      <div className="absolute bottom-4 left-0 right-0 px-4 z-10">
        <CafeCarousel />
      </div>

      {/* Add New Place FAB */}
      <AddPlaceButton className="absolute bottom-28 right-4 z-10" />
    </div>
  );
}
```

> 这就是原 `App.tsx` 的内容，几乎零改动。

#### 3.4 API 代理 `src/app/api/[...proxy]/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_API_URL || "http://localhost:8080";

// 通用代理：转发所有 /api/* 请求到 Spring 后端
async function proxyRequest(req: NextRequest, { params }: { params: Promise<{ proxy: string[] }> }) {
  const { proxy } = await params;
  const path = proxy.join("/");
  const searchParams = req.nextUrl.searchParams.toString();
  const url = `${BACKEND_URL}/api/${path}${searchParams ? `?${searchParams}` : ""}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // 转发认证 token（如果有）
  const authHeader = req.headers.get("authorization");
  if (authHeader) {
    headers["Authorization"] = authHeader;
  }

  const fetchOptions: RequestInit = {
    method: req.method,
    headers,
  };

  // GET/HEAD 不带 body
  if (req.method !== "GET" && req.method !== "HEAD") {
    fetchOptions.body = await req.text();
  }

  try {
    const response = await fetch(url, fetchOptions);
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      { code: 502, message: "Backend unavailable", data: null },
      { status: 502 }
    );
  }
}

export const GET = proxyRequest;
export const POST = proxyRequest;
export const PUT = proxyRequest;
export const PATCH = proxyRequest;
export const DELETE = proxyRequest;
```

**使用方式：** 前端 `NEXT_PUBLIC_API_URL` 设为空字符串或 `/`，所有 `/api/*` 请求自动走 Next.js 代理 → Spring 后端。CORS 问题彻底消失。

#### 3.5 验证

- [ ] `pnpm dev` → 首页显示完整地图视图
- [ ] Header、CafeCarousel、AddPlaceButton 位置正确
- [ ] `/api/cafes/nearby?lat=1.32&lng=103.82` 通过代理返回数据
- [ ] `pnpm build` 成功

---

### Phase 4：业务组件迁移（~1 天）

**目标：所有交互组件在 Next.js 中正常工作**

#### 4.1 需要加 `"use client"` 的组件

| 文件 | 原因 |
|---|---|
| `components/layout/Header.tsx` | onClick handlers |
| `components/layout/AddPlaceButton.tsx` | onClick + Dialog 状态 |
| `components/cafe/CafeCard.tsx` | 可能有交互 |
| `components/cafe/CafeCarousel.tsx` | 滚动交互 |
| `components/cafe/create/CreateCafeModal.tsx` | Dialog + 表单状态 |
| `components/cafe/create/GoogleMapsImport.tsx` | 表单 + mutation |
| `components/cafe/create/CreateOptions.tsx` | 选项切换 |
| `components/cafe/create/ManualCreation.tsx` | 表单 |

#### 4.2 直接复制无需改动的

- `components/layout/index.ts`（barrel export）
- `components/cafe/index.ts`（barrel export）
- `components/map/index.ts`（barrel export）
- 所有 `.md` 文档文件

#### 4.3 验证

- [ ] Create Cafe Modal 打开/关闭正常
- [ ] Google Maps 链接粘贴 → 解析 → 预览正常
- [ ] Cafe Carousel 数据加载和滚动正常
- [ ] 所有按钮点击有响应
- [ ] Dark mode 切换正常（如果已接入 next-themes）

---

### Phase 5：验证 & 清理（~0.5 天）

#### 5.1 完整功能验证清单

- [ ] `pnpm build` — 零错误零警告
- [ ] `pnpm lint` — 零错误
- [ ] 地图加载（OpenFreeMap 默认）
- [ ] 地图切换（Google Maps）
- [ ] Geolocation 定位 + 地图居中
- [ ] 地图拖拽/缩放
- [ ] Cafe Carousel 数据加载
- [ ] Create Cafe Modal 完整流程
- [ ] Dark mode 切换
- [ ] 响应式布局（iPhone SE / iPad / Desktop）
- [ ] API 代理正常转发
- [ ] 页面刷新后状态正常（无 hydration mismatch）

#### 5.2 清理旧文件

在 `coffeemode-next/` 中确认不需要：
- ~~`vite.config.ts`~~（不存在于新项目）
- ~~`src/main.tsx`~~（被 `app/layout.tsx` 替代）
- ~~`src/App.tsx`~~（被 `app/page.tsx` 替代）
- ~~`src/vite-env.d.ts`~~（Vite 专用）
- ~~`src/App.css`~~（未使用）

#### 5.3 更新 package.json scripts

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  }
}
```

#### 5.4 更新文档

- 更新 `repo_notes.md` 反映新架构
- 更新 `.cursorrules` 中的 Terminal Running Guide
- 更新 CI/CD 配置（如果有）

#### 5.5 切换

验证全部通过后：
```bash
# 方案 A：重命名
mv coffeemode-frontend coffeemode-frontend-vite-backup
mv coffeemode-next coffeemode-frontend

# 方案 B：保留两个，逐步切换流量
```

---

### Phase 6（迁移后增量）：利用 Next.js 特性

这些不是迁移必须的，但迁移后自然可以做：

| 特性 | 价值 | 优先级 |
|---|---|---|
| Cafe 详情页 SSR/ISR | SEO — Google 搜索 "singapore cafe wifi" 直接命中 | 🔴 高 |
| `next/image` | 咖啡店图片自动优化、lazy load、WebP 转换 | 🟡 中 |
| `next/font` | 字体优化，消除 FOUT/FOIT | 🟡 中 |
| Server Components | 静态部分（Header logo、footer）不走 JS bundle | 🟡 中 |
| `next-themes` 接入 | 已安装，直接接入 dark mode 切换 | 🟢 低 |
| Middleware 鉴权 | 登录拦截、路由保护 | 🟢 低（等 auth 做好后） |
| OG Image 生成 | 社交分享卡片自动生成 | 🟢 低 |
| Sitemap / robots.txt | SEO 基础设施 | 🟡 中 |

---

## 4. 时间线总结

| Phase | 内容 | 预估 | 依赖 |
|---|---|---|---|
| 0 | 项目初始化 + 主题对齐 | 0.5 天 | — |
| 1 | Providers / API / 工具函数 | 1 天 | Phase 0 |
| 2 | 地图层迁移（最核心） | 1.5 天 | Phase 1 |
| 3 | 页面路由 + API 代理 | 1 天 | Phase 1 |
| 4 | 业务组件搬迁 | 1 天 | Phase 2 + 3 |
| 5 | 验证 + 清理 + 切换 | 0.5 天 | Phase 4 |
| **总计** | | **~5.5 天** | |

> Phase 2 和 Phase 3 可以并行（地图层和路由层互不依赖），如果两人协作可压缩到 ~4 天。

---

## 5. 风险与回退

| 风险 | 概率 | 影响 | 缓解措施 |
|---|---|---|---|
| MapLibre + Next.js SSR 兼容问题 | 中 | 中 | `dynamic import + ssr: false` 是成熟方案，社区有大量参考 |
| Google Maps 脚本加载时序 | 低 | 中 | `next/script` 的 `onLoad` 回调保证时序 |
| TailwindCSS v4 + Next.js 兼容 | 低 | 低 | Next.js 15 已原生支持 TailwindCSS v4 |
| Hydration mismatch | 中 | 低 | 地图组件全部 `ssr: false`，避免服务端渲染 |
| 迁移后性能回退 | 低 | 低 | Next.js 的代码分割更细粒度，理论上更快 |

**回退方案：** 旧项目 `coffeemode-frontend/` 在整个迁移过程中保持不动，任何时候都可以切回。

---

## 6. 文件迁移对照表

| 旧路径 (Vite) | 新路径 (Next.js) | 改动 |
|---|---|---|
| `src/main.tsx` | `src/app/layout.tsx` | 重写 |
| `src/App.tsx` | `src/app/page.tsx` | 加 `"use client"` |
| `src/index.css` | `src/app/globals.css` | 加 maplibre CSS import |
| `src/vite-env.d.ts` | 删除 | — |
| `vite.config.ts` | `next.config.ts` | 重写 |
| `src/providers/*` | `src/providers/*` | 加 `"use client"` + env 变量 |
| `src/components/ui/*` | `src/components/ui/*` | 不变 |
| `src/components/map/*` | `src/components/map/*` | 加 `"use client"` + dynamic import |
| `src/components/layout/*` | `src/components/layout/*` | 加 `"use client"` |
| `src/components/cafe/*` | `src/components/cafe/*` | 加 `"use client"` |
| `src/hooks/*` | `src/hooks/*` | 不变 |
| `src/services/*` | `src/services/*` | SSR 守卫 |
| `src/types/*` | `src/types/*` | 不变 |
| `src/constants/*` | `src/constants/*` | 不变 |
| `src/lib/utils.ts` | `src/lib/utils.ts` | 不变 |
| `src/assets/*` | `src/assets/*` 或 `public/` | 不变 |
| `public/js/mapsJavaScriptAPI.js` | `public/js/mapsJavaScriptAPI.js` | 不变 |
| — | `src/app/api/[...proxy]/route.ts` | 🆕 API 代理 |
| — | `.env.local` | 🆕 环境变量 |

---

## 7. 参考资料

- [Next.js App Router 文档](https://nextjs.org/docs/app)
- [Next.js + MapLibre GL 示例](https://github.com/vercel/next.js/tree/canary/examples/with-mapbox)
- [next/script 文档](https://nextjs.org/docs/app/api-reference/components/script)
- [next/dynamic 文档](https://nextjs.org/docs/app/api-reference/functions/dynamic)
- [TailwindCSS v4 + Next.js](https://tailwindcss.com/docs/installation/framework-guides/nextjs)
- [Shadcn UI + Next.js](https://ui.shadcn.com/docs/installation/next)
