# Codex Web

在浏览器中使用本机 Codex。服务安装在 Linux 电脑上，电脑、手机和平板通过 `http://电脑IP:8766` 访问。

网页沿用服务所在电脑的 Codex 登录，任务以该用户的完全访问权限执行。默认通过 HTTP 提供访问，适合在可信网络中使用。

## 环境要求

- Linux、Node.js 24 或以上、npm。
- Git：用于工作区差异和文件修改的撤销校验。
- 已安装并登录的 Codex CLI，支持 `codex app-server`。
- `/usr/bin/zsh`：网页交互式终端使用的 shell。
- 后台运行和开机启动需要 systemd 用户服务。

## 安装与启动

在安装 Codex 的电脑上，以运行 Codex 的普通用户执行：

```bash
npm install -g https://github.com/hjd-hitsz/codex-web/releases/download/v2.4.0/codex-web-2.4.0.tgz
codex-web service install
codex-web service status
```

npm 全局命令所在目录需在 `PATH` 中。服务安装会启动网页服务和缺失的 Codex 后端服务，保留已有后端配置。

需要开机自动启动、退出登录后继续运行时，执行：

```bash
loginctl enable-linger "$USER"
```

该命令可能需要管理员授权。

启动后打开：

- 本机：`http://127.0.0.1:8766`。
- 同一网络的其他设备：`http://电脑IP:8766`，将“电脑IP”替换为服务所在电脑的实际 IP，并允许防火墙访问 `8766` 端口。

前台运行、本地安装包的安装与下载校验见[部署与维护](docs/deployment.md)。

## 配置

执行以下命令可创建用户配置并显示其位置，已有配置会保留：

```bash
codex-web config init
```

默认配置文件为 `~/.config/codex-web/.env`，升级后保留。可通过 `CODEX_WEB_CONFIG_DIR` 指定配置目录；使用 `XDG_CONFIG_HOME` 时，配置位于其下的 `codex-web` 目录。

常用配置项：

- `HOST`：监听地址，初始为 `0.0.0.0`，允许通过电脑 IP 访问；仅本机访问可改为 `127.0.0.1`。
- `PORT`：网页端口，初始为 `8766`。
- `CODEX_APP_SERVER_URL`：Codex 后端地址，初始为 `ws://127.0.0.1:8765`。
- `DEFAULT_CWD`：首次使用时的默认工作目录，未设置时使用当前用户的主目录。

修改配置前先结束当前任务和网页终端，保存后执行 `codex-web service restart`；前台运行时重新启动网页进程。端口变更后使用新端口访问。完整配置和后端设置见[部署与维护](docs/deployment.md#配置)。

## 升级与服务管理

升级时，从目标版本的 Release 获取安装地址。当前版本的安装与服务更新命令为：

```bash
npm install -g https://github.com/hjd-hitsz/codex-web/releases/download/v2.4.0/codex-web-2.4.0.tgz
codex-web service install
codex-web service restart-when-idle
```

最后一个命令会等待当前任务和上下文整理结束后再重启，等待期间保持命令运行；打开的网页终端不会阻塞更新。升级后刷新网页，在“设置 → 关于”查看网页与服务版本；命令行可执行 `codex-web --version`。

全部命令见 `codex-web --help`，回退与日志查看方法见[部署与维护](docs/deployment.md)。

## 数据与常见问题

聊天记录和登录凭据由服务所在电脑的 Codex 管理；草稿、置顶、项目快捷列表和主题保存在当前浏览器中。“未分类”对话生成的文件保存在 Codex 配置目录下的 `codex-web/workspaces`，迁移电脑时应一并保留。

思考摘要会发送至 `transmart.qq.com` 翻译，发送前替换其中的代码、路径和链接；译文缓存在当前标签页会话中，刷新页面继续复用，关闭标签页或浏览器后清空。自动对话标题使用 Codex 模型，会产生少量额外模型用量。

- 网页无法打开：运行 `codex-web service status`，检查服务状态、访问 IP、端口和防火墙。
- 网页提示后端未连接：检查 Codex 登录和后端服务状态。可用 `curl http://127.0.0.1:8766/healthz` 检查连接，HTTP 200 表示已就绪，503 表示后端未连接；自定义端口时相应替换。
- 对话显示被占用：先在持有该对话的客户端结束任务并释放对话，再点击网页的“重试”。已有后端的设置见[对话占用与后端回收](docs/deployment.md#对话占用与后端回收)。

版本变化见[变更日志](CHANGELOG.md)，各版本的功能与修复见 [GitHub Releases](https://github.com/hjd-hitsz/codex-web/releases)。
