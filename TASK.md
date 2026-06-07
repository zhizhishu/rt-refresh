# TASK

last_updated: 2026-06-07T18:37:45Z

## Current Goal

Build and publish `rt-refresh`: import CPA/Codex JSON, refresh RT into a new AT/RT pair, keep only refreshed usable credentials, and export refreshed CPA JSON through a small local UI.

## Done

- Created project boundary under storage root.
- Cloned upstream references into `_references/` for local research; references are gitignored.
- Implemented dependency-free Node.js API and static UI.
- Supports CLIProxyAPI auth JSON, sub2api `credentials`, arrays, `accounts/items/data`, and JSONL.
- Added exclusive export and canonical CPA auth array export.
- Added tests with mocked OAuth token endpoint.
- Published repository to `https://github.com/zhizhishu/rt-refresh`.

## Validation

- `npm test` passed: 4/4 tests.
- Local HTTP check passed for `/api/config` and `/` page content.
- Browser Relay navigation attempted but timed out; local HTTP verification used as fallback.

## Next

- Use `npm start` and open `http://127.0.0.1:8787`.
- Import CTF CPA JSON and refresh against the configured token endpoint.

## Cleanup

- Local test server stopped and `.rt-refresh.pid` removed.
