# Verification

How we decide a change works. Adapted from poteto's [pstack](https://github.com/cursor/plugins/tree/main/pstack) ("if you want to go fast, go deep first"), the same rules as `vintagia/VERIFY.md`, sized for a one-person local app.

## 1. Prove it on the real thing

- Run the app, drive the screen, read the row back from SQLite. "It compiles" or "the agent says it works" is not evidence.
- Every claim carries a label: **measured** (ran it, saw it), **inferred** (read the code), or **guess**.
- A check that could not run is **inconclusive**, and inconclusive is not a pass.

## 2. Match the check to the change

| Change | Check |
|---|---|
| Registry logic (`app/registry.py`) | `python3 -m unittest discover -s tests` |
| UI or a flow | `npm run verify` in `tests/e2e` (drives Chromium at 1440 and 390 px, reads every write back from SQLite, saves screenshots) |
| Bug fix | Reproduce it first; add the failing check before the fix |

## 3. Tests that can fail

Before keeping a test, ask: would it still pass if the code under it returned nothing? If yes, rewrite it. Spot-check by mutating the code (e.g. make `days_late` always 0) and confirming a test goes red.

## 4. The `verify-biblioteca` skill

`.claude/skills/verify-biblioteca/SKILL.md`: **Launch** a server on a fresh DB with a fixed date → **Doctor** (server answers, fonts local, DB empty) → **Drive** every flow in `features/` → **Evidence** (screenshots + `results.json` with SQL read-backs in `.verify/evidence/<stamp>/`) → **Cleanup** (stop the server; evidence is never deleted).

## 5. Done means

Unit tests green, `npm run verify` green, and an independent agent (one that did not write the change) reviews the diff against `features/` and reruns the drive, returning **PASS**, **PASS+NOTES** or **FAIL**.

## 6. Always pause for a human

Anything that touches the real `datos/biblioteca.db` on the school computer, deleting non-demo data, or changing how backups are written.
