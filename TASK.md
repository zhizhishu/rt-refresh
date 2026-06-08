# TASK

last_updated: 2026-06-08T02:02:51Z

## Current Goal

Maintain and publish `rt-refresh`: local/Docker UI for importing CPA/Codex JSON, refreshing RT into a new AT/RT pair, keeping only refreshed usable credentials, and exporting refreshed CPA JSON.

## Done

- Implemented dependency-free Node.js API and static UI.
- Supports multi-file import and per-account CPA JSON batch download.
- Supports CLIProxyAPI auth JSON, sub2api `credentials`, arrays, `accounts/items/data`, and JSONL.
- Added account selection controls.
- Improved OAuth refresh failure diagnostics: object-shaped errors no longer display as `[object Object]`.
- Imported file `scope` auto-fills the UI scope field when default/blank.
- Published repository to `https://github.com/zhizhishu/rt-refresh`.
- Pushed multi-arch GHCR images:
  - `ghcr.io/zhizhishu/rt-refresh:latest`
  - `ghcr.io/zhizhishu/rt-refresh:3a3e23c`
- `latest` supports `linux/amd64` and `linux/arm64`.

## Validation

- `npm test` passed: 4/4 tests.
- `node --check public/app.js` passed.
- `node --check src/server.js` passed.
- `docker buildx imagetools inspect ghcr.io/zhizhishu/rt-refresh:latest` shows `linux/amd64` and `linux/arm64`.

## Server Update Command

- `cd /root/rt && docker compose pull && docker compose down && docker compose up -d`

## Next Diagnostic

- Retry refresh after updating. If failures remain, use the now-visible upstream error text (for example `invalid_grant`, `invalid_request`, `client_id` mismatch, or scope issue) to decide the next fix.
