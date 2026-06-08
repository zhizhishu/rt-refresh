# TASK

last_updated: 2026-06-08T01:41:37Z

## Current Goal

Maintain and publish `rt-refresh`: local/Docker UI for importing CPA/Codex JSON, refreshing RT into a new AT/RT pair, keeping only refreshed usable credentials, and exporting refreshed CPA JSON.

## Done

- Implemented dependency-free Node.js API and static UI.
- Supports CLIProxyAPI auth JSON, sub2api `credentials`, arrays, `accounts/items/data`, and JSONL.
- Added multi-file import: file picker supports multiple files and drag-and-drop.
- Added account selection controls: select all refreshable, select none, invert selection.
- Added Dockerfile, local build compose, and GHCR image compose.
- Published repository to `https://github.com/zhizhishu/rt-refresh`.
- Pushed multi-arch GHCR images:
  - `ghcr.io/zhizhishu/rt-refresh:latest`
  - `ghcr.io/zhizhishu/rt-refresh:ac43063`
- `latest` supports `linux/amd64` and `linux/arm64`.

## Validation

- `npm test` passed: 4/4 tests.
- `node --check public/app.js` passed.
- `node --check src/server.js` passed.
- `docker compose config` passed.
- GHCR image E2E refresh test passed earlier.
- `docker buildx imagetools inspect ghcr.io/zhizhishu/rt-refresh:latest` shows `linux/amd64` and `linux/arm64`.

## Server Update Command

- `cd /root/rt && docker compose pull && docker compose down && docker compose up -d`

## Cleanup

- Multi-arch builder `rt-refresh-multi` remains available locally for future releases.
