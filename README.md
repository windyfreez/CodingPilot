# CodingPilot

本地优先（Local-First）的 **AI 开发工作台**：既能管理你散落在各盘符的本地代码资产（项目扫描、Git 状态、磁盘画像、Markdown 笔记、一键启停 IDE/服务/终端），也能统计你与 AI 协作的产出——**Agent Token 用量与消费**、**当日工作量与"Agent 写 vs 自己写"的代码行归属**。

基于 **Electron + Vue 3 + TypeScript + Vite（electron-vite）** + Element Plus + ECharts + better-sqlite3 构建，支持 Windows / macOS。

> 前身：ProjectPilot（本地项目管理系统）。引入 AI 用量与工作量统计后更名为 CodingPilot。

---

## ✨ 功能总览

### 📊 项目资产与数据统计（原有能力）
| 模块 | 功能 |
| --- | --- |
| **仪表盘** | 核心指标卡（项目总数 / 活跃项目 / 占用空间 / 远程关联率）、技术栈环形图、框架细分条形图、GitHub 风格提交热力图（近 365 天）、项目健康度、空间大户 Top 10 |
| **自动扫描与识别** | 多根目录递归扫描（fast-glob），按特征文件识别技术栈（`package.json`/`pom.xml`/`go.mod`/`requirements.txt`/`Cargo.toml`…），自动跳过 `node_modules`/`target`/`dist` 等 |
| **项目列表与检索** | 模糊搜索、技术栈 / 生命周期 / 标签 / Git 状态多维筛选、多种排序、自定义标签 |
| **快捷操作** | 一键打开 IDE（VS Code/IDEA/WebStorm/PyCharm/GoLand/CLion）、系统文件夹、终端，直达 GitHub/Gitee 远程仓库 |
| **Git 集成** | 分支 / 脏状态 / 超前落后 / 30 天提交数 / 最近提交；状态缓存、全量同步、提交热力图数据 |
| **项目详情** | 生命周期管理、Markdown 备忘录（TODO 统计、Ctrl+S 保存）、后台服务快捷启停（自动推断启动命令 + 实时日志） |

### 🤖 Agent 用量统计（token / 消费）
- **本地记录自动采集**：读取三个 AI 工具的本地会话记录并归一化入库，全程本地解析、不上传：
  - **DeepSeek Harness**：`~/.dsh/sessions/**/session.jsonl.zstd`（zstd 容器，纯 JS 解码，自动按项目 slug 关联工作目录）
  - **Claude Code**：`~/.claude/projects/<目录slug>/<会话>.jsonl`（含子代理会话，`Write/Edit/MultiEdit` 改动归属）
  - **Codex CLI**：`~/.codex/sessions/<Y>/<M>/<D>/rollout-*.jsonl`（用量取自 `token_count`，改动取自 `patch_apply_end`）
- 增量同步：按文件大小/时间游标跳过未变化文件；启动后自动同步一次，之后按设置间隔（默认 15 分钟）自动刷新，也可在页面手动「立即同步」。
- **会话 ↔ 项目自动关联**：会话工作目录（或 slug）自动匹配已纳管项目，用量可下钻到项目维度。
- **用量统计页**：今日 / 本月 / 累计 token 与消费卡片；近 30 天按日堆叠趋势（输入/输出/缓存/推理）；消费趋势折线；按工具 / 模型 / 项目分布图；最近会话明细表。
- **消费估算**：日志大多不含金额，按设置页维护的「模型单价表」（支持 `*` 通配）由 token 估算；工具自带 cost 时优先用真实值。
- 多 Agent 维度：Harness 子代理、Claude 子代理会话各自成行统计，父会话通过 `parent_external_id` 关联。

### 📈 当日工作量统计
- **git 维度（按日聚合）**：提交数、改动文件数、增删行（`git log --numstat`，按 项目×日期×作者），支持选任意日期回看；增量同步，未变化仓库自动跳过。
- **代码归属（Agent vs 自己）**：
  - Agent 写入行 = 来自上述工具会话日志中的文件写操作（精确）；
  - git 提交增行 = 当日提交总量；
  - 自己手写 ≈ git 增行 − Agent 增行（差值，可在工作量页按项目手动修正覆盖）。
- **手动补录**：接口/功能、修复问题、文档/设计等工具覆盖不到的杂项按日补录，与自动指标同页展示。
- **当日工作量页**：顶部指标卡（提交/文件/增删行/Agent 写入行）、归属对照卡、按项目明细（含作者维度展开、Agent 行、自己手写修正）、手动补录列表。

### ⚙️ 设置
- 扫描根目录 / 默认 IDE / 默认服务命令 / 自动扫描与间隔 / 扫描日志。
- **Agent 用量采集**：三个工具的记录目录覆盖（默认 `~/.claude`、`~/.codex`、`~/.dsh`）、自动采集开关与间隔、模型单价表维护。

---

## 🚀 快速开始

### 环境要求
- Node.js ≥ 18（在 Node 22+/25、npm 11 上验证）
- Windows 10+ 或 macOS

### 安装与开发
```bash
npm install          # postinstall 自动为 Electron 重建 better-sqlite3
npm run dev          # 开发模式（Vite HMR + Electron 窗口）
npm run typecheck    # 类型检查
npm run build        # 仅编译产物到 out/
```

### 使用流程
1. **设置 → 扫描根目录**：添加本地代码根目录（如 `D:/Codespace/Code`）→ 立即扫描；
2. 在 **项目列表 / 项目详情** 管理项目、打开 IDE/终端/远程、记录笔记、启停服务；
3. 在 **用量统计** 查看 Agent token/消费（可先点「立即同步」拉取一次历史记录）；
4. 在 **当日工作量** 选择日期，点「同步 Git 工作量」查看当天产出与 Agent 归属，按需补录/修正；
5. 在 **仪表盘** 查看全局数据画像。

---

## 🏗️ 技术架构

```
┌──────────────────────────────────────────────────────┐
│ Renderer (Vue 3 + TS + Element Plus + ECharts + Pinia)│
│ 仪表盘/项目列表/用量统计/当日工作量/设置               │
└───────────────────────┬──────────────────────────────┘
                        │ IPC（contextBridge 类型安全桥）
┌───────────────────────┴──────────────────────────────┐
│ Preload (electron/preload.ts)                         │
└───────────────────────┬──────────────────────────────┘
┌───────────────────────┴──────────────────────────────┐
│ Main（Electron 主进程）                               │
│ ├─ services/scanner.ts    扫描与技术栈识别            │
│ ├─ services/git.ts        Git 状态 / 提交热力图       │
│ ├─ services/system.ts     IDE/终端/文件夹/服务启停    │
│ ├─ services/stats.ts      项目统计与磁盘占用          │
│ ├─ services/usage.ts      Agent 用量聚合查询与编排    │
│ │    └─ adapters/         harness.ts / claude.ts /   │
│ │                          codex.ts（采集适配器）     │
│ ├─ services/worklog.ts    git 按日工作量 + 归属聚合   │
│ ├─ ipc.ts                 通道注册 + 自动同步调度     │
│ └─ db.ts                  better-sqlite3（建表/迁移） │
└──────────────────────────────────────────────────────┘
```

### 目录结构
```text
project-pilot/
├── electron/
│   ├── main.ts / preload.ts / ipc.ts / db.ts
│   └── services/
│       ├── scanner.ts / git.ts / system.ts / stats.ts
│       ├── usage.ts                # 用量服务 + 成本估算
│       ├── worklog.ts              # 当日工作量（git numstat 聚合）
│       └── adapters/               # harness / claude / codex 采集器
├── src/
│   ├── views/                      # Dashboard/Projects/ProjectDetail/Usage/Workload/Settings
│   ├── components/  router/  store/  shared/  assets/
│   ├── App.vue / main.ts
├── tools/                          # 开发期一次性诊断脚本（electron 运行）
├── electron.vite.config.ts / electron-builder.yml / package.json
```

### 数据存储
- SQLite（better-sqlite3），位于系统用户数据目录：
  - Windows：`%APPDATA%/project-pilot/local-project-manager.db`
  - macOS：`~/Library/Application Support/project-pilot/local-project-manager.db`
  > 兼容说明：虽品牌更名为 CodingPilot，内部包名与数据目录仍保持 `project-pilot`，升级不丢数据。
- 表：`projects`/`tags`/`project_tags`/`notes`/`git_cache`/`commit_daily`/`scan_logs`/`settings`（原有）
  + `agent_sessions`/`agent_usage`/`agent_edits`（AI 用量与改动）
  + `worklog_git`/`worklog_manual`（按日工作量与手动补录）
- 运行时错误日志：`%APPDATA%/project-pilot/logs/app.log`（排查闪退/解析问题用）。
- **本地优先**：所有数据仅存本地，不上传任何代码、路径或会话内容。

---

## 📦 打包发布

使用 electron-builder（配置见 `electron-builder.yml`，productName：**CodingPilot**）：

```bash
npm run build:win     # Windows：NSIS 安装包 + portable 免安装版（release/）
npm run build:mac     # macOS：.dmg + .zip
npm run build:linux   # Linux：AppImage + deb
# 快速更新解包目录（调试用，跳过安装器）：
npx electron-builder --win --dir
```
产物输出到 `release/`；Windows 首次打包需联网下载 NSIS/winCodeSign（较慢）。

---

## 🧪 测试与排查

- 服务层已有端到端测试（扫描→Git→统计）：用 Electron 内置 Node 运行（匹配 better-sqlite3 ABI）。
- Agent 采集排障：`设置 → Agent 用量采集` 关闭自动采集后可手动「立即同步」；解析明细与错误见 `logs/app.log`。
- 若某工具升级后格式变化导致解析为 0，先看 `logs/app.log` 中的 `[usage:<tool>]` 与 `[harness:zstd]` 日志，再按其新会话样本修正 `services/adapters/` 下的解析器。

---

## ⚠️ 已知说明

- **代码行归属是"口径对照"而非绝对**：Agent 行来自工具日志（精确），git 增行按作者日期聚合；"自己手写"默认等于差值（含覆盖/重写），支持手动修正。
- **消费为估算**：按设置里的模型单价由 token 计算，未配置的模型计 $0。
- zstd 会话文件使用纯 JS `fzstd` 解码（Node 内置 zlib 的 zstd 存在个别帧原生崩溃风险，已弃用）。
- "打开 IDE" 依赖 IDE 命令行工具已加入 PATH；服务启停基于 `child_process` 进程树终止。
- 渲染/主进程通过受限 contextBridge 通信（`contextIsolation: true`），渲染进程无 Node 权限。
