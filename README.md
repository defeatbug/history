# HistoriaQuest

游戏化的中国史 / 世界史学习应用。把课程、答题、间隔重复、勋章、博物馆文物与 AI 历史助教串成一条学习路径；后台提供课程、题目、历史事件、博物馆、文物与学习统计的内容管理。

![CI](https://github.com/defeatbug/history/actions/workflows/ci.yml/badge.svg)

- 仓库：`defeatbug/history`（包名仍是脚手架时期的 `vue-project`）
- 前端：Vue 3.5 + TypeScript 5.9 + Vite 7 + Pinia 3 + Vue Router 4 + Tailwind 3.4 + ECharts 6（按需注册、异步加载）
- 后端：Supabase（PostgreSQL + RLS + Storage + Edge Function）
- 测试：Vitest（算法与纯函数单测）

产品边界与"明确不做"的范围见 [PRODUCT.md](PRODUCT.md)；论文改造记录与路线图见 [docs/毕业论文改进方案.md](docs/毕业论文改进方案.md)。

## 快速开始

要求 Node `^20.19.0 || >=22.12.0`。

```bash
npm ci                 # 安装依赖（锁定 lockfile）
cp .env.example .env   # 填入 Supabase 项目地址与 anon key
npm run dev            # 启动开发服务器
```

没有配置 Supabase 时，前端会降级到本地 mock 数据，可以浏览课程与博物馆；但登录、进度同步、错题本、后台等功能需要真实后端。

### 环境变量

只有两个变量，均为 Supabase 公开信息：

| 变量 | 说明 |
| :--- | :--- |
| `VITE_SUPABASE_URL` | Supabase 项目 URL |
| `VITE_SUPABASE_KEY` | Supabase anon / publishable key |

AI 密钥**不在前端**：`chat` Edge Function 在服务端读取 `DEEPSEEK_API_KEY`，浏览器只与本项目的函数通信。

```bash
npx supabase secrets set DEEPSEEK_API_KEY=sk-xxxx
npm run fn:deploy
```

### 数据库初始化

按顺序执行 `supabase/migrations/` 下的 15 个迁移（`20250101000000` – `20250101000014`），再由 seed 迁移写入课程、题目、历史事件、学习路径、博物馆、文物与勋章定义。

```bash
npm run cloud:setup    # 首次：关联云端项目 + 推送迁移 + 自检
npm run cloud:check    # 自检：表、视图、函数、RLS 是否齐全
npm run cloud:e2e      # API 层端到端冒烟（非浏览器 UI 测试）
```

本地数据库可用 `npm run db:start` / `db:reset` / `db:stop`，或裸 PG 工具 `npm run db:local:up`。

### 管理员账号

单管理员模式：注册普通账号后，在数据库中把该账号的 `profiles.role` 改为 `admin` 即可进入 `/admin`。前端的路由守卫只是界面层拦截，真正的权限边界是 RLS 与 `is_admin()`。

## 功能

### 学习端

- **首页 / 课程列表**：进度概览、断点续学入口、按难度与文明筛选
- **课程学习**：逐题作答、即时解析、完成结算（学习时长、正确率、勋章判定）
- **错题本**：按待复习 / 已掌握筛选，展示答错次数、连续答对与下次复习时间
- **间隔重复复习**：SM-2 调度，复习结果回写 `user_answers`
- **知识时间线 / 历史事件**：搜索、分类浏览、事件详情与相关事件跳转
- **博物馆**：博物馆与文物详情，图片缺失时降级为 emoji
- **学习统计**：完成课程、勋章、学习时长、连续学习天数，近 7 天答题趋势与各课程正确率图表（ECharts）
- **好友**：按用户名搜索并发送请求、接受 / 拒绝、删除好友；好友战绩与在线状态（Realtime Presence）；全局导航红点提示待处理请求与挑战
- **好友 PK**：向好友发起挑战、对方应战后进入同一房间作答；实时比分同步、双方各自答完自动结算、逐题复盘、历史战绩；一方超过 10 分钟未作答按超时判负（离线也会在下次打开时结算）
- **AI 历史助教**：通过 `chat` Edge Function 流式回答

### 管理后台（`/admin`）

- 概览、课程、题目、历史事件、学习路径、博物馆、文物、勋章（只读）、学习统计
- 课程看板支持跨难度拖拽（拖拽即修改难度）、影响面常驻（学生数 / 答题记录数）
- 学习路径（时间轴）双分支 CRUD：按中国史 / 世界史分栏、栏内拖拽排序、关联课程、新建 / 编辑 / 删除
- 图片上传到 `media` bucket（canvas 压缩，≤5MB），删除课程 / 事件前展示影响面并要求二次确认
- 学习统计页含近 14 天答题活跃度与完成课程数分布两张 ECharts 图
- 窄屏下侧栏变为抽屉，宽表格可横向滚动

> 好友与 PK 的规则（好友请求不变量、题目抽取、答案判定、比分结算、10 分钟超时判负）全部在数据库 RPC 中实现（迁移 13 / 14），前端只提交「选了第几项」；实时比分与好友请求通过 Supabase Realtime 推送。

## 目录结构

```
src/
  main.ts / App.vue        应用入口与根组件
  router/index.ts          路由与登录 / 管理员守卫
  stores/                  Pinia：user、lesson、review、friend（counter 为脚手架残留）
  services/                ai、content、progress、review、admin、friends、pk、stats（Supabase 访问层）
  lib/supabase.ts          Supabase 客户端（未配置时降级）
  data/                    课程 / 历史事件 / 博物馆的本地 mock 与类型
  utils/                   SM-2、图片压缩、ID 序列、事件关联、PK 展示派生、统计聚合等纯函数（含单测）
  components/              通用组件（课程卡、知识卡、AI 助手、后台上传器、charts/ 图表容器等）
  views/                   学习端页面；views/admin/ 为后台页面
supabase/
  migrations/              15 个迁移：表 + RLS + 函数/触发器 + 视图 + 好友/PK + 超时结算 + 种子数据
  functions/chat/          DeepSeek 代理（密钥服务端保管、限流）
scripts/                   云端初始化、自检、E2E、SQL bundle 等
```

## 常用脚本

| 命令 | 作用 |
| :--- | :--- |
| `npm run dev` / `build` / `preview` | 开发 / 类型检查 + 构建 / 预览产物 |
| `npm run type-check` | `vue-tsc --build` |
| `npm run lint` / `format` | ESLint 自动修复 / Prettier 格式化 `src/` |
| `npm test` | Vitest 单测 |
| `npm run db:*` | 本地 Supabase 启停与重置 |
| `npm run cloud:*` | 云端初始化、自检、API 冒烟 |
| `npm run fn:deploy` / `fn:test` | 部署 / 测试 AI Edge Function |

## 质量保障

- GitHub Actions（`.github/workflows/ci.yml`）：PR / push 到 `dev` 时执行类型检查、ESLint（`src` + `scripts`）、Vitest 与生产构建
- 本地对应命令：`npm run type-check`、`npx eslint src scripts`、`npm test`、`npm run build`

## 已知限制

- PK 是「同一套题、各自作答、实时比分」的异步房间，不做同题倒计时抢答、匹配队列与排行榜
- PK 超时阈值固定 10 分钟：服务端在读取对局时结算，不保证在超时瞬间实时踢人
- 好友在线状态依赖 Realtime Presence，只表示「当前打开了页面」，不持久化最后在线时间
- 题型只有单选（数据中两条 `matching` 题为占位，未实现连线交互）
- 无浏览器 E2E、无 PWA；图片资源体积未优化（ECharts 为按需异步 chunk，不进首屏）
- 学习时长在课程完成时结算，中途退出不计时
- 后台按产品决策不做分页、批量操作、草稿与软删除

## 文档

- [PRODUCT.md](PRODUCT.md)：产品事实、原则与明确不做的事
- [docs/毕业论文改进方案.md](docs/毕业论文改进方案.md)：问题清单、优先级、数据库设计与实施记录
- [.impeccable/surfaces/admin.md](.impeccable/surfaces/admin.md)：后台视觉与交互契约