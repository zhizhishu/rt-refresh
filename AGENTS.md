# AGENTS.md

## Project Rules

- Default language: Simplified Chinese for notes; keep code and protocol fields in English.
- This project is a standalone local UI/service for CPA/Codex credential JSON refresh.
- Never commit real CPA JSON, access tokens, refresh tokens, cookies, or captured credential files.
- `_references/` contains cloned upstream repos for research only.

## Commands

```bash
npm start
npm test
```

## Tool Routes

- Project memory updates -> mindfile.
- UI/browser verification -> Browser plugin when a local server is running.
- Broad unknown code search in this project -> local `rg` is enough unless the project grows.
