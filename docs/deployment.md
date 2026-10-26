# 部署与维护

## 配置

项目根目录的 `.env` 同时供 `npm start`、后端启动脚本和安装后的网页服务读取。配置模板为 `.env.example`。

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

如果安装脚本创建了新的后端服务，可以在项目根目录的 `.env.backend` 中配置后端代理环境。此文件已被 Git 忽略。已有后端服务的代理设置继续由原服务配置管理。

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
