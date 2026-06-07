# TASK

last_updated: 2026-06-07T19:02:25Z

## Current Goal

Maintain and publish `rt-refresh`: local/Docker UI for importing CPA/Codex JSON, refreshing RT into a new AT/RT pair, keeping only refreshed usable credentials, and exporting refreshed CPA JSON.

## Done

- Created project boundary under storage root.
- Cloned upstream references into `_references/` for local research; references are gitignored.
- Implemented dependency-free Node.js API and static UI.
- Supports CLIProxyAPI auth JSON, sub2api `credentials`, arrays, `accounts/items/data`, and JSONL.
- Added exclusive export and canonical CPA auth array export.
- Added Dockerfile, `.dockerignore`, and `docker-compose.yml`.
- Server supports `HOST` and `PORT`; compose uses `HOST=0.0.0.0`, `PORT=8787`.
- Added README server and Docker Compose usage.
- Published repository to `https://github.com/zhizhishu/rt-refresh`.

## Validation

- `npm test` passed: 4/4 tests.
- `docker compose config` passed.
- `docker build -t rt-refresh:local .` passed.
- `docker run --rm -d --name rt-refresh-test -p 8788:8787 rt-refresh:local` passed; `/api/config` returned expected JSON.
- Test container removed.

## Browser MCP Note

- MCPDuck protocol check passed and listed Browser Relay tools.
- Browser Relay CLI `tabs` worked, proving relay service/extension is reachable.
- Earlier failure was likely caused by using `relay_navigate` without a leased `tabId`; current Codex tool exposure also lacked some Relay tools directly, so CLI fallback/lease flow should be used for real Chrome automation.

## Next

- On a server: `docker compose up -d --build`, then open `http://服务器IP:8787`.
- Import CTF CPA JSON and refresh against the configured token endpoint.

## Cleanup

- Docker test container removed.
