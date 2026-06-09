# rt-refresh

一个独立的本地 CPA / Codex RT 刷新管理台：导入 CPA JSON 或 raw RT，使用 RT 刷新 AT，导出只保留刷新成功凭证的新 CPA JSON，并提供 CTF 环境下的浏览器/CLI/代理请求头诊断。

## 来源研究

- `router-for-me/CLIProxyAPI`
  - Codex auth JSON 形态：`type: "codex"`、`access_token`、`refresh_token`、`id_token`、`account_id`、`email`、`expired`、`last_refresh`。
  - Codex 在线登录复用其 PKCE OAuth 参数：`/oauth/authorize`、`client_id=app_EMoamEEZ73f0CkXaXp7hrann`、`scope=openid email profile offline_access`、`prompt=login`、`id_token_add_organizations=true`、`codex_cli_simplified_flow=true`。
- `Wei-Shaw/sub2api`
  - Codex 导入兼容：顶层 token、`tokens.*`、`credentials.*`、数组、包装数组。
  - OpenAI/Codex RT 刷新：`POST /oauth/token`，form 字段为 `grant_type=refresh_token`、`refresh_token`、`client_id`、`scope=openid profile email`。
  - token exchange / refresh 统一使用 `User-Agent: codex-cli/0.91.0`。

## 功能

- 支持多选/拖拽导入多个 CLIProxyAPI / sub2api / JSONL 形态的 CPA JSON，也支持一行一个 `rt...` raw RT。
- 本地解析账号，显示 token 指纹，不直接展示密钥。
- 导入凭证明细面板：显示来源文件、email/account/user/org/plan、AT/RT/ID 摘要或 CTF 原文、AT 剩余时间。
- 5 小时窗口面板：优先展示导入 JSON 内的 `quota_5h_*` / `rate_limit_reset_at` 等字段；没有字段时按 `last_refresh + 5h` 做本地窗口估算。
- 在线 Codex 登录：生成 Codex PKCE 登录链接，处理 `/oauth/callback`，回调成功后可从内存列表下载 CPA JSON。
- 刷新失败会显示上游 OAuth 返回的真实错误，而不是 `[object Object]`。
- 批量刷新 RT，支持保守串行、请求间隔、临时错误重试和指数退避。
- 账号勾选支持全选可刷新、全不选、反选。
- 默认“exclusive”导出：只保留刷新成功的凭证。
- 支持标准 CPA auth 数组导出。
- 单账号导出打包为 ZIP；推荐用于 CLIProxyAPI `auths/` 目录。刷新后 ZIP 只含刷新成功的新凭证，原始 ZIP 只做备份。
- 正常凭证 ZIP 导出：按刷新结果/导入字段筛掉 401、402、需要重新登录、明确无额度的凭证；429 只视为限速，不当异常。
- `NV CTF / #jshook 000` 授权标识展示。
- `/api/fingerprint`：记录请求该接口的客户端 headers，适合让 Codex/Claude CLI 主动访问以获取真实 CLI UA/headers。
- `/proxy?target=...`：诊断代理，转发请求并在内存里记录请求/响应 headers 与脱敏 body 摘要。
- `/api/cli-report`：接收本地 companion 上传的 Codex/Claude 环境、进程、配置文件摘要/脱敏预览。
- OAuth 登录接口：`GET /api/oauth/start`、`POST /api/oauth/exchange`、`GET /oauth/callback`、`GET /api/oauth/latest`、`GET /api/oauth/download/latest`。
- 个人密码模式：设置 `AUTH_PASSWORD` 或 `RT_REFRESH_PASSWORD` 后，网页、API、Proxy、Companion 上传全部需要 HTTP Basic Auth。
- CTF 原文捕获模式：设置 `CAPTURE_REDACT=false` 后，服务端捕获不再脱敏；companion 加 `--no-redact` 或 `RT_REFRESH_REDACT=false` 后上传原文报告。
- 不持久化凭证：服务端不写入导入内容，前端只在浏览器内存保留。

> 如果目标 OAuth 服务支持 refresh-token rotation，并且刷新响应返回新 RT，导出文件会替换为新 RT，旧 RT 可能被服务端废弃；如果目标不轮换 RT 或不返回新 RT，本工具不能保证旧 RT 一定失效。

## 快速开始

```bash
npm start
```

打开：

```text
http://127.0.0.1:8787
```

个人使用建议启用密码：

```bash
AUTH_USER=admin AUTH_PASSWORD='change-this-password' npm start
```

Windows PowerShell：

```powershell
$env:AUTH_USER='admin'; $env:AUTH_PASSWORD='change-this-password'; npm start
```


## 直接使用 GHCR 镜像

镜像已推送到 GitHub Container Registry：

```text
ghcr.io/zhizhishu/rt-refresh:latest
ghcr.io/zhizhishu/rt-refresh:a3de128
```

当前 `latest` 支持 `linux/amd64` 和 `linux/arm64`。

### docker run

```bash
docker run -d \
  --name rt-refresh \
  --restart unless-stopped \
  -e AUTH_USER=admin \
  -e AUTH_PASSWORD='change-this-password' \
  -e CAPTURE_REDACT=false \
  -p 8787:8787 \
  ghcr.io/zhizhishu/rt-refresh:latest
```

### docker compose 拉镜像运行

```bash
curl -O https://raw.githubusercontent.com/zhizhishu/rt-refresh/main/docker-compose.ghcr.yml
AUTH_USER=admin AUTH_PASSWORD='change-this-password' CAPTURE_REDACT=false docker compose -f docker-compose.ghcr.yml up -d
```

打开：

```text
http://服务器IP:8787
```
## Docker Compose 部署

```bash
docker compose up -d --build
```

打开：

```text
http://服务器IP:8787
```

本项目默认容器内监听 `0.0.0.0:8787`，本地 `npm start` 默认监听 `127.0.0.1:8787`。如果放到远端服务器，建议只在可信内网或反代鉴权后访问；工具本身不会保存凭证，但浏览器页面里会短暂持有你导入的 CPA JSON。

停止：

```bash
docker compose down
```

## 一键捕获 / CLI 诊断

如果启用了密码，浏览器会弹登录框。最简单的用法是在“要采集的本机”运行临时探针命令：创建临时目录，下载探针脚本，若本机没有 Node 18+ 则临时下载 portable Node，自动完成 CLI 打点和 companion 上传，最后删除临时目录并退出。

Linux / macOS：

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/zhizhishu/rt-refresh/main/scripts/temp-probe.sh)" -- --base http://服务器IP:8787 --basic-auth admin:change-this-password --raw
```

Windows PowerShell：

```powershell
$u='https://raw.githubusercontent.com/zhizhishu/rt-refresh/main/scripts/temp-probe.ps1';$p=Join-Path $env:TEMP ('rt-probe-'+[guid]::NewGuid()+'.ps1');iwr -useb $u -OutFile $p;powershell -NoProfile -ExecutionPolicy Bypass -File $p -Base 'http://服务器IP:8787' -BasicAuth 'admin:change-this-password' -Raw;rm $p
```

如果你已经在项目目录里，也可以用本地命令：

```bash
npm run probe -- --base http://服务器IP:8787 --basic-auth admin:change-this-password --raw
```

运行完成后，回浏览器点“0b. 一键捕获 / CLI 捕获”里的“刷新捕获”。

如需顺便测试代理转发：

```bash
npm run probe -- --base http://服务器IP:8787 --basic-auth admin:change-this-password --raw --proxy-target https://example.test/path
```

参数：

- `--base`：rt-refresh 服务地址。
- `--basic-auth`：网页密码，格式 `用户名:密码`。
- `--raw`：本机 companion 原文上传；服务端也要设置 `CAPTURE_REDACT=false` 才会原文保存捕获。
- `--proxy-target`：可选；提供后会额外走一次 `/proxy?target=...`。

临时探针清理规则：

- 探针脚本下载到系统临时目录。
- portable Node 只解压到本次临时目录。
- 正常结束或报错退出都会删除本次临时目录。
- 不写入 npm 全局包、不创建项目目录、不修改系统 PATH。

下面是拆开的高级用法，正常不用看，除非你想单独测某一路。

### 1. CLI 主动访问本服务

让任意 CLI 或脚本请求：

```bash
curl -A "codex-cli/0.91.0" http://127.0.0.1:8787/api/fingerprint
```

启用密码时：

```bash
curl -u admin:'change-this-password' -A "codex-cli/0.91.0" http://127.0.0.1:8787/api/fingerprint
```

服务会在“CLI / Proxy 捕获”里记录该请求的服务端可见 headers。

### 2. 诊断代理捕获 headers

把目标请求发到：

```text
http://127.0.0.1:8787/proxy?target=https://example.test/path
```

启用密码时：

```bash
curl -u admin:'change-this-password' -A "claude-cli-test/1.0" "http://127.0.0.1:8787/proxy?target=https://example.test/path"
```

或用环境变量指定基础目标：

```bash
PROXY_TARGET_BASE=https://example.test npm start
```

然后请求 `/proxy/...`。服务会转发请求，并记录请求/响应 headers 与 body 摘要。默认敏感字段脱敏；`CAPTURE_REDACT=false` 时不脱敏。

### 3. 本地 companion 上传 Codex/Claude 诊断

```bash
npm run companion -- --endpoint http://127.0.0.1:8787/api/cli-report
```

如果服务启用了密码，传 `--basic-auth 用户名:密码`：

```bash
npm run companion -- --endpoint http://127.0.0.1:8787/api/cli-report --basic-auth admin:change-this-password
```

默认采集：

- Codex/Claude/OpenAI/Anthropic/Stainless/proxy 相关环境变量
- 常见 `~/.codex` / `~/.claude` 配置文件存在性、大小、mtime、sha256、脱敏预览
- Codex/Claude/OpenAI/Anthropic 相关本机进程命令行的脱敏摘要

默认不上传原始 secret/token/cookie。若在 CTF 内网明确需要原文预览，可加：

```bash
npm run companion -- --endpoint http://127.0.0.1:8787/api/cli-report --include-raw
```

CTF 原文报告模式：

```bash
npm run companion -- --endpoint http://127.0.0.1:8787/api/cli-report --basic-auth admin:change-this-password --no-redact
```

捕获记录保存在服务内存中，重启即清空。

## 正常凭证筛选导出

“下载正常凭证ZIP”会从当前导入内容和最近一次刷新结果里筛选可继续使用的凭证：

- 保留：刷新成功的凭证、没有异常标记且有 AT/RT 的导入凭证。
- 保留：`429` / `rate_limited`，它只代表限速，本工具不把它当成需要重登的异常。
- 排除：`401`、`402`、`app_session_terminated`、`refresh_token_reused`、`invalid_grant`、`invalid_client`、登录/重登提示、billing/payment/明确无额度。
- 排除：导入 JSON 明确给出 `quota_5h_remaining <= 0`，或 `quota_5h_used >= quota_5h_limit`。
- 没有 quota 字段时不强行判死刑；只按 token、过期时间和最近刷新错误筛。

刷新后再点这个按钮时，刷新成功账号会优先导出新 CPA；429 这类限速账号会保留原始 CPA。

## 在线 Codex 登录 / OAuth 回调

网页登录区的“生成登录链接”会创建一组内存 PKCE session，并返回授权地址。默认回调：

```text
http://你的服务地址/oauth/callback
```

接口：

```text
GET  /api/oauth/start
POST /api/oauth/exchange
GET  /oauth/callback
GET  /api/oauth/latest
GET  /api/oauth/download/latest
GET  /api/oauth/download/:id
```

可选环境变量：

- `OAUTH_AUTH_URL`：默认 `https://auth.openai.com/oauth/authorize`。
- `OAUTH_TOKEN_URL`：默认 `https://auth.openai.com/oauth/token`。
- `OAUTH_REDIRECT_URI`：固定回调地址；不设置时按当前请求 Host 自动拼 `/oauth/callback`。

回调成功后的 CPA JSON 只保存在服务内存里，重启清空；下载接口直接返回 `attachment` JSON。

## 导入凭证与 5 小时窗口

“导入凭证 / 5小时窗口”面板会解析当前输入框里的 CPA JSON / JSONL / raw RT：

- 凭证来源：原始文件名、账号名、email、account_id。
- Token 展示：默认只显示长度和首尾摘要；点“显示原文凭证”后显示 AT/RT/ID 原文。
- AT 剩余：从 `expires_at` / `expired` / `tokens.expires_at` 推算。
- 5 小时窗口：优先读取 `quota_5h_limit`、`quota_5h_used`、`quota_5h_remaining`、`quota_5h_reset_at`、`rate_limit_reset_at`；没有这些字段时，用 `last_refresh` 到 `last_refresh + 5h` 估算。

注意：本地估算不是上游实时额度查询；若 CTF 目标返回了真实 quota 字段，面板会优先显示那些字段。别把估算当圣旨，宝宝。

## 个人密码模式

环境变量：

- `AUTH_USER` / `RT_REFRESH_USER`：用户名，默认 `admin`。
- `AUTH_PASSWORD` / `RT_REFRESH_PASSWORD`：密码；为空时关闭密码保护。
- `AUTH_REALM`：浏览器登录框显示的 realm，默认 `rt-refresh`。
- `CAPTURE_REDACT`：服务端捕获脱敏开关，默认 `true`；设置为 `false` / `0` / `no` / `off` / `raw` 时不脱敏。
- companion 原文上传：加 `--no-redact`，或设置 `RT_REFRESH_REDACT=false`。

开启后以下路径全部需要密码：

- 网页静态资源
- `/api/config`
- `/api/fingerprint`
- `/api/captures`
- `/api/cli-report`
- `/api/analyze`
- `/api/refresh`
- `/api/oauth/*`
- `/oauth/callback`
- `/proxy?target=...`

注意：HTTP Basic Auth 只是访问控制；如果你把服务放公网，建议再套 HTTPS 反代或 SSH 隧道，否则密码会在明文 HTTP 链路上传输。

## 测试

```bash
npm test
```

测试使用本地 mock OAuth token endpoint，不会访问真实网络。

## 配置

UI 中可配置：

- `Token URL`：默认 `https://auth.openai.com/oauth/token`
- `Client ID`：默认 Codex CLI client id
- `Scope`：默认 `openid profile email`
- `User-Agent`：默认 `codex-cli/0.91.0`

## 安全落盘规则

不要提交真实：

- CPA JSON
- `access_token`
- `refresh_token`
- `id_token`
- Cookie / session token

`.gitignore` 已排除常见本地文件，但凭证文件名千奇百怪，别靠运气。

