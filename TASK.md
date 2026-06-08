# TASK

last_updated: 2026-06-08T04:11:30Z

## Current Goal

Maintain and publish `rt-refresh`: local/Docker UI for importing CPA/Codex JSON, refreshing RT into a new AT/RT pair, keeping only refreshed usable credentials, and exporting refreshed CPA JSON.

## Done

- Implemented dependency-free Node.js API and static UI.
- Supports multi-file import and per-account CPA JSON batch download.
- Supports CLIProxyAPI auth JSON, sub2api `credentials`, arrays, `accounts/items/data`, JSONL, and pasted raw `rt...` lines.
- Added account selection controls.
- Improved OAuth refresh failure diagnostics: object-shaped errors no longer display as `[object Object]`.
- Added OAuth code hints for `refresh_token_reused`, `app_session_terminated`, `invalid_grant`, `invalid_scope`, and `invalid_client`.
- Suppressed per-row `not_selected` noise by returning a skip count unless detailed skip rows are explicitly requested.
- Split single-account exports into explicit refreshed downloads and original-import backups to prevent accidentally downloading stale credentials as refreshed output.
- Single-account exports are packaged as ZIP files instead of triggering many separate JSON downloads.
- Conservative refresh mode follows reference-project behavior: serial requests, configurable per-account interval, total retry attempts, exponential backoff, and no retries for `invalid_grant` / `refresh_token_reused` / session-ended style credential errors.
- Added NV CTF / `#jshook 000` banner and a browser-visible environment fingerprint panel with server-observed request header echo. Sensitive request headers are redacted.
- Imported file `scope` auto-fills the UI scope field when default/blank.
- Published repository to `https://github.com/zhizhishu/rt-refresh`.
- Pushed multi-arch GHCR images:
  - `ghcr.io/zhizhishu/rt-refresh:latest`
  - `ghcr.io/zhizhishu/rt-refresh:2f01baf`
- `latest` supports `linux/amd64` and `linux/arm64`.

## Validation

- `npm test` passed: 10/10 tests.
- `node --check public/app.js` passed.
- `node --check src/cpa.js` passed.
- `docker compose config` passed.
- `docker buildx imagetools inspect ghcr.io/zhizhishu/rt-refresh:latest` shows `linux/amd64` and `linux/arm64`.
- After pulling the new image, container `/api/config`, `/api/fingerprint`, and HTML banner smoke tests passed for digest `sha256:c91ffcf01bb0e26e49019b9687be20b7568db84a94a95303461e8dd3733d743a`.

## Server Update Command

- `cd /root/rt && docker compose pull && docker compose down && docker compose up -d`

## Next Diagnostic

- Deploy latest image and hard refresh browser. If a row reports `refresh_token_reused` or `app_session_terminated`, that RT is already unusable; use the newest JSON produced by the successful rotation or re-login to obtain a new RT.
