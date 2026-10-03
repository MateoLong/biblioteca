---
name: verify-biblioteca
description: Prove a change to the Biblioteca app works by driving the real UI against a fresh database and reading every write back from SQLite. Use before calling any UI or registry change done.
---

# verify-biblioteca

1. **Launch + Doctor + Drive + Evidence + Cleanup** in one command:
   ```bash
   cd tests/e2e && npm install && npm run verify
   ```
   It starts `app/server.py` on port 8811 with `BIBLIO_TODAY=2026-10-03` and a fresh DB under `.verify/tmp/`, checks the server, page, local fonts and empty DB, then drives every flow in `features/` at 1440 px and a mobile pass at 390 px.
2. Read the output: every line is `PASS`/`FAIL` with the SQL read-back or text it saw. Exit code is non-zero on any failure.
3. Evidence lands in `.verify/evidence/<stamp>/` (screenshots + `results.json`). Open the screenshots for anything visual; a passing check is not a design review.
4. Logic-only change: also run `python3 -m unittest discover -s tests` from the repo root.
5. Adding a flow: add a `features/<flow>.md` (path + end state) and a block in `tests/e2e/drive.mjs` that drives it through the UI and reads the side effect back with `sql(...)`. No test-only endpoints.

Node: on this Mac `nvm use` does not stick; prefix `PATH=~/.nvm/versions/node/v22.23.2/bin:$PATH`.
