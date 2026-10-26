# 架构说明

```text
浏览器 React 客户端
    │ HTTP 静态资源、WebSocket /rpc
    ▼
Node.js 网页桥接服务
    │ WebSocket JSON-RPC
    ▼
本机 Codex app-server
    ├─ 聊天记录、模型调用与工具执行
    ├─ 文件、Git 与交互式 shell
    └─ 已登录账户和已安装技能
```

## 前端

`client/src/main.jsx` 负责应用布局、项目侧栏、对话管理和设置弹窗；`chat.jsx` 负责消息、工作过程、输入框及交互请求；`workspace.jsx` 负责文件编辑、差异和终端。

`store.js` 维护共享状态和 JSON-RPC 连接，处理历史加载、实时通知及重连。请求发送前统一经过 `execution-policy.js`：对话生命周期和任务使用完全访问、无需审批，直接命令使用完全访问沙箱策略。

`conversation-groups.js` 将中间活动合成默认折叠的过程区域。`reasoning-summary.js` 提取摘要标题和正文，`message-actions.js` 决定最终回答的复制与分支按钮。

`user-input.jsx` 提供提问表单，区分选项与自定义输入，支持多行文本、私密字段、多问题校验和 Ctrl+Enter 提交。阻塞提问等待用户选择；非阻塞提问预选首项，提交由用户触发。单选组按表单实例隔离。

提问有两种协议来源。`item/tool/requestUserInput` 属于服务器请求，按原请求 ID 返回 `{ answers: { [questionId]: { answers: [text] } } }`；`isBlocking` 控制等待提示和选项初始状态，`isOther` 控制自定义回答入口，`isSecret` 使用密码字段。待处理请求从 `lan/state.questions` 恢复，`serverRequest/resolved` 和 `lan/questionResolved` 清理所有页面的对应卡片，字符串与数字 ID 按同一标识处理。连接不可用或发送失败时保留表单，恢复后可重试。[官方协议说明](https://learn.chatgpt.com/docs/app-server#toolrequestuserinput)介绍请求与解决通知的对应关系。

异步工具的问题放在 `agentMessage.questions`，字段为 `title` 和可选的字符串选项列表。包含问题的消息独立展开，空正文同样显示，后续助手进度保持卡片可见。回答按问题标题和“回答：”整理为普通用户消息：任务运行时调用 `turn/steer`，空闲时调用 `turn/start`。提交过程保留输入框草稿与附件，通过后续消息中的问题标题与回答标记识别已回答的卡片，历史加载后可恢复显示。其他问题继续保留回答入口。

`thread-order.js` 从 `thread/turns/list` 的 `completedAt` 取得最近轮次结束时间，统一用于侧栏、搜索结果、项目分组排序和时间展示。成功、失败和中断轮次均参与排序，运行中轮次沿用上次结束时间；缺少结束记录时使用创建时间。打开对话产生的 `updatedAt` 变化仅用于缓存失效。

对话列表先按创建时间遍历后端分页，再读取轮次元数据（`itemsView: notLoaded`，最多六个并发请求），按结束时间排序后每次展示 60 条，确保后端分页中的较新完成记录进入首页。轮次读取结果按对话 ID 和 `updatedAt` 缓存，完成通知立即更新排序并刷新列表；旧列表请求的迟到响应会被丢弃。读取失败时保留已知结束时间或使用创建时间，下次加载重试。首次读取成本随历史记录量增长，后续加载复用未变化对话的缓存。

每次加载列表同时请求桥接的 `lan/projectless/read`，取得桌面端自动工作目录与对话 ID 的对应关系。`thread-projects.mjs` 只读 `CODEX_HOME/.codex-global-state.json`，未设置 `CODEX_HOME` 时使用当前用户的 `~/.codex`。识别条件为：对话在 `projectless-thread-ids` 中、具有 `thread-projectless-output-directories` 和 `thread-workspace-root-hints`、输出目录为工作区根下的“日期/对话目录/outputs”，且没有 `thread-project-assignments` 项目归属。状态文件缺失、暂不可读或内容不完整时返回空映射；分组元数据请求失败时，列表仍按实际目录加载，后续加载重新读取。

`thread-order.js` 将当前 `cwd` 仍等于自动工作目录、且未通过 `projectId` 或网页项目列表指定项目的对话合并到空路径分组。`project-group.jsx` 将该分组显示为“未分类”，支持折叠与新建对话，空分组保留入口。CLI 和外部端对话按明确的工作目录分组，只有无项目标记的外部对话也遵循此规则。工作目录已改变或已进入自动目录内具体项目的对话按当前目录分组；缺少目录的对话进入“未分类”。分组只影响侧栏展示，执行任务和文件操作继续使用实际 `cwd`。

从“未分类”新建时，浏览器保存无项目选择，输入框和顶部目录入口显示“未分类”。首次发送通过 `lan/projectless/prepare` 在 `CODEX_HOME/codex-web/workspaces` 下创建独立的 `chat-XXXXXX` 工作目录，再以该 `cwd` 和 `threadSource: codex-web-projectless` 调用普通 `thread/start`。后端保存来源字段，`lan/state.projectlessRoot` 提供自动目录根；列表同时匹配来源与根下直接生成的目录，重载、归档恢复和新浏览器连接后均能恢复分类。目录分配失败保留草稿；对话创建失败时重试复用已分配目录。网页新建与桌面端识别共用项目归属优先规则，选择具体文件夹后按目录创建。桌面状态文件继续只读，网页工作目录独立管理。

`summary-translator.js` 由浏览器直接通过 HTTPS 请求 TranSmart 的 `/api/imt` 普通机器翻译接口（`model_category: normal`），将英文摘要译为简体中文。代码、路径、链接和 Markdown 强调标记先替换为占位符，收到译文后原样恢复；占位符缺失或重复时按失败处理。请求超时为 10 秒，同批最多 24 条，重复原文共用请求，最近 300 条译文保存在浏览器 localStorage。`use-summary-translation.js` 在文本稳定 900 毫秒后发起翻译，标题随显示触发，正文随展开触发。翻译独立于 Codex 对话、账户和模型选择，失败时展示原文并提供重试入口。

## 桥接服务

HTTP 服务提供构建资源和健康检查。资源使用 gzip 传输，并按修改时间刷新内存缓存。WebSocket 网关为不同浏览器客户端重新分配请求 ID，再将官方后端的响应路由回发起客户端；通知广播给所有已连接网页。

桥接进程还保存活动轮次、待处理交互请求、终端运行状态与最近输出。网页重连时通过 `lan/state` 恢复这些状态。该缓存属于进程内运行状态，重启网页服务会重新建立后端连接。

`thread/start`、`thread/resume` 和 `thread/fork` 的成功响应将实际返回的对话 ID 关联到发起请求的网页连接。关闭连接时移除其订阅；最后一个页面退出且轮次与相关请求均已结束后，桥接调用 `thread/unsubscribe`。页面关闭后的迟到响应同样触发清理，正在取消订阅的对话等待释放响应后再恢复。网页主动取消订阅也使用同一计数，保留其他页面的订阅。桥接每 30 秒发送 WebSocket ping，下一次检查仍未收到 pong 时断开失联连接。

项目的后端启动脚本和新建 systemd 后端服务均传入 `-c thread_unload_delay_secs=0`；桥接也在对话生命周期请求中覆盖同名配置。当前使用的 Codex CLI 0.162.1 在启动参数设为零时及时卸载无订阅的空闲对话，仅在单次对话请求里设置该值仍会保留对话。已有后端服务继续保留原配置，升级时需核对启动参数，见 [部署与维护](deployment.md#对话占用与后端回收)。

## npm 分发与命令入口

根包通过 `bin/codex-web.mjs` 提供全局 `codex-web` 命令。源码继续使用 npm workspaces 管理前后端，发行包用 `files` 白名单包含 `client/dist` 和运行代码，安装时仅需要桥接的运行依赖。前端在打包前构建，目标机器直接提供已构建资源。

命令入口从用户配置目录加载 `.env`，然后调用桥接、后端启动或服务安装脚本。配置与 npm 安装目录分离，升级安装包保留用户配置。systemd 服务写入安装时的 Node.js 和入口绝对路径，网页服务记录用户配置目录；已有后端服务保留原配置。源码部署仍通过根目录 `.env` 和 npm scripts 工作。

## 版本来源与发布管理

版本来源和发布管理由根包版本与 Git 身份共同驱动。`server/src/version.mjs` 在源码仓库读取提交、工作区状态和匹配版本的 HEAD 标签；桥接在启动时固定这些信息，命令行在执行时读取，后端 `initialize.clientInfo.version` 使用同一可读标识。

Vite 在构建时把版本信息和构建时间同时写入前端常量及根目录 `build-info.json`，该文件随 npm 包交付，在目标机器缺少 Git 时恢复来源。源码运行优先读取实时 Git，避免历史清单覆盖当前身份。网页“关于”通过前端常量和 `lan/state.version` 分别展示网页与桥接信息，`/healthz.version` 提供运行中桥接的同一信息。

`scripts/version.mjs` 提供一致性检查、发布准备和正式标签校验。日常记录进入 `CHANGELOG.md` 的未发布区域，发布准备一次性归档变更、同步版本与下载地址，并生成详细发布说明草稿；GitHub Release 工作流从通过校验的稳定标签发布。完整规则见 [版本管理](versioning.md)。

## 测试

- `client/tests`：完成时间与项目排序、自动目录与明确目录的分组、对话分组、提问独立展示、最终回复操作、摘要解析、翻译缓存与统一权限策略。
- `server/tests`：环境配置、HTTP 资源更新、健康检查、桌面自动目录识别与刷新、多个客户端请求 ID 隔离、提问广播与重连恢复及解决同步，以及对话订阅的断连、共享、迟到响应、后台任务与心跳回收。
- `tests/components`：直接渲染实际 React 组件，验证未分类展示与折叠、明确目录的新建入口、整块折叠、中文标题、发送快捷键、同步与异步提问的回答和失败重试、草稿保留、权限入口移除、终端配色和退出折叠。
- `tests/package.test.mjs`：将真实发行包安装到临时全局 prefix，使用模拟后端和服务命令验证命令入口、用户配置、网页资源及 systemd 服务生成。
- `tests/version.test.mjs`：在临时 Git 仓库验证正式标签、开发提交、未提交修改、安装包来源、版本准备及发布校验。

组件测试通过 esbuild 生成临时测试模块，只替换 WebSocket、终端渲染器和浏览器存储等外部边界。测试缓存位于 `.cache/component-tests`，运行后清理。
