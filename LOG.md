# LOG

## 2026-06-07T18:21:55Z

Initialized `rt-refresh` project and reference clones for CPA/Codex RT refresh UI work.

## 2026-06-07T18:37:45Z

Completed rt-refresh implementation. Tests passed, local HTTP check passed, Browser Relay timed out and was degraded to HTTP verification. GitHub repository pushed to https://github.com/zhizhishu/rt-refresh.

## 2026-06-07T19:02:25Z

Added Dockerfile/docker-compose deployment, fixed README placement, updated server host binding, validated npm tests, compose config, docker build, and container `/api/config`. Diagnosed Browser MCP/Relay: MCPDuck protocol and Relay CLI tabs are healthy; previous direct relay navigation timed out due to no leased tabId / partial tool exposure.

## 2026-06-07T19:11:28Z

Pushed Docker image to GHCR as `ghcr.io/zhizhishu/rt-refresh:latest` and `ghcr.io/zhizhishu/rt-refresh:1973d6b`. Added `docker-compose.ghcr.yml` and README instructions for image-based deployment. Verified remote manifest inspection.


## 2026-06-07T19:20:31Z

Ran GHCR image end-to-end refresh validation. Pulled `ghcr.io/zhizhishu/rt-refresh:latest` digest `sha256:f5031ca7c6b0b105247d4c6dc4522d4c60a47bb26875d64c07b5700d907dc973`, started container on host port 8790, used a local mock OAuth token endpoint, posted a batch with 3 accounts (2 with RT, 1 without RT). Result: refreshed=2, failed=1, exclusive export contained exactly 2 accounts with replaced access_token and refresh_token; no-RT account was dropped. Cleaned test container and mock process.

## 2026-06-08T01:35:15Z

Rebuilt and pushed GHCR multi-arch image with `docker buildx build --platform linux/amd64,linux/arm64`. Tags: `ghcr.io/zhizhishu/rt-refresh:latest` and `ghcr.io/zhizhishu/rt-refresh:0a1a913`. Verified `docker buildx imagetools inspect` shows both `linux/amd64` and `linux/arm64`. New multi-arch digest: `sha256:a86479ebe9871ff494122045ce8bc926912412ae2ccf9d3f0a6d8237ea670279`.

## 2026-06-08T01:41:37Z

Added UI multi-select improvements: file input now supports multiple files, drag-and-drop imports multiple JSON/JSONL/TXT files, and account selection toolbar supports select all refreshable, select none, and invert selection. Tests passed (`npm test`, `node --check public/app.js`, `node --check src/server.js`, `docker compose config`). Pushed multi-arch GHCR image tags `latest` and `ac43063`; verified `linux/amd64` and `linux/arm64` in manifest. New digest: `sha256:e4e9c7acbd5d0e017ee8818daeac58886c0fcb95527f8640ac7cd4a3ee1bf7f3`.

## 2026-06-08T01:50:50Z

Fixed export usability for CPA auth directories. Added separate merged JSON download and per-account CPA JSON batch download. UI now logs whether the refresh response returned a new RT; if no new RT is returned, the old RT cannot be assumed invalid. Tests passed (`npm test`, `node --check public/app.js`, `node --check src/server.js`, `docker compose config`). Pushed multi-arch GHCR image tags `latest` and `fc8a534`; verified amd64/arm64 manifest. Digest: `sha256:5f9138f1afd2e5c96609282c75dc3e216483dda45dfced9bc5e4487868c85b0a`.

## 2026-06-08T02:02:51Z

Improved refresh failure diagnostics after user observed 300/300 failures with `[object Object]`. Error formatting now JSON-stringifies object-shaped OAuth error payloads. Imported file `scope` is auto-applied when the UI scope is blank/default. Sample local credential structure (redacted) had `type=codex`, `refresh_token` present, no `client_id`, and `scope=openid email profile offline_access`. Tests passed and multi-arch GHCR image tags `latest` and `3a3e23c` were pushed. Digest: `sha256:47ad13a94353794b14280f73cb24ea595f731db6c5ee15c55d784139ad2517c0`.
