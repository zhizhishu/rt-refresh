# PROJECT_CONTEXT

## Stable Facts

- Upstream references:
  - `router-for-me/CLIProxyAPI`: CPA auth JSON for Codex uses `type: "codex"` plus `access_token`, `refresh_token`, `id_token`, `email`, `account_id`, `last_refresh`, `expired`.
  - `Wei-Shaw/sub2api`: Codex import accepts plain strings, top-level tokens, nested `tokens.*`, and account `credentials.*`; OpenAI OAuth refresh posts form data to `/oauth/token` with `grant_type=refresh_token`, `refresh_token`, `client_id`, and `scope=openid profile email`.
- The app must not persist credentials. It imports in browser memory, sends refresh requests to local server, and exports refreshed JSON.

## Design Decision

- Use dependency-free Node.js + static HTML/CSS/JS to avoid setup delay and keep the tool portable.
