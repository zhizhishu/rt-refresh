# TASK

last_updated: 2026-06-07T19:20:31Z

## Current Goal

Maintain and publish `rt-refresh`: local/Docker UI for importing CPA/Codex JSON, refreshing RT into a new AT/RT pair, keeping only refreshed usable credentials, and exporting refreshed CPA JSON.

## Done

- Implemented dependency-free Node.js API and static UI.
- Supports CLIProxyAPI auth JSON, sub2api `credentials`, arrays, `accounts/items/data`, and JSONL.
- Added Dockerfile, local build compose, and GHCR image compose.
- Published repository to `https://github.com/zhizhishu/rt-refresh`.
- Pushed GHCR images:
  - `ghcr.io/zhizhishu/rt-refresh:latest`
  - `ghcr.io/zhizhishu/rt-refresh:1973d6b`

## Validation

- `npm test` passed: 4/4 tests.
- `docker compose config` passed.
- `docker compose -f docker-compose.ghcr.yml config` passed.
- `docker build -t rt-refresh:local .` passed.
- `docker manifest inspect ghcr.io/zhizhishu/rt-refresh:latest` succeeded.
- GHCR image E2E refresh test passed: batch input 3 accounts, 2 refreshed, 1 missing RT dropped by exclusive export, exported accounts had replaced AT and RT.

## Next

- Server direct image run: `docker run -d --name rt-refresh --restart unless-stopped -p 8787:8787 ghcr.io/zhizhishu/rt-refresh:latest`.
- Or `docker compose -f docker-compose.ghcr.yml up -d`.

## Cleanup

- Docker E2E test container removed.
- Mock OAuth process and temp script removed.
