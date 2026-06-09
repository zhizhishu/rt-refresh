# TASK

last_updated: 2026-06-09T06:21:18Z

## Current Goal

Maintain and publish `rt-refresh`: local/Docker UI for importing CPA/Codex JSON, refreshing RT into a new AT/RT pair, keeping only refreshed usable credentials, and exporting refreshed CPA JSON.

## Done

- Added explicit single-file `导出 CPA JSON（Sub2API转换）` button that converts current Sub2API/wrapped input into CPA/Codex auth JSON array; refreshed successes use new tokens, unrefreshed rows are converted and retained.
- Added explicit `导出 CPA 凭证ZIP` button bound to the CLIProxy/Codex normal credential ZIP export path.
- Added 30-per-page paginated, collapsible account overview and imported credential/5h-window panels with page/global selection controls.
- Added weekly quota display for `quota_weekly_*`, `quota_7d_*`, `weekly_quota_*`, and `weekly.*` fields without removing 5h quota display.
- Changed refreshed/normal ZIP export paths to produce CLIProxyAPI/Codex auth JSON; original/Sub2API shape remains only in the explicit original/Sub backup ZIP.
- CLIProxy canonical export now preserves 5h and weekly quota metadata.
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
- Added one-command local probe: `npm run probe -- --base http://服务器IP:8787 --basic-auth admin:密码 --raw`. It performs CLI fingerprint hit + companion upload, optionally proxy test with `--proxy-target`, then exits.
- Added no-residue temporary probe launchers:
  - `scripts/temp-probe.sh` for Linux/macOS.
  - `scripts/temp-probe.ps1` for Windows PowerShell.
  - They create a temporary directory, download probe scripts, optionally download portable Node if Node 18+ is missing, run the probe, and delete the temporary directory on exit.
- Fixed refreshed ZIP export:
  - ZIP entry names now use the original CPA filename / account name after flattening wrapped CPA JSON, so multi-account/wrapped imports do not fall back to wrong `entry-*` names.
  - Download actions now also show a fallback clickable download link when the browser blocks or misses the automatic Blob download.
- Docker image now includes `scripts/cli-companion.mjs` under `/app/scripts/`.
- Imported file `scope` auto-fills the UI scope field when default/blank.
- Published repository to `https://github.com/zhizhishu/rt-refresh`.
- Pushed multi-arch GHCR images:
  - `ghcr.io/zhizhishu/rt-refresh:latest`
  - `ghcr.io/zhizhishu/rt-refresh:3e3475e`
- `latest` supports `linux/amd64` and `linux/arm64`.

- Added online Codex OAuth login / callback flow based on reference projects:
  - `GET /api/oauth/start` creates in-memory PKCE session and returns Codex authorize URL.
  - `GET /oauth/callback` exchanges code with Codex token endpoint using `codex-cli/0.91.0` User-Agent.
  - `GET /api/oauth/latest` lists in-memory login results.
  - `GET /api/oauth/download/latest` / `:id` downloads CPA JSON.
- Added imported credential details panel:
  - Shows source, email/account/user/org/plan, AT/RT/ID summary or CTF raw token text.
  - Shows AT remaining time.
  - Shows 5-hour quota/window from imported `quota_5h_*` / `rate_limit_reset_at` fields, or local `last_refresh + 5h` estimate when no upstream quota field exists.
- Updated README with OAuth APIs, quota display rules, and reference-derived OAuth parameters.
- Pushed multi-arch GHCR images:
  - `ghcr.io/zhizhishu/rt-refresh:latest`
  - `ghcr.io/zhizhishu/rt-refresh:0451056`
- `latest` digest: `sha256:fbf9842e94ef7bd3bf7bdb6693dba0b8560552c33763b68063dca6dbb802e4b3`.

- Added normal-credential ZIP export button:
  - Excludes 401, 402, re-login/session-ended/reused/invalid-grant style errors, billing/payment, and explicit no-quota fields.
  - Keeps 429/rate-limited rows because they are treated as throttling rather than credential abnormality.
  - Uses refreshed canonical CPA for successful rows and original imported CPA for retained non-refreshed rows.

- Added remote CPA one-shot clean/write-back workflow:
  - `POST /api/remote-cpa/pull` pulls Sub2API-compatible `/api/v1/admin/accounts/data` into the UI.
  - `POST /api/remote-cpa/clean` pulls, refreshes RTs once, filters invalid credentials, returns invalid log, and optionally writes cleaned data back to `/api/v1/admin/accounts/data`.
  - UI panel `0d. 远程 CPA 一次性清洗 / 回导` supports x-api-key/Bearer/Basic auth, filters, require-RT toggle, write-back confirmation, and invalid-log download.
  - 401/402/re-login/reused/invalid-grant/no-quota are dropped; 429/rate-limited is retained as throttling.

## Validation

- Local HTTP smoke confirmed `导出 CPA JSON（Sub2API转换）` button, event binding, conversion function, and unrefreshed-row conversion branch.
- Local HTTP smoke confirmed `导出 CPA 凭证ZIP` is present and bound to `downloadNormalCredentials`.
- `node --check public/app.js` passed after pagination/export changes.
- `node --check src/cpa.js` passed after canonical metadata preservation.
- `npm test` passed: 11/11 tests, including quota metadata preservation in CLIProxy canonical export.
- Local HTTP smoke confirmed CLIProxy ZIP labels, canonical default checkbox, pagination controls, weekly quota strings, and CLIProxy normal export logic are served.
- `git diff --check` passed; only Git CRLF conversion warnings were reported.
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
- Quick probe runtime smoke passed locally with and without `--proxy-target`.
- Windows temporary probe smoke passed from GitHub raw URL; `rt-refresh-probe-*` temporary directory count was unchanged before/after, confirming cleanup.
- Frontend syntax check passed after adding refreshed ZIP source-name flattening and download fallback link.
- Local Docker image smoke passed for `/api/config`, HTML banner, `/api/captures`, and companion script presence.
- Pulled GHCR image smoke passed for `/api/config`; HTML includes `downloadFallback` and temporary probe instructions. Latest digest: `sha256:54e41be4e98b6b2e52065b9f1b37ee00e46a70bfc34834d764ce2b1766e2f826`.

- Added feature validation:
  - `node --check src/server.js` passed.
  - `node --check public/app.js` passed.
  - OAuth mock smoke passed for `/api/oauth/start`, `/oauth/callback`, `/api/oauth/latest`, `/api/oauth/download/latest`, and UI panel presence.
  - GHCR pulled-image smoke passed for `/api/config`, OAuth panel, quota panel, `/api/oauth/start`, and `/api/captures`.
  - `docker buildx imagetools inspect ghcr.io/zhizhishu/rt-refresh:latest` shows `linux/amd64` and `linux/arm64`; digest `sha256:fbf9842e94ef7bd3bf7bdb6693dba0b8560552c33763b68063dca6dbb802e4b3`.

- Normal credential export validation:
  - `node --check public/app.js` passed.
  - `node --check src/server.js` passed.
  - `npm test` passed: 10/10 tests.
  - Local HTTP smoke confirmed `下载正常凭证ZIP` button, handler binding, and 429-not-abnormal rule are present.

- Remote CPA workflow validation:
  - `node --check src/server.js` passed.
  - `node --check public/app.js` passed.
  - `npm test` passed: 10/10 tests.
  - Local Sub2API/CPA mock smoke passed: pull 4 accounts, refresh good account, retain 429, drop 401 and explicit no-quota, write back 2 cleaned accounts, and verify UI panel presence.

## Server Update Command

- `cd /root/rt && docker compose pull && docker compose down && docker compose up -d`

## Next Diagnostic

- Deploy latest image (`0451056` / digest `sha256:fbf9842e94ef7bd3bf7bdb6693dba0b8560552c33763b68063dca6dbb802e4b3`) and hard refresh browser.
- Use the new `0b. CLI / Proxy 捕获` panel for CLI active requests, proxy captures, and companion reports.
- For personal use, set `AUTH_USER` and `AUTH_PASSWORD` in Docker Compose before exposing the port.
- For CTF raw capture, set `CAPTURE_REDACT=false`; for companion raw report, add `--no-redact`.
- Prefer the one-command probe for browser capture docs instead of showing three separate paths.
- Prefer the temporary no-residue launcher when the target machine should not keep project files or Node installs.
- If browser says ZIP was packaged but no file appears, use the generated fallback download link shown above the output box.
- If a row reports `refresh_token_reused` or `app_session_terminated`, that RT is already unusable; use the newest JSON produced by the successful rotation or re-login to obtain a new RT.
