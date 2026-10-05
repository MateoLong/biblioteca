# Verification

How we decide a change works. Adapted from poteto's [pstack](https://github.com/cursor/plugins/tree/main/pstack) ("if you want to go fast, go deep first"), the same rules as `vintagia/VERIFY.md`, sized for a one-person local app.

## 1. Prove it on the real thing

- Run the app, drive the screen, read the saved data back from the device storage. "It compiles" or "the agent says it works" is not evidence.
- Every claim carries a label: **measured** (ran it, saw it), **inferred** (read the code), or **guess**.
- A check that could not run is **inconclusive**, and inconclusive is not a pass.

## 2. Match the check to the change

| Change | Check |
|---|---|
| Registry logic (`app/static/registry.js`) | `npm test` |
| UI or a flow | `npm run verify` in `tests/e2e` (drives WebKit, Safari's engine, at iPad landscape 1180 and portrait 820/744 with touch; reads every write back from IndexedDB; reload, backup→restore and offline checks; saves screenshots) |
| Bug fix | Reproduce it first; add the failing check before the fix |

## 3. Tests that can fail

Before keeping a test, ask: would it still pass if the code under it returned nothing? If yes, rewrite it. Spot-check by mutating the code (e.g. make `daysLate` always 0) and confirming a test goes red.

## 4. The `verify-biblioteca` skill

`.claude/skills/verify-biblioteca/SKILL.md`: **Launch** a static server, fresh browser storage, fixed date → **Doctor** (every file served, manifest valid) → **Drive** every flow in `features/` → **Evidence** (screenshots + `results.json` with IndexedDB read-backs in `.verify/evidence/<stamp>/`) → **Cleanup** (stop the server; evidence is never deleted).

## 5. Done means

Unit tests green, `npm run verify` green, and an independent agent (one that did not write the change) reviews the diff against `features/` and reruns the drive, returning **PASS**, **PASS+NOTES** or **FAIL**.

## 6. Always pause for a human

Publishing or changing the public address, anything that could wipe data on her iPad (e.g. changing the storage key or the backup format without a migration), deleting non-demo data.

## 7. Verification log

There are no PRs (solo project committed to `main`), so verdicts are recorded here. Evidence folders are local (`.verify/evidence/`, gitignored).

| Date | Change | Checks | Independent verdict |
|---|---|---|---|
| 2026-10-03 | First version (Python + SQLite) | unit 22, e2e 44/44 | Verifier **PASS+NOTES** (duplicate codes left half-written rows → fixed and tested). Impeccable finish review: recapture, fix, fix, **ship**. |
| 2026-10-03 | iPad port (static PWA, IndexedDB, offline) | unit 25, e2e 63/63 in WebKit at iPad sizes | No fresh independent run. Live site smoke-tested on an emulated iPad, including offline. |
| 2026-10-03 | Excel .xlsx import; loan import; .xlsx downloads | unit 44 (planted bugs caught), e2e 68/68; files opened in Microsoft Excel | No fresh independent run. A re-import duplicate bug was caught by our own test and fixed. |
| 2026-10-04 | Coalesced saves (found while building Mis clases) | unit 44, e2e 68/68 | Covered by the Mis clases verifier's save probe (300 rapid writes survive a reload). |
| 2026-10-04 | "Cómo se usa" help screen (`#/ayuda`, "?" in the band), next-step hints in empty histories | unit 44, e2e 79/79 (new checks mutated red, then reverted) | Verifier **PASS+NOTES**: two help steps over-promised (clearing demo data also removes real loans of demo books; a broken copy is "Dar de baja", not archive) → reworded, along with the same promise in Ajustes and its toast. |
| 2026-10-04 | Book colour is the age band (azul 0–7, rojo 7–10, verde 10–12; grey until set): picker, Libros filter, Excel Color/Edad column, ADR 0005 | unit 49, e2e 88/88 (band audit on 5 screens; planted regressions caught) | Verifier **PASS+NOTES**, data safety measured: state and backups from the previous version load unchanged with every book "Sin color". Fixed after: Excel date-mangled "7-10" read back; unreadable colour no longer drops the book; restore tidies hand-edited colours; e2e band audit added. |
| 2026-10-04 | Clases: a sheet per class, a row per student, one Fecha for the sheet; Prestado day at the counter and on the student page; dated returns; undo a loan (ADR 0006) | unit 55, e2e 117/117 (planted bugs caught: returns ignore their day, lent day ignored, new-day guard removed) | Verifier **FAIL** → fixed: an app left open overnight saved loans with yesterday's date (now checks the day before saving and redraws on wake); a due date typed for a loan lent last year landed a year late; a lent day just ahead was read as last year (now refused); 29/02 of last year was not understood. Typed-date rules moved to `typedDay` in registry.js with unit tests; a year other than this one is now shown next to the weekday. |
| 2026-10-04 | Book card: Editorial, Idioma, Sección, a note per copy; catalogue import one row per copy (ADR 0007); Libros filters by idioma and sección | unit 58, e2e 124/124 (planted bug — repeated rows skipped instead of grouped — caught). Her real catalogue (1,220 books / 1,308 copies) imported through Ajustes in WebKit at iPad size in ~2 s, re-import adds nothing, no layout overflow at 744 | No fresh independent run yet. |

## 8. Open items

- **Not yet tried on her real iPad.** Check: Add to Home Screen, the keyboard over the counter fields, the backup file landing in Files, and her real Excel lists.
- **Clearing demo data** also removes a real student's loans of demo books (by design: the demo copies go away).
- **Her real Excel layout is assumed**, not seen: one tab per class, one row per student. If her sheet has more (e.g. a column per month), the Clases screen may need a history column.
- **Old iPads** (before iPadOS 16.4) cannot read .xlsx and are told to paste the rows instead.
