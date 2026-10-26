# Codex Web

连接本机 Codex app-server 的浏览器客户端，支持通过 `http://电脑IP:8766` 使用聊天、文件编辑和终端。网页采用 React，Node.js 桥接服务负责静态资源和 WebSocket JSON-RPC 转发。

执行权限统一为完全访问。网页使用 HTTP 直接连接，沿用本机 Codex 登录；聊天记录由 Codex 管理，浏览器保存项目列表、置顶、草稿、主题和摘要译文。

## 环境要求

- Linux、Node.js 24 或以上、npm。
- 已安装并登录的 Codex CLI，支持 `codex app-server`。
- `/usr/bin/zsh`：网页交互式终端使用的 shell。
- 本项目已在 Codex CLI `0.162.1` 上验证。

## 全局 npm 安装

发行包内包含已构建的网页和运行所需的桥接代码，目标机器无需克隆源码或构建前端。后台自启动使用 Linux systemd 用户服务；先在目标机器安装 Node.js 24+、npm、Codex CLI 和 zsh，并完成该机器的 Codex 登录。

从 [GitHub Release v2.0.0](https://github.com/hjd-hitsz/codex-web/releases/tag/v2.0.0) 安装，npm 会直接下载预构建安装包：

```bash
npm install -g https://github.com/hjd-hitsz/codex-web/releases/download/v2.0.0/codex-web-2.0.0.tgz
codex-web service install
loginctl enable-linger "$USER"
codex-web service status
```

`loginctl enable-linger` 用于开机启动用户服务及退出登录后继续运行，可能需要管理员授权。服务安装以运行 Codex 的普通用户执行，npm 全局命令所在目录需在 `PATH` 中。

服务启动后访问 `http://电脑IP:8766`，本机可访问 `http://127.0.0.1:8766`。安装命令会创建并启用后端和网页服务，保留已有的 Codex 后端配置；当前已运行的服务继续运行。首次连接可通过 `curl http://127.0.0.1:8766/healthz` 检查。

也可以下载 Release 附件 `codex-web-2.0.0.tgz` 后执行 `npm install -g ./codex-web-2.0.0.tgz`。附件中的 `.sha256` 文件用于校验下载内容；GitHub 自动生成的 Source code 附件用于源码开发。项目通过 GitHub Release 分发，npm registry 发布状态为未发布。发布和升级流程见 [部署与维护](docs/deployment.md)。

常用命令：

```bash
codex-web --help
codex-web --version
codex-web version --json
codex-web config init
codex-web service restart-when-idle
```

全局安装的配置保存在 `~/.config/codex-web/.env`，npm 升级后保留；支持 `XDG_CONFIG_HOME` 或 `CODEX_WEB_CONFIG_DIR` 指定目录。`config init` 保留已有配置。配置文件以外的当前目录 `.env` 不参与全局命令的配置加载。

如需前台运行，在两个终端分别执行 `codex-web backend` 和 `codex-web`。已有可连接的后端时，执行 `codex-web` 即可。

## 从源码安装和启动

在项目根目录执行：

```bash
npm ci
npm run build
```

首次运行时可复制环境配置模板，再按需修改：

```bash
cp .env.example .env
```

在一个终端启动官方后端：

```bash
npm run start:backend
```

在另一个终端启动网页服务：

```bash
npm start
```

浏览器打开 `http://电脑IP:8766`。如果本机已有 `codex-app-server.service` 监听 `127.0.0.1:8765`，直接启动网页服务即可。

关闭网页后，桥接会释放该页面使用的对话订阅；运行中的任务继续执行，完成后释放。多个页面共享同一对话时，最后一个页面退出后释放。项目启动的后端使用 `thread_unload_delay_secs=0`，让空闲对话及时释放写入占用，便于切回 Codex 客户端。已有后端服务需按 [部署与维护](docs/deployment.md#对话占用与后端回收) 核对启动参数。

## 开发与检查

```bash
npm run dev
npm test
npm run check
```

`dev` 启动 Vite 开发服务器，并把 `/rpc` 和 `/healthz` 代理到网页桥接端口；开发时仍需运行桥接服务和官方后端。`test` 包含单元测试、隔离的桥接协议测试及 React 组件测试，采用模拟后端，不消耗模型额度，也不修改真实聊天。`check` 依次执行版本一致性、格式检查、测试、生产构建和发行包安装测试。

`npm run test:package` 在临时 npm prefix 中全局安装打包产物，检查命令入口、静态资源、用户配置和服务生成。测试使用模拟后端与服务管理命令，不修改真实 systemd 服务；安装优先复用 npm 缓存，缺少包元数据或依赖时从配置的 registry 获取。

格式化代码使用 `npm run format`。构建资源写入 `client/dist`，生产服务直接读取该目录；仅修改前端后运行 `npm run build`，刷新网页即可更新。

## 版本与变更记录

正式版本按发布批次管理，一次发布可以汇总多次日常提交。日常开发保持包版本，将有实际影响的变化记入 [变更日志](CHANGELOG.md) 的“未发布”；准备发布时再按整个批次选择 patch、minor 或 major，统一更新版本并创建 `vX.Y.Z` 标签。

网页“设置 → 关于”、`codex-web --version` 和 `/healthz` 提供版本来源。开发构建显示类似 `2.0.0+dev.gabc1234` 的提交标识，含未提交修改时追加 `.dirty`；正式标签上的干净构建显示正式版本。网页与桥接分别显示各自的构建或进程信息，便于核对刷新与重启后的状态。npm 包保存完整提交和构建时间，安装后继续可查。

```bash
npm run version:check
npm run version:prepare -- minor
```

`version:prepare` 同步包版本、锁文件、变更日志和安装链接，并生成待审阅的发布说明。版本选择、记录职责和发布步骤见 [版本管理](docs/versioning.md)，现有交付详情见 [v2.0.0 发布说明](docs/releases/v2.0.0.md)。

## 功能与交互

- 项目分组、历史搜索、置顶、重命名、归档、恢复、删除和对话分支。
- 对话按最近一轮结束时间倒序排列，项目按组内最近结束的对话排序；打开历史对话保持原有排序。成功、失败和中断均采用后端记录的结束时间，缺少结束时间时使用创建时间；置顶对话仍独立显示。
- 流式回复、Markdown、代码高亮、数学公式、工具记录与任务计划。
- 同步和异步提问以展开的问题卡片显示，支持选项、多行自定义回答、私密输入及 Ctrl+Enter 提交；异步回答按任务状态补充到当前轮次或开启新轮次，并保留消息草稿与附件。
- `@` 引用文件、目录或技能；`/` 打开快捷命令。
- Ctrl+Enter 发送，Enter 换行；中文输入法确认候选词时保持编辑状态。
- 每轮的进度说明、思考摘要和工具记录整体折叠为“工作过程”；最终回答单独显示。
- 思考摘要展示实际标题；只有标题时不提供展开箭头，空摘要隐藏。英文标题在显示时翻译，正文在展开时翻译。
- 翻译使用本机 Codex 登录和可用模型，合并请求并缓存结果；首次翻译产生额外模型调用。
- 本机文件浏览与编辑、Git 差异、代码审查、白底交互式终端。
- Ctrl+D 或 `exit` 结束 shell 后自动折叠终端；隐藏面板时进程继续运行。
- 新建、恢复、分支、任务和终端请求统一为完全访问，界面不提供权限选择。

桌面自动化、桌面内置浏览器和完整插件安装管理等功能仍由 Codex 桌面客户端提供。

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
scripts/               后端启动、组件测试、systemd 安装
tests/components/      隔离环境中的实际 React 组件测试
docs/                  架构和部署维护说明
CHANGELOG.md           未发布变更与正式版本总览
package-lock.json      全项目依赖锁文件
```

## 后台服务

```bash
npm run build
npm run service:install
npm run service:status
```

安装脚本创建用户级 `codex-lan-web.service`，直接运行当前项目中的桥接服务。已有 `codex-app-server.service` 会保留其代理、环境和启动设置；缺失时才创建后端服务。原网页服务配置自动备份到用户状态目录的 `codex-web/service-backups`。

更改桥接代码后，在网页终端和当前任务空闲时执行：

```bash
npm run service:restart
```

需要等待当前任务和网页终端结束后再重启时，使用 `npm run service:restart-when-idle`。

详细说明见 [部署与维护](docs/deployment.md) 和 [架构说明](docs/architecture.md)。
