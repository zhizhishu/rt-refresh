# PROJECT_ID

project_name: rt-refresh
project_type: code
project_root: C:\Users\echo\Downloads\claude\rt-refresh
parent_storage_root: C:\Users\echo\Downloads\claude
created_at: 2026-06-07T18:21:55Z

## Boundaries

allowed_read:
- .

allowed_write:
- .

forbidden_paths:
- _references/CLIProxyAPI/.git
- _references/sub2api/.git
- node_modules

task_file: TASK.md
log_file: LOG.md

## Tool Policy

- Keep reference repos under `_references/` read-only unless explicitly updating references.
- Do not persist imported token JSON, RT, AT, cookies, or secrets in repo files.
