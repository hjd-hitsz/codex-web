# Codex Web

连接本机 Codex app-server 的浏览器客户端，支持通过 `http://电脑IP:8766` 使用聊天、文件编辑和终端。网页采用 React，Node.js 桥接服务负责静态资源和 WebSocket JSON-RPC 转发。

执行权限统一为完全访问。网页使用 HTTP 直接连接，沿用本机 Codex 登录；聊天记录由 Codex 管理，浏览器保存项目列表、置顶、草稿、主题和摘要译文。

## 环境要求

- Linux、Node.js 24 或以上、npm。
- 已安装并登录的 Codex CLI，支持 `codex app-server`。
- `/usr/bin/zsh`：网页交互式终端使用的 shell。
- 本项目已在 Codex CLI `0.162.1` 上验证。

## 安装和启动

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

## 开发与检查

```bash
npm run dev
npm test
npm run check
```

`dev` 启动 Vite 开发服务器，并把 `/rpc` 和 `/healthz` 代理到网页桥接端口；开发时仍需运行桥接服务和官方后端。`test` 包含单元测试、隔离的桥接协议测试及 React 组件测试，采用模拟后端，不消耗模型额度，也不修改真实聊天。`check` 依次执行格式检查、测试和生产构建。

格式化代码使用 `npm run format`。构建资源写入 `client/dist`，生产服务直接读取该目录；仅修改前端后运行 `npm run build`，刷新网页即可更新。

## 功能与交互

- 项目分组、历史搜索、置顶、重命名、归档、恢复、删除和对话分支。
- 流式回复、Markdown、代码高亮、数学公式、工具记录与任务计划。
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
client/
  src/                 前端组件、状态和 JSON-RPC 客户端
  tests/               消息、过程分组、翻译和权限策略测试
  vite.config.js       构建与开发代理
server/
  src/config.mjs       环境配置和默认目录
  src/server.mjs       HTTP、WebSocket 转发与终端恢复
  tests/               配置和桥接集成测试
scripts/               后端启动、组件测试、systemd 安装
tests/components/      隔离环境中的实际 React 组件测试
docs/                  架构和部署维护说明
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
