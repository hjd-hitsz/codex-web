# 部署与维护

## 发行包与迁移

当前源码支持打包为全局 npm 工具。项目尚未发布到 npm registry，维护者可先构建可迁移的发行包：

```bash
npm ci
npm run check
npm pack
```

`npm pack` 的 `prepack` 会重新构建网页，生成 `codex-web-2.0.0.tgz`。包内包含命令行入口、前端构建资源、桥接代码和运行脚本；通过 `files` 白名单排除开发源码、测试、聊天数据和实际环境配置。运行依赖由 npm 安装，目标机器需要能获取 npm 依赖或具备相应缓存。

将 `.tgz` 复制到已配置 Node.js 24+、Codex CLI、zsh 和 systemd 的 Linux 机器，以运行 Codex 的用户完成本机 Codex 登录，然后执行：

```bash
npm install -g ./codex-web-2.0.0.tgz
codex-web service install
loginctl enable-linger "$USER"
codex-web service status
curl http://127.0.0.1:8766/healthz
```

`service install` 创建缺失的后端服务并安装网页服务，启用两者的自启动；已有后端服务继续使用原配置。`enable-linger` 由系统授权策略决定是否需要管理员操作，使用户服务可在开机后、登录前启动。目标机器的防火墙需允许访问网页端口。

全局安装支持以下命令：

- `codex-web` / `codex-web start`：前台运行网页桥接，连接配置中的后端。
- `codex-web backend`：前台运行 Codex app-server。
- `codex-web config init`：创建用户 `.env`，保留已有文件。
- `codex-web service install`：安装或更新服务文件，启动尚未运行的服务。
- `codex-web service status`：查看网页与后端状态。
- `codex-web service start` / `stop` / `restart`：启动、停止或重启网页服务；启动网页时也会拉起后端，停止网页时后端继续运行。
- `codex-web service restart-when-idle`：等待当前任务和网页终端结束后重启网页。

更新全局安装时，先安装新版包，再执行 `codex-web service install` 更新服务中的安装路径，最后执行 `codex-web service restart-when-idle`。切换 Node.js 版本或 npm prefix 后也采用此流程。全局安装与源码部署使用相同服务名，一台机器同一用户使用一套部署；从源码切换到全局包时，将需要保留的 `.env` 配置迁移到用户配置目录。

向 npm registry 发布需要维护者拥有包名发布权限并完成 npm 身份验证。确认包名和内容后执行 `npm publish ./codex-web-2.0.0.tgz --access public`；发布成功后其他机器即可使用 `npm install -g codex-web`。若选择作用域包名，应先修改根 `package.json` 的 `name` 并更新锁文件，再重新验证和打包；命令名仍为 `codex-web`。

## 配置

源码部署从项目根目录 `.env` 读取配置。全局命令从 `~/.config/codex-web/.env` 读取配置；设置 `XDG_CONFIG_HOME` 时使用其下的 `codex-web` 目录，设置 `CODEX_WEB_CONFIG_DIR` 时优先使用该目录。外部环境变量优先于 `.env`。全局服务安装会记录配置目录，后续启动与 npm 升级继续使用该目录。配置模板为包内 `.env.example`。

全局命令以用户配置目录作为工作目录，相对 `STATIC_DIR` 和 `DEFAULT_CWD` 据此解析。前端资源在未配置 `STATIC_DIR` 时自动定位到当前安装包的 `client/dist`。

- `HOST`：HTTP 监听地址，默认 `0.0.0.0`。
- `PORT`：网页端口，默认 `8766`。
- `CODEX_APP_SERVER_URL`：官方后端 WebSocket 地址，默认 `ws://127.0.0.1:8765`。
- `DEFAULT_CWD`：首次打开网页时的默认目录，默认当前操作系统用户的主目录。浏览器已经选择的项目目录优先。
- `STATIC_DIR`：前端资源目录，默认项目内的 `client/dist`。设置相对路径时，相对服务工作目录解析。

默认端口和监听方式支持通过 IP 直接打开网页。代码没有写死用户名、校园网 IP 或项目所在绝对路径。

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

`/healthz` 在桥接已连接官方后端时返回 HTTP 200 和 `{"ready":true}`；后端未连接时返回 HTTP 503。

## 更新和回退

前端更新执行 `npm run build` 即可，服务按文件修改时间重新读取资源。桥接服务修改需要重启 `codex-lan-web.service`。终端状态和输出缓存在桥接进程内，重启前应结束网页终端并等待任务空闲。

安装脚本保存被覆盖的网页服务文件。默认备份目录为 `~/.local/state/codex-web/service-backups/时间戳/`；设置 `XDG_STATE_HOME` 时采用对应目录。需要回退服务路径时，恢复该文件并执行 `systemctl --user daemon-reload`，然后重启网页服务。

运行中的任务需要继续执行时，使用 `npm run service:restart-when-idle`。此命令监听网页桥接状态，等待活动任务与终端均结束，再自动重启网页服务；等待期间保持该命令运行。

## 数据边界

- 聊天记录和登录凭据继续由 Codex 自身管理，不存放在本项目中。
- 草稿、置顶、项目快捷列表、主题和摘要译文保存在浏览器 localStorage 中。
- `.env`、`.env.backend`、依赖目录、构建目录和组件测试缓存不进入 Git。
- 生产服务直接读取项目构建目录，无需复制源码到另一个运行目录。

## 故障定位

网页不可访问时，先检查网页服务状态、监听端口和主机网络。网页可打开但显示后端未连接时，检查官方后端服务日志和 Codex 登录状态。摘要翻译失败时，页面会保留原文并提供重试入口；翻译与普通任务使用同一个本机 Codex 授权来源。
