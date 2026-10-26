# 部署与维护

## 发行包与迁移

预构建 npm 安装包通过 [GitHub Releases](https://github.com/hjd-hitsz/codex-web/releases) 分发。目标机器可以直接从 Release URL 安装，无需 npm registry 发布。维护者也可以从源码构建发行包：

```bash
npm ci
npm run check
npm pack
```

`npm pack` 的 `prepack` 会重新构建网页，生成 `codex-web-2.1.0.tgz`。包内包含命令行入口、前端构建资源、桥接代码和运行脚本；通过 `files` 白名单排除开发源码、测试、聊天数据和实际环境配置。运行依赖由 npm 安装，目标机器需要能获取 npm 依赖或具备相应缓存。

在已配置 Node.js 24+、Codex CLI、zsh 和 systemd 的 Linux 机器，以运行 Codex 的用户完成本机 Codex 登录，然后执行：

```bash
npm install -g https://github.com/hjd-hitsz/codex-web/releases/download/v2.1.0/codex-web-2.1.0.tgz
codex-web service install
loginctl enable-linger "$USER"
codex-web service status
curl http://127.0.0.1:8766/healthz
```

`service install` 创建缺失的后端服务并安装网页服务，启用两者的自启动；已有后端服务继续使用原配置。`enable-linger` 由系统授权策略决定是否需要管理员操作，使用户服务可在开机后、登录前启动。目标机器的防火墙需允许访问网页端口。

也可以下载或复制 Release 中的 `.tgz` 文件，以 `npm install -g ./codex-web-2.1.0.tgz` 安装。将 `.tgz.sha256` 校验文件放到同一目录，执行 `sha256sum -c codex-web-2.1.0.tgz.sha256` 可核对内容。GitHub 自动生成的 Source code 附件包含源码，预构建 npm 安装包位于 `.tgz` 附件中。

全局安装支持以下命令：

- `codex-web` / `codex-web start`：前台运行网页桥接，连接配置中的后端。
- `codex-web --version` / `codex-web version --json`：查看可读构建标识或完整提交与构建信息。
- `codex-web backend`：前台运行 Codex app-server。
- `codex-web config init`：创建用户 `.env`，保留已有文件。
- `codex-web service install`：安装或更新服务文件，启动尚未运行的服务。
- `codex-web service status`：查看网页与后端状态。
- `codex-web service start` / `stop` / `restart`：启动、停止或重启网页服务；启动网页时也会拉起后端，停止网页时后端继续运行。
- `codex-web service restart-when-idle`：等待当前任务和网页终端结束后重启网页。

更新全局安装时，先安装新版包，再执行 `codex-web service install` 更新服务中的安装路径，最后执行 `codex-web service restart-when-idle`。切换 Node.js 版本或 npm prefix 后也采用此流程。全局安装与源码部署使用相同服务名，一台机器同一用户使用一套部署；从源码切换到全局包时，将需要保留的 `.env` 配置迁移到用户配置目录。

向 npm registry 发布需要维护者拥有包名发布权限并完成 npm 身份验证。确认包名和内容后执行 `npm publish ./codex-web-2.1.0.tgz --access public`；发布成功后其他机器即可使用 `npm install -g codex-web`。若选择作用域包名，应先修改根 `package.json` 的 `name` 并更新锁文件，再重新验证和打包；命令名仍为 `codex-web`。

## 发布 GitHub Release

`.github/workflows/release.yml` 在推送 `v*` 标签时运行。流程执行 `npm run release:check`，核对根包、workspaces、锁文件、当前干净标签、变更日志、发布说明和安装链接，安装依赖并执行 `npm run check`，随后将带有构建来源的预构建 npm 包和 SHA-256 文件上传为正式 Release。发布说明读取 `docs/releases/标签名.md`。发布权限使用仓库工作流的 `GITHUB_TOKEN`，权限范围为 `contents: write`。

日常提交保持当前包版本，有实际影响的变更先记入 `CHANGELOG.md` 的“未发布”。发布时依据整个批次选择版本，执行 `npm run version:prepare -- patch`（或 `minor`、`major`、明确版本），审阅生成的发布说明，补充安装、升级或迁移信息。将 `GITHUB_REF_NAME` 设为本次标签，执行 `npm run check` 并提交。随后用实际版本替换下面的 `X.Y.Z`：

```bash
git tag -a vX.Y.Z -m "Codex Web vX.Y.Z"
npm run release:check
git push origin main vX.Y.Z
```

版本规则和完整工作流见 [版本管理](versioning.md)。标签对应的 Release 版本保持固定，后续改动积累到下一个版本。发布后检查 Actions 结果、Release 附件以及 README 安装地址，并下载附件验证校验和与全局安装。

## 配置

源码部署从项目根目录 `.env` 读取配置。全局命令从 `~/.config/codex-web/.env` 读取配置；设置 `XDG_CONFIG_HOME` 时使用其下的 `codex-web` 目录，设置 `CODEX_WEB_CONFIG_DIR` 时优先使用该目录。外部环境变量优先于 `.env`。全局服务安装会记录配置目录，后续启动与 npm 升级继续使用该目录。配置模板为包内 `.env.example`。

全局命令以用户配置目录作为工作目录，相对 `STATIC_DIR` 和 `DEFAULT_CWD` 据此解析。前端资源在未配置 `STATIC_DIR` 时自动定位到当前安装包的 `client/dist`。

- `HOST`：HTTP 监听地址，默认 `0.0.0.0`。
- `PORT`：网页端口，默认 `8766`。
- `CODEX_APP_SERVER_URL`：官方后端 WebSocket 地址，默认 `ws://127.0.0.1:8765`。
- `CODEX_HOME`：本机 Codex 配置目录，默认当前用户的 `~/.codex`。桥接从其中的 `.codex-global-state.json` 只读识别桌面端的无项目自动目录，合并为“未分类”；文件缺失或暂不可读时按对话实际目录展示。使用独立后端配置目录时，将此值设为对应桌面状态所在目录。
- `DEFAULT_CWD`：首次打开网页时的默认目录，默认当前操作系统用户的主目录。浏览器已经选择的项目目录优先。
- `STATIC_DIR`：前端资源目录，默认项目内的 `client/dist`。设置相对路径时，相对服务工作目录解析。

默认端口和监听方式支持通过 IP 直接打开网页。代码没有写死用户名、校园网 IP 或项目所在绝对路径。

网页在“未分类”中创建的对话使用 `CODEX_HOME/codex-web/workspaces/chat-XXXXXX` 作为独立工作目录，首次发送时分配。该目录保存任务生成的文件，迁移机器时可随 Codex 配置目录一起保留；聊天记录仍由后端管理。

## systemd 服务

`npm run service:install` 安装用户级服务并启用自动启动。安装步骤保留已经存在的后端服务，不重启正在运行的网页服务。迁移网页项目位置后，先执行安装脚本更新路径，再执行 `npm run service:restart` 切换到新代码。

需要让用户服务在退出登录后继续运行时，可由本机管理员为运行服务的用户启用 systemd linger：

```bash
loginctl enable-linger "$USER"
```

如果安装脚本创建了新的后端服务，可以在配置目录的 `.env.backend` 中配置后端代理环境（源码部署为项目根目录，全局安装为用户配置目录）。源码中的此文件已被 Git 忽略。已有后端服务的代理设置继续由原服务配置管理。

```bash
systemctl --user status codex-lan-web.service codex-app-server.service
journalctl --user -u codex-lan-web.service -n 100 --no-pager
curl http://127.0.0.1:8766/healthz
```

`/healthz` 在桥接已连接官方后端时返回 HTTP 200，后端未连接时返回 HTTP 503。响应包含 `ready` 和 `version` 对象，后者提供正式版本、可读构建标识、完整提交、工作区状态、构建通道与可用的构建时间。

## 更新和回退

前端更新执行 `npm run build` 即可，服务按文件修改时间重新读取资源。桥接服务修改需要重启 `codex-lan-web.service`。终端状态和输出缓存在桥接进程内，重启前应结束网页终端并等待任务空闲。

更新后在网页“设置 → 关于”分别核对网页与桥接版本，或对比 `codex-web version --json` 与 `/healthz` 的 `version`。全局命令查看磁盘中的安装包，健康接口查看实际运行的桥接进程；源码桥接的提交状态在进程启动时固定，网页来源在构建时固定。只有前端需要更新时，重新构建后刷新网页即可。

安装脚本保存被覆盖的网页服务文件。默认备份目录为 `~/.local/state/codex-web/service-backups/时间戳/`；设置 `XDG_STATE_HOME` 时采用对应目录。需要回退服务路径时，恢复该文件并执行 `systemctl --user daemon-reload`，然后重启网页服务。

运行中的任务需要继续执行时，使用 `npm run service:restart-when-idle`。此命令监听网页桥接状态，等待活动任务与终端均结束，再自动重启网页服务；等待期间保持该命令运行。

## 数据边界

- 聊天记录和登录凭据继续由 Codex 自身管理，不存放在本项目中。
- 草稿、置顶、项目快捷列表、主题和摘要译文保存在浏览器 localStorage 中。
- `.env`、`.env.backend`、依赖目录、构建目录和组件测试缓存不进入 Git。
- 生产服务直接读取项目构建目录，无需复制源码到另一个运行目录。

## 故障定位

网页不可访问时，先检查网页服务状态、监听端口和主机网络。网页可打开但显示后端未连接时，检查官方后端服务日志和 Codex 登录状态。摘要翻译失败时，页面会保留原文并提供重试入口；翻译与普通任务使用同一个本机 Codex 授权来源。

### 对话占用与后端回收

桥接按网页连接管理对话订阅。正常关闭页面会释放该连接的订阅；断网等异常断连通过 30 秒间隔的心跳在约 60 秒内识别。还有页面使用同一对话时保留订阅；已提交的任务继续执行，轮次完成后再取消最后一个订阅。

Codex app-server 默认在无订阅且无活动后等待 30 分钟再卸载对话；等待期间仍会持有对话写入占用。项目的 `npm run start:backend`、`codex-web backend` 和新建后端服务均使用以下启动参数，将回收延迟设为零：

```bash
codex -c thread_unload_delay_secs=0 app-server --listen ws://127.0.0.1:8765
```

已有 `codex-app-server.service` 会保留原配置。使用 `systemctl --user cat codex-app-server.service` 检查启动命令，在原 Codex 命令中加入 `-c thread_unload_delay_secs=0`，保留原可执行路径、代理、登录环境和监听地址。Codex CLI 0.162.1 的临时会话验证表明，该参数需要在后端启动时生效，单独覆盖 `thread/resume.config` 中的配置仍会保留对话。

调整已有后端时，先确认后端中所有已加载对话均空闲，网页终端和对话后台终端均已结束，再重启后端与网页服务。`service restart-when-idle` 只检查网页桥接观察到的任务和网页终端；后端还有其他连接时需一并检查。重启清除旧桥接遗留的空闲订阅，新连接按上述规则自动释放。[官方协议文档](https://learn.chatgpt.com/docs/app-server#unsubscribe-from-a-loaded-thread) 说明了取消订阅与延迟卸载的关系。
