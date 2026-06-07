# rt-refresh

一个独立的本地 CPA / Codex RT 刷新管理台：导入 CPA JSON，使用 RT 刷新 AT，导出只保留刷新成功凭证的新 CPA JSON。

## 来源研究

- `router-for-me/CLIProxyAPI`
  - Codex auth JSON 形态：`type: "codex"`、`access_token`、`refresh_token`、`id_token`、`account_id`、`email`、`expired`、`last_refresh`。
- `Wei-Shaw/sub2api`
  - Codex 导入兼容：顶层 token、`tokens.*`、`credentials.*`、数组、包装数组。
  - OpenAI/Codex RT 刷新：`POST /oauth/token`，form 字段为 `grant_type=refresh_token`、`refresh_token`、`client_id`、`scope=openid profile email`。

## 功能

- 导入 CLIProxyAPI / sub2api / JSONL 形态的 CPA JSON。
- 本地解析账号，显示 token 指纹，不直接展示密钥。
- 批量刷新 RT。
- 默认“exclusive”导出：只保留刷新成功的凭证。
- 支持标准 CPA auth 数组导出。
- 不持久化凭证：服务端不写入导入内容，前端只在浏览器内存保留。

> 如果目标 OAuth 服务支持 refresh-token rotation，刷新后返回的新 RT 会替换旧 RT，旧 RT 会失效；如果目标不轮换 RT，则只能得到新 AT，无法强制旧 RT 下线。

## 快速开始

```bash
npm start
```

打开：

```text
http://127.0.0.1:8787
```


## 直接使用 GHCR 镜像

镜像已推送到 GitHub Container Registry：

```text
ghcr.io/zhizhishu/rt-refresh:latest
ghcr.io/zhizhishu/rt-refresh:1973d6b
```

### docker run

```bash
docker run -d \
  --name rt-refresh \
  --restart unless-stopped \
  -p 8787:8787 \
  ghcr.io/zhizhishu/rt-refresh:latest
```

### docker compose 拉镜像运行

```bash
curl -O https://raw.githubusercontent.com/zhizhishu/rt-refresh/main/docker-compose.ghcr.yml
docker compose -f docker-compose.ghcr.yml up -d
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

