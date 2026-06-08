# TASK

last_updated: 2026-06-08T06:03:29Z

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
- Implemented all three CLI diagnostics:
  - CLI/client active requests to `/api/fingerprint` are captured in memory.
  - `/proxy?target=...` forwards requests and captures redacted request/response headers and body summaries.
  - `scripts/cli-companion.mjs` uploads redacted Codex/Claude/OpenAI/Anthropic/Stainless/proxy environment, config-file summaries, and process command-line summaries to `/api/cli-report`.
- Added personal password mode. Setting `AUTH_PASSWORD` or `RT_REFRESH_PASSWORD` enables HTTP Basic Auth for the UI, API, proxy, and companion upload. Default user is `admin`.
- `scripts/cli-companion.mjs` supports `--basic-auth user:password` and sanitizes auth/endpoint arguments in uploaded reports.
- Added CTF raw capture mode. Setting `CAPTURE_REDACT=false` disables server-side redaction for `/api/fingerprint`, `/api/captures`, `/api/cli-report`, and `/proxy?target=...`; companion supports `--no-redact` / `RT_REFRESH_REDACT=false` for raw reports.
- Docker image now includes `scripts/cli-companion.mjs` under `/app/scripts/`.
- Imported file `scope` auto-fills the UI scope field when default/blank.
- Published repository to `https://github.com/zhizhishu/rt-refresh`.
- Pushed multi-arch GHCR images:
  - `ghcr.io/zhizhishu/rt-refresh:latest`
  - `ghcr.io/zhizhishu/rt-refresh:99c8b9a`
- `latest` supports `linux/amd64` and `linux/arm64`.

## Validation

- `npm test` passed: 10/10 tests.
- `node --check public/app.js` passed.
- `node --check src/server.js` passed.
- `node --check src/cpa.js` passed.
- `node --check scripts/cli-companion.mjs` passed.
- `docker compose config` passed.
- `docker buildx imagetools inspect ghcr.io/zhizhishu/rt-refresh:latest` shows `linux/amd64` and `linux/arm64`.
- Local runtime smoke passed for `/api/config`, `/api/fingerprint`, `DELETE /api/captures`, `POST /api/cli-report`, and `/proxy?target=...`; Authorization/RT/body auth fields were redacted.
- Password-protected runtime smoke passed: unauthenticated `/api/config` returned 401; authenticated `/api/config`, `/api/fingerprint`, `/api/cli-report`, and `/api/captures` worked.
- Raw capture runtime smoke passed: with `CAPTURE_REDACT=false`, captured headers/body/response auth fields were returned as original strings; companion `--no-redact` upload succeeded.
- Local Docker image smoke passed for `/api/config`, HTML banner, `/api/captures`, and companion script presence.
- After pulling the new GHCR image, raw-capture container smoke passed for `CAPTURE_REDACT=false` with original header value visible. Latest digest: `sha256:6e1678ad9af3514482e60efc7eae16cf9ab80c0b2b22b1eddbd8e0b0eb3a1251`.

## Server Update Command

- `cd /root/rt && docker compose pull && docker compose down && docker compose up -d`

## Next Diagnostic

- Deploy latest image and hard refresh browser.
- Use the new `0b. CLI / Proxy 捕获` panel for CLI active requests, proxy captures, and companion reports.
- For personal use, set `AUTH_USER` and `AUTH_PASSWORD` in Docker Compose before exposing the port.
- For CTF raw capture, set `CAPTURE_REDACT=false`; for companion raw report, add `--no-redact`.
- If a row reports `refresh_token_reused` or `app_session_terminated`, that RT is already unusable; use the newest JSON produced by the successful rotation or re-login to obtain a new RT.
