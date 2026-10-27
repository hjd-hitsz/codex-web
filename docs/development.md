# 开发者指南

本文面向修改、测试和发布 Codex Web 的开发者。安装发行包及日常使用见 [README](../README.md)，运行配置和故障处理见[部署与维护](deployment.md)。实现设计见[架构说明](architecture.md)，版本选择和完整发布流程见[版本管理](versioning.md)。

## 本地环境与源码启动

开发环境需要 Linux、Node.js 24+、npm、已登录的 Codex CLI 和 `/usr/bin/zsh`。本项目使用根目录 npm workspaces 和单一 `package-lock.json` 管理前后端依赖。

克隆仓库后，在项目根目录安装依赖并创建配置：

```bash
git clone https://github.com/hjd-hitsz/codex-web.git
cd codex-web
npm ci
```

首次配置时，执行 `cp .env.example .env` 创建配置文件；已有 `.env` 时直接使用现有配置。源码命令从项目根目录 `.env` 加载环境变量，外部环境变量优先；配置项含义见[配置说明](deployment.md#配置)。

在不同终端分别启动后端、网页桥接和前端开发服务器：

```bash
# 终端一：已有后端监听配置中的地址时可复用
npm run start:backend
```

```bash
# 终端二：网页桥接服务
npm start
```

```bash
# 终端三：前端开发服务器
npm run dev
```

打开 Vite 输出的地址。开发服务器将 `/rpc` 和 `/healthz` 代理到网页桥接端口，模型调用和工具执行由 Codex 后端处理。

验证生产构建时，执行 `npm run build`，再通过网页桥接地址访问，默认 `http://127.0.0.1:8766`。生产服务直接读取 `client/dist`，前端更新后重新构建并刷新网页即可；桥接代码更新后需要重启网页服务。

## 项目结构

```text
bin/codex-web.mjs      全局命令入口和用户配置加载
client/
  src/                 前端组件、状态和 JSON-RPC 客户端
  tests/               消息、过程分组、翻译和权限策略测试
  vite.config.js       构建与开发代理
server/
  src/config.mjs       环境配置和默认目录
  src/server.mjs       HTTP、WebSocket 转发与终端恢复
  src/version.mjs      正式版本与 Git / 安装包构建来源
  tests/               配置和桥接集成测试
scripts/               后端启动、组件测试、systemd 安装及发布脚本
tests/components/      隔离环境中的实际 React 组件测试
docs/architecture.md   架构与协议实现
docs/deployment.md     使用者部署、配置与故障处理
docs/versioning.md     版本管理与发布流程
CHANGELOG.md           未发布变更与正式版本总览
package-lock.json      全项目依赖锁文件
```

前端采用 React，Node.js 桥接服务负责静态资源和 WebSocket JSON-RPC 转发。组件职责、状态流转、协议和生命周期约束见[架构说明](architecture.md)。

## 格式与验证

```bash
npm run format
npm test
npm run check
```

`format` 使用 Prettier 格式化项目。`test` 包含单元测试、隔离的桥接协议测试和 React 组件测试；`check` 依次执行版本一致性、格式检查、全部测试、生产构建和发行包安装测试。提交修改前执行 `npm run check`。

测试采用模拟后端，不消耗模型额度，也不修改真实聊天。协议或生命周期变更应补充对应回归测试；真实后端验证使用临时会话或明确的测试数据。各测试目录的覆盖范围见[架构说明中的测试章节](architecture.md#测试)。

单独验证发行包时执行：

```bash
npm run test:package
```

该测试在临时 npm prefix 中全局安装打包产物，检查命令入口、静态资源、构建来源、用户配置和服务生成。后端与服务管理命令使用模拟实现。安装优先复用 npm 缓存，缺少包元数据或依赖时访问配置的 registry，因此执行环境需要相应缓存或网络连接。

## 从源码运行后台服务

在项目根目录执行：

```bash
npm run build
npm run service:install
npm run service:status
```

安装脚本创建用户级 `codex-lan-web.service`，直接运行当前项目中的桥接服务。已有 `codex-app-server.service` 保留代理、环境和启动设置；缺失时创建后端服务。被覆盖的网页服务配置备份到用户状态目录下的 `codex-web/service-backups`。

仅修改前端时重新构建并刷新网页。修改桥接后，先等待任务结束并退出网页终端，再执行：

```bash
npm run service:restart-when-idle
```

确认任务与终端均已结束时，也可使用 `npm run service:restart`。终端状态和输出保存在桥接进程中，重启前应保护运行中的工作。迁移源码目录后，先重新安装服务以更新路径，再重启。

源码部署与全局安装使用相同服务名，同一用户使用一套部署。从源码切换到全局包时，将项目 `.env` 中需要保留的配置迁移到用户配置目录，再按[发行包安装说明](deployment.md#安装发行包)更新服务。

桥接静态资源路由发生变化时，构建前端后还需重启网页服务。增加按需加载模块时，同时验证生产资源路由与发行包内的 JavaScript、CSS 分块。

## 打包与发布

项目通过 GitHub Release 分发预构建 npm 安装包。手动构建发行包时执行：

```bash
npm ci
npm run check
npm pack
```

`npm pack` 的 `prepack` 会重新构建网页并生成 `codex-web-X.Y.Z.tgz`，其中 `X.Y.Z` 为根包版本。`package.json` 的 `files` 白名单包含命令行入口、前端构建资源、构建来源、桥接代码与运行脚本；开发源码、测试、聊天数据和实际环境配置在包外。运行依赖由目标机器上的 npm 安装。

日常开发保持包版本，有实际影响的变化先记入 [CHANGELOG.md](../CHANGELOG.md) 的“未发布”。准备发布时按批次选择版本：

```bash
npm run version:check
npm run version:prepare -- minor
```

`version:prepare` 同步包版本、锁文件、变更日志和 README、部署文档中的安装链接，并生成待审阅的发布说明。版本确定后，检查、推送或上传失败均保留该版本并修复重试。

`.github/workflows/release.yml` 在推送版本标签后检查并发布。工作流使用仓库的 `GITHUB_TOKEN` 和 `contents: write` 权限，将 npm 包与 SHA-256 文件完整上传到同版本草稿后再正式发布。发布前需在实际标签的 `GITHUB_REF_NAME` 环境下执行完整检查。标签、发布说明、附件验证及同版本重试步骤统一见[版本管理](versioning.md#准备和发布)。

如需改为 npm registry 分发，维护者需先取得包名发布权限并完成 npm 身份验证，再用实际版本替换以下 `X.Y.Z`：

```bash
npm publish ./codex-web-X.Y.Z.tgz --access public
```

发布成功后，使用者可通过包名安装。选择作用域包名时，先修改根 `package.json` 的 `name` 并更新锁文件，再重新验证和打包；全局命令名仍为 `codex-web`。

## 构建来源

版本来源的生成机制、开发构建标识和正式发布身份见[版本管理](versioning.md#正式版本与开发构建)。网页来源在构建时固定，源码桥接来源在进程启动时固定；排查更新时分别核对网页“设置 → 关于”和 `/healthz` 中的信息。
