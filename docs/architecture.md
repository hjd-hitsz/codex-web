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

`summary-translator.js` 使用临时 Codex 会话翻译公开给客户端的摘要文本，保留代码和路径，合并请求并缓存译文；`use-summary-translation.js` 将译文接到 React 展示层。临时翻译会话完成后取消订阅，不添加到保存的聊天列表。

## 桥接服务

HTTP 服务提供构建资源和健康检查。资源使用 gzip 传输，并按修改时间刷新内存缓存。WebSocket 网关为不同浏览器客户端重新分配请求 ID，再将官方后端的响应路由回发起客户端；通知广播给所有已连接网页。

桥接进程还保存活动轮次、待处理交互请求、终端运行状态与最近输出。网页重连时通过 `lan/state` 恢复这些状态。该缓存属于进程内运行状态，重启网页服务会重新建立后端连接。

## 测试

- `client/tests`：对话分组、最终回复操作、摘要解析、翻译缓存与统一权限策略。
- `server/tests`：环境配置、HTTP 资源更新、健康检查、多个客户端请求 ID 隔离。
- `tests/components`：直接渲染实际 React 组件，验证整块折叠、中文标题、发送快捷键、权限入口移除、终端配色和退出折叠。

组件测试通过 esbuild 生成临时测试模块，只替换 WebSocket、终端渲染器和浏览器存储等外部边界。测试缓存位于 `.cache/component-tests`，运行后清理。
