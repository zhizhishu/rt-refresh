# TASK

last_updated: 2026-06-07T18:21:55Z

## Current Goal

Build `rt-refresh`: import CPA/Codex JSON, refresh RT into a new AT/RT pair, keep only refreshed usable credentials, and export refreshed CPA JSON through a small local UI.

## Done

- Created project boundary under storage root.
- Cloned upstream references into `_references/`.
- Identified OpenAI/Codex refresh flow and supported CPA/sub2api credential shapes.

## Next

- Implement server, UI, tests.
- Validate with mocked OAuth token endpoint.
- Initialize git and push to `zhizhishu/rt-refresh` if remote auth exists.
