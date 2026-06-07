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
