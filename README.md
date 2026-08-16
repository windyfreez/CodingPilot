# 本地项目管理系统 (ProjectPilot)

一款本地优先（Local-First）的桌面端项目"指挥中心"，帮助开发者管理散落在各盘符深层目录中的本地代码资产。

基于 **Electron + Vue 3 + TypeScript + Vite（electron-vite）** 构建，支持 Windows / macOS。

---

## ✨ 功能总览（对应 PRD 六大模块）

| 模块 | 功能 |
| --- | --- |
| **仪表盘与统计** | 核心指标卡片（项目总数 / 活跃项目 / 总占用空间 / 远程关联率）、技术栈环形图、框架细分条形图、GitHub 风格提交热力图（近 365 天）、项目健康度柱状图、空间大户 Top 10 排行榜 |
| **自动扫描与智能识别** | 多根目录递归扫描（fast-glob）、特征文件识别技术栈（`package.json` → Node.js、`pom.xml`/`build.gradle` → Java、`go.mod` → Go、`requirements.txt`/`pyproject.toml` → Python、`Cargo.toml` → Rust）、自动识别 `.git` 仓库、自动跳过 `node_modules`/`target`/`dist` 等目录 |
| **项目列表与高级检索** | 关键字模糊搜索、技术栈 / 生命周期 / 标签 / Git 状态多维组合筛选、四种排序（最近更新 / 名称 / 磁盘占用 / 创建时间）、自定义标签系统 |
| **一键快捷操作** | 一键唤醒 IDE（VS Code / IDEA / WebStorm / PyCharm / GoLand / CLion，可配置默认）、打开系统文件夹（资源管理器 / 访达）、打开终端并定位目录、一键直达 GitHub/Gitee 远程仓库 |
| **Git 集成与健康感知** | 当前分支、工作区脏状态、超前/落后远程计数、30 天提交数、最近提交时间；状态缓存 60 秒，支持全量同步 |
| **进度追踪与轻量笔记** | 项目生命周期管理（开发中 / 维护中 / 已上线 / 已归档）、Markdown 备忘录（支持 TODO 勾选统计、Ctrl+S 保存） |

**附加能力**：服务快捷启动（自动推断 `npm run dev` / `mvn spring-boot:run` / `go run .` 等启动命令，内嵌实时日志视图，可一键停止）、自动定时扫描、扫描日志。

---

## 🚀 快速开始

### 环境要求

- Node.js ≥ 18（本项目在 Node 25 / npm 11 上验证通过）
- Windows 10+ 或 macOS

### 安装与开发

```bash
# 安装依赖（postinstall 会自动为 Electron 重建 better-sqlite3 原生模块）
npm install

# 启动开发模式（Vite HMR + Electron 窗口）
npm run dev

# 类型检查
npm run typecheck
```

### 使用流程

1. 打开应用后进入 **设置** 页，添加本地扫描根目录（如 `D:/Codespace/Code`），点击 **立即扫描**；
2. 扫描完成后进入 **项目列表**，可搜索、筛选、排序，点击行进入详情；
3. 在 **项目详情** 中可一键打开 IDE / 文件夹 / 终端 / 远程仓库、启动/停止后台服务、编辑生命周期与标签、撰写 Markdown 备忘录；
4. 在 **仪表盘** 查看全局数据画像；空间排行榜可点击"重新计算空间"获取磁盘占用（首次计算需要一些时间）。

> 说明：磁盘占用计算排除 `.git`、`.idea`、`.vscode`、`__pycache__` 等系统目录，但保留 `node_modules`（便于发现空间大户）。

---

## 🏗️ 技术架构

```
┌─────────────────────────────────────────────────┐
│  Renderer (Vue 3 + TS + Element Plus + ECharts) │
│  路由 / Pinia / 视图组件 / 图表                  │
└──────────────────────┬──────────────────────────┘
                       │ IPC（contextBridge 安全桥）
┌──────────────────────┴──────────────────────────┐
│  Preload（electron/preload.ts，类型安全 API）    │
└──────────────────────┬──────────────────────────┘
┌──────────────────────┴──────────────────────────┐
│  Main（Electron 主进程，Node.js）                │
│  ├─ scanner.ts    fast-glob 递归扫描与特征识别   │
│  ├─ git.ts        simple-git 状态/提交热力图     │
│  ├─ system.ts     child_process 唤醒 IDE/终端、  │
│  │                 文件夹、后台服务启停           │
│  ├─ stats.ts      聚合统计 + 磁盘占用计算        │
│  └─ db.ts         better-sqlite3 持久化          │
└─────────────────────────────────────────────────┘
```

### 目录结构

```text
project_management_system/
├── electron/                 # 主进程代码
│   ├── main.ts               # 主进程入口（窗口、自动扫描定时器）
│   ├── preload.ts            # 预加载脚本（contextBridge 安全桥）
│   ├── ipc.ts                # IPC 通道注册（全部处理器）
│   ├── db.ts                 # SQLite 数据库层（建表/迁移/读写）
│   └── services/
│       ├── scanner.ts        # 扫描与智能识别
│       ├── git.ts            # Git 集成（simple-git）
│       ├── system.ts         # 系统调用与服务管理
│       └── stats.ts          # 统计聚合与磁盘占用
├── src/                      # 渲染进程（Vue 3）
│   ├── assets/               # 样式（Tailwind + 自定义 CSS）
│   ├── components/           # StatCard / HeatmapChart / MarkdownEditor
│   ├── views/                # Dashboard / Projects / ProjectDetail / Settings
│   ├── router/               # 路由配置
│   ├── store/                # Pinia（settings / projects）
│   ├── shared/               # 主进程与渲染进程共享类型与 IPC 契约
│   ├── App.vue               # 根组件（侧边栏布局）
│   └── main.ts               # 前端入口（Element Plus / ECharts 注册）
├── test/                     # 端到端服务层测试（扫描→Git→统计）
├── electron.vite.config.ts   # electron-vite 配置
├── electron-builder.yml      # 打包配置
└── package.json
```

### 数据存储

- 所有数据保存在 SQLite 数据库（`better-sqlite3`），位于系统用户数据目录：
  - Windows：`%APPDATA%/project-pilot/local-project-manager.db`
  - macOS：`~/Library/Application Support/project-pilot/local-project-manager.db`
- 表：`projects`（项目元数据）、`tags`/`project_tags`（标签）、`notes`（备忘录）、`git_cache`（Git 状态缓存）、`commit_daily`（提交热力图）、`scan_logs`（扫描日志）、`settings`（配置）
- **本地优先**：所有数据仅存本地，不上传任何代码与路径。

---

## 📦 打包发布

使用 [electron-builder](https://www.electron.build/) 打包：

```bash
# Windows：生成 NSIS 安装包 + 免安装便携版（.exe）
npm run build:win

# macOS：生成 .dmg + .zip
npm run build:mac

# Linux：生成 AppImage + deb
npm run build:linux
```

产物输出到 `release/` 目录。配置位于 `electron-builder.yml`（含 `asarUnpack` 原生模块、NSIS 快捷方式、应用图标等）。

> 提示：Windows 打包需网络下载 NSIS/winCodeSign 工具（首次较慢）；正式发布建议在 CI（GitHub Actions 等）中按平台分别构建。

---

## 🧪 测试

服务层端到端测试（扫描识别 → Git 状态 → 统计聚合 → 热力图），不依赖 GUI：

```bash
# 编译服务层（输出到 test-build/）
node node_modules/typescript/bin/tsc -p test/tsconfig.json

# 运行（使用 Electron 内置 Node 以匹配 better-sqlite3 的 ABI）
$env:ELECTRON_RUN_AS_NODE = "1"   # Windows PowerShell
node_modules/electron/dist/electron.exe test/e2e-scan.js
```

---

## ⚠️ 已知说明

- "打开 IDE" 依赖对应 IDE 已安装且其命令行工具已加入系统 PATH（如 `code`、`idea`）。
- 服务启停基于 `child_process`，通过 `taskkill`（Windows）或进程组信号（macOS/Linux）终止整个进程树。
- 渲染进程与主进程通过受限的 contextBridge API 通信（`contextIsolation: true`），渲染进程无 Node 权限。
