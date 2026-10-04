---
name: verify-biblioteca
description: Prove a change to the Biblioteca app works by driving the real UI in WebKit at iPad sizes and reading every write back from IndexedDB. Use before calling any UI or registry change done.
---

# verify-biblioteca

1. **Launch + Doctor + Drive + Evidence + Cleanup** in one command:
   ```bash
   cd tests/e2e && npm install && npx playwright install webkit && npm run verify
   ```
   It serves `app/static/` on port 8811, pins the date to 2026-10-03, and drives every flow in `features/` in WebKit at iPad landscape (1180) with touch, then every screen at portrait 820 and 744. Every write is read back from IndexedDB; it also checks reload persistence, backup → restore onto an empty iPad, and opening with the host unreachable (offline).
2. Read the output: every line is `PASS`/`FAIL` with the SQL read-back or text it saw. Exit code is non-zero on any failure.
3. Evidence lands in `.verify/evidence/<stamp>/` (screenshots + `results.json`). Open the screenshots for anything visual; a passing check is not a design review.
4. Logic-only change: also run `npm test` from the repo root.
5. Adding a flow: add a `features/<flow>.md` (path + end state) and a block in `tests/e2e/drive.mjs` that drives it through the UI and reads the side effect back with `saved()`. No test-only endpoints.

Node: on this Mac `nvm use` does not stick; prefix `PATH=~/.nvm/versions/node/v22.23.2/bin:$PATH`.
