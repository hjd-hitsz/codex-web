# 部署与维护

本文面向安装和运行 Codex Web 的使用者，说明发行包安装、配置、服务管理、升级与故障处理。网页操作见 [README](../README.md)。

## 安装发行包

预构建 npm 安装包通过 [GitHub Releases](https://github.com/hjd-hitsz/codex-web/releases) 分发。在已配置 Node.js 24+、npm、Codex CLI、`/usr/bin/zsh` 和 systemd 的 Linux 电脑上，以运行 Codex 的普通用户完成本机 Codex 登录，然后执行：

```bash
npm install -g https://github.com/hjd-hitsz/codex-web/releases/download/v2.3.1/codex-web-2.3.1.tgz
codex-web service install
loginctl enable-linger "$USER"
codex-web service status
curl http://127.0.0.1:8766/healthz
```

`service install` 创建缺失的后端服务并安装网页服务，启用两者的自启动；已有后端服务继续使用原配置。`enable-linger` 使用户服务可在开机后、登录前启动，是否需要管理员操作由系统授权策略决定。npm 全局命令所在目录需在 `PATH` 中，目标电脑的防火墙需允许访问网页端口。

默认网页地址为 `http://电脑IP:8766`，本机可使用 `http://127.0.0.1:8766`。网页沿用本机 Codex 登录，以服务用户的完全访问权限执行任务，通过 HTTP 提供访问，适合在可信网络中使用。

### 下载后安装与校验

也可以下载或复制 Release 中的 `codex-web-2.3.1.tgz` 和 `codex-web-2.3.1.tgz.sha256` 到同一目录，然后执行：

```bash
sha256sum -c codex-web-2.3.1.tgz.sha256
npm install -g ./codex-web-2.3.1.tgz
codex-web service install
```

安装使用 Release 的 `.tgz` 附件。安装过程中，npm 会获取运行依赖，目标电脑需具备相应缓存或能访问配置的 npm registry。

文件差异与撤销校验需要服务环境能够运行 `git`。文件变更汇总也支持 Git 仓库以外的目录；“撤销”遇到后续修改冲突时会保留当前文件。升级后先等待当前任务和网页终端结束，再重启网页服务并刷新页面，以加载新的界面和撤销接口。

## 命令与前台运行

- `codex-web` / `codex-web start`：前台运行网页服务，连接配置中的 Codex 后端。
- `codex-web backend`：前台运行 Codex app-server。
- `codex-web config init`：创建用户 `.env`，显示配置路径并保留已有文件。
- `codex-web --version` / `codex-web version --json`：查看版本或完整的版本来源信息。
- `codex-web service install`：安装或更新服务文件，启动尚未运行的服务。
- `codex-web service status`：查看网页、后台任务与后端状态。
- `codex-web service start` / `stop` / `restart`：启动、停止或重启网页服务；启动网页时也会拉起后端，停止网页时后端继续运行。
- `codex-web service restart-when-idle`：等待当前任务和上下文整理结束后重启网页，打开的网页终端保持独立。

前台运行时，在两个终端分别执行 `codex-web backend` 和 `codex-web`，并保持终端打开。已有可连接的后端时，直接运行 `codex-web`。

## 配置

全局命令从 `~/.config/codex-web/.env` 读取配置；设置 `XDG_CONFIG_HOME` 时使用其下的 `codex-web` 目录，设置 `CODEX_WEB_CONFIG_DIR` 时优先使用该目录。外部环境变量优先于 `.env`。执行 `codex-web config init` 可创建配置并显示路径，已有配置和 npm 升级后的配置均会保留。

systemd 服务会记录安装时的配置目录，后续启动继续使用该目录。更换配置目录时，用新的 `CODEX_WEB_CONFIG_DIR` 执行 `codex-web service install`，再按下文方法重启网页服务。

- `HOST`：HTTP 监听地址，初始为 `0.0.0.0`，支持通过电脑 IP 访问；仅本机访问可设为 `127.0.0.1`。
- `PORT`：网页端口，初始为 `8766`。
- `CODEX_APP_SERVER_URL`：Codex 后端 WebSocket 地址，初始为 `ws://127.0.0.1:8765`；使用已有后端时填写其实际地址。
- `CODEX_HOME`：本机 Codex 配置目录，未设置时使用当前用户的 `~/.codex`。用于读取桌面端的无项目目录信息，并保存网页“未分类”对话的独立工作目录及后台任务记录。使用独立 Codex 配置目录时，填写对应目录。
- `DEFAULT_CWD`：首次打开网页时的默认目录，未设置时使用当前用户的主目录；浏览器已经选择的项目目录优先。
- `STATIC_DIR`：网页资源目录，未设置时自动定位到当前安装包中的网页资源；相对路径以用户配置目录为基准。

相对 `DEFAULT_CWD` 同样以用户配置目录为基准。建议为工作目录填写绝对路径，便于核对任务实际使用的位置。

修改配置前先等待任务结束并退出网页终端，保存后执行 `codex-web service restart`；前台运行时重新启动网页进程。修改端口后使用新端口访问。

`CODEX_APP_SERVER_URL` 用于指定网页连接地址。已有后端服务的监听地址继续由其服务配置管理，修改连接地址时需与实际后端保持一致。Codex 后端的环境配置见下一节。

## systemd 服务

网页服务名为 `codex-lan-web.service`，后端服务名为 `codex-app-server.service`，后台任务服务名为 `codex-web-tasks.service`。`codex-web service install` 保留已有后端配置，更新网页及任务服务文件，并让正在运行的服务继续运行。切换到新安装路径或配置后，通过重启使新设置生效。

安装脚本创建的后端服务从用户配置目录下的 `.env.backend` 读取环境变量，可在其中配置后端代理。已有后端服务的代理、登录环境和启动设置继续由原服务配置管理。更改后端配置后，在所有相关对话和终端空闲时重启后端服务。

查看状态与日志：

```bash
systemctl --user status codex-lan-web.service codex-app-server.service codex-web-tasks.service
journalctl --user -u codex-lan-web.service -n 100 --no-pager
journalctl --user -u codex-app-server.service -n 100 --no-pager
journalctl --user -u codex-web-tasks.service -n 100 --no-pager
curl http://127.0.0.1:8766/healthz
```

自定义网页端口时，相应替换健康检查地址。`/healthz` 在已连接 Codex 后端时返回 HTTP 200，后端未连接时返回 HTTP 503；响应包含连接状态 `ready` 和正在运行的网页服务版本 `version`。

## 后台任务

网页为对话自动接入后台任务 MCP 工具。模型可把有明确结束条件的长命令交给任务服务，结束当前轮次；任务成功、失败或超时后，网页服务读取退出码和日志，再继续同一对话。继续时沿用对话的模型配置并计入正常模型用量。当前对话仍在执行其他工作或整理上下文时，完成结果保留到空闲后处理。

安装 systemd 服务后，命令由独立的 `codex-web-tasks.service` 执行。关闭浏览器、结束模型轮次、卸载对话或重启网页服务后，命令继续运行；网页服务停用期间保存完成结果，恢复连接后继续处理。任务服务自身停止或主机重启时，正在执行的任务记为中断，已有日志和完成结果继续保留。迁移程序路径或修改任务服务配置后，等待后台命令结束，再执行 `systemctl --user restart codex-web-tasks.service`。

前台运行会在首次使用后台工具时启动本机任务进程。长期部署采用上述 systemd 安装方式，使任务进程拥有独立的服务生命周期；在其他进程管理器中运行时，需核对其进程组清理规则。自动继续由运行中的网页桥接和 Codex 后端共同处理。

任务及日志位于 `CODEX_HOME/codex-web/background/后端地址摘要/`，按 Codex 后端地址隔离，目录权限为当前用户专用。单个日志最多保存 64 MiB，较长日志可分段读取。取消任务同时停止其进程组并取消自动继续；归档对话关闭其自动继续，删除对话同时停止所属任务。任务结果投递的确认丢失时，服务先检查对话历史；需要人工核对的结果显示“继续结果待核对”，可显式检查并重试。

## 升级和回退

从目标版本的 Release 获取安装地址。当前版本的安装与服务更新命令为：

```bash
npm install -g https://github.com/hjd-hitsz/codex-web/releases/download/v2.3.1/codex-web-2.3.1.tgz
codex-web service install
codex-web service restart-when-idle
```

最后一个命令等待网页服务观察到的任务和上下文整理结束后自动重启，等待期间保持命令运行。打开或隐藏的网页终端不会阻塞更新，等待程序只重启网页服务。切换 Node.js 版本或 npm prefix 后，也需重新安装服务并重启，以更新服务中的安装路径。

日志显示实际等待的任务与上下文整理数量；执行重启后继续检查 `/healthz`，连接就绪时报告实际运行版本，重启或健康检查失败时保留失败状态。

升级后刷新网页，在“设置 → 关于”核对网页和服务版本。`codex-web version --json` 查看当前磁盘安装包，`/healthz` 中的 `version` 查看实际运行的服务，便于确认重启是否生效。

需要回退程序时，使用目标旧版本 Release 的 `.tgz` 安装地址重新安装，执行 `codex-web service install`，再等待空闲后重启。用户配置继续保留；涉及配置或数据迁移的版本，先查看对应发布说明。

服务安装会备份被覆盖的网页服务文件，默认位置为 `~/.local/state/codex-web/service-backups/时间戳/`；设置 `XDG_STATE_HOME` 时采用其下的对应目录。回退服务路径时，将备份的 `codex-lan-web.service` 恢复到用户服务目录，默认 `~/.config/systemd/user/`；设置 `XDG_CONFIG_HOME` 时使用其下的 `systemd/user/`。执行 `systemctl --user daemon-reload`，确认原安装路径仍可用，再等待空闲后重启网页服务。

## 数据保存与迁移

- 聊天记录和登录凭据由 Codex 自身管理。
- 草稿、置顶、项目快捷列表和主题保存在当前浏览器中。
- “未分类”对话的文件位于 `CODEX_HOME/codex-web/workspaces/chat-XXXXXX`，首次发送时分配；未设置 `CODEX_HOME` 时位于 `~/.codex/codex-web/workspaces`。迁移电脑时，可随 Codex 配置目录一起保留。
- 后台任务记录与日志位于 `CODEX_HOME/codex-web/background`，随 Codex 配置目录一起备份。迁移前结束任务进程；修改后端连接地址会切换对应的任务目录。
- 网页配置 `.env` 与新建后端服务使用的 `.env.backend` 位于用户配置目录，迁移时应一并保留；已有后端服务的配置按原部署方式迁移。
- 摘要翻译由服务所在电脑调用免费、免认证的 TranSmart 服务，浏览器仅访问当前网页服务；待译摘要会发送至 TranSmart，代码、路径和链接在发送前替换为占位符。

## 故障定位

网页不可访问时，先检查网页服务状态、监听端口和主机网络。网页可打开但显示后端未连接时，检查 Codex 后端服务日志、实际监听地址和本机 Codex 登录状态。

摘要翻译失败时，页面保留原文并提供重试入口。检查服务所在电脑能否访问 `transmart.qq.com`，以及翻译服务是否正常响应。升级后若本站 `/api/translate` 返回 404，先等待任务与网页终端空闲，再重启网页服务以加载翻译接口。

### 对话占用与后端回收

网页进入对话时先显示历史，再检查写入权。检查期间暂停输入；其他客户端持有写入权时，发送框位置显示占用说明和“重试”按钮。先在持有该对话的客户端结束任务并释放对话，再点击重试；成功后恢复输入框、草稿和附件，由用户继续发送。

网页会在对话空闲时释放自身的占用，下一次发送时自动恢复。关闭页面后，已经提交的任务继续执行，结束后释放占用。独立 Codex 客户端的占用由对应客户端和后端管理，结束任务后仍被占用时，需检查该客户端是否继续加载对话。

为使空闲对话及时释放，本项目启动的 Codex 后端使用以下命令，将无订阅对话的回收延迟设为零：

```bash
codex -c thread_unload_delay_secs=0 app-server --listen ws://127.0.0.1:8765
```

已有 `codex-app-server.service` 会保留原配置。使用 `systemctl --user cat codex-app-server.service` 检查启动命令，在原 Codex 命令中加入 `-c thread_unload_delay_secs=0`，保留原可执行路径、代理、登录环境和监听地址。该参数在后端启动时生效。

调整已有后端后，先确认所有连接到该后端的客户端均已结束相关任务和终端，再执行：

```bash
systemctl --user daemon-reload
systemctl --user restart codex-app-server.service codex-lan-web.service
```

`codex-web service restart-when-idle` 检查网页服务观察到的任务和上下文整理。重启后端还需确认其他客户端以及网页终端、对话后台终端的运行状态。
