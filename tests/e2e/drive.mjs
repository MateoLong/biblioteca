// verify-biblioteca: Launch → Doctor → Drive → Evidence → Cleanup.
// Drives the real UI in Chromium against a fresh database and reads every side effect back from SQLite.
// Usage: npm run verify   (from tests/e2e)   → evidence in .verify/evidence/<stamp>/
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const STAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const EVIDENCE = join(ROOT, ".verify", "evidence", STAMP);
const DB = join(ROOT, ".verify", "tmp", `verify-${STAMP}.db`);
const PORT = 8811;
const BASE = `http://localhost:${PORT}`;
const TODAY = "2026-10-03"; // fixed so due dates and lateness are deterministic
mkdirSync(EVIDENCE, { recursive: true });
mkdirSync(dirname(DB), { recursive: true });

const results = [];
const readback = {};
let failed = 0;
function check(flow, claim, ok, detail = "") {
  results.push({ flow, claim, ok: Boolean(ok), detail: String(detail) });
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  [${flow}] ${claim}${detail ? ` — ${detail}` : ""}`);
}
const sql = (query) =>
  JSON.parse(execFileSync("python3", ["-c",
    "import sqlite3,json,sys;c=sqlite3.connect(sys.argv[1]);c.row_factory=sqlite3.Row;print(json.dumps([dict(r) for r in c.execute(sys.argv[2])]))",
    DB, query]).toString());
const addDays = (iso, n) => new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);

// ── Launch ──
const server = spawn("python3", [join(ROOT, "app", "server.py")], {
  env: { ...process.env, BIBLIO_DB: DB, BIBLIO_PORT: String(PORT), BIBLIO_NO_BROWSER: "1", BIBLIO_TODAY: TODAY },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));
const cleanup = () => { try { server.kill(); } catch {} };
process.on("exit", cleanup);

async function waitUp() {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`${BASE}/api/summary`); if (r.ok) return true; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

try {
  // ── Doctor ──
  check("doctor", "server answers /api/summary", await waitUp(), serverLog.trim());
  const idx = await fetch(BASE + "/");
  check("doctor", "page is served", idx.ok && (await idx.text()).includes("app.js"));
  const font = await fetch(BASE + "/fonts/PatrickHand-400.woff2");
  check("doctor", "fonts are served locally (no internet needed)", font.ok && font.headers.get("content-type") === "font/woff2");
  check("doctor", "database starts empty", sql("SELECT COUNT(*) n FROM books")[0].n === 0);

  const browser = await chromium.launch();
  const consoleErrors = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (e) => consoleErrors.push(e.message));
  // 409 is the API's normal "needs confirmation" answer; Chromium logs it as a failed resource.
  page.on("console", (m) => m.type() === "error" && !m.text().includes("status of 409") && consoleErrors.push(m.text()));
  const shot = (name, full = true) => page.screenshot({ path: join(EVIDENCE, `${name}.png`), fullPage: full });
  const go = async (hash) => { await page.goto(`${BASE}/#/${hash}`); await page.waitForLoadState("networkidle"); };

  // ── F1 first run → demo data ──
  await go("mostrador");
  check("first-run", "empty library shows the welcome state", await page.isVisible("[data-testid=first-run]"));
  await shot("01-first-run");
  await page.click("[data-action=load-demo]");
  await page.waitForSelector("[data-testid=demo-strip]:not([hidden])");
  const badge = await page.textContent("[data-testid=overdue-count]");
  readback.demo = sql("SELECT (SELECT COUNT(*) FROM books WHERE is_demo=1) books, (SELECT COUNT(*) FROM students WHERE is_demo=1) students, (SELECT COUNT(*) FROM loans WHERE returned_on IS NULL) open_loans, (SELECT COUNT(*) FROM loans WHERE returned_on IS NULL AND due_on < '" + TODAY + "') overdue")[0];
  check("first-run", "demo data loaded (12 books, 15 students, 9 out, 3 late)", readback.demo.books === 12 && readback.demo.students === 15 && readback.demo.open_loans === 9 && readback.demo.overdue === 3, JSON.stringify(readback.demo));
  check("first-run", "header badge shows 3 overdue", badge.trim() === "3", badge);
  await page.waitForSelector("[data-testid=loan-tile]");
  check("first-run", "9 loan tiles on the counter", (await page.$$("[data-testid=loan-tile]")).length === 9);
  await shot("02-mostrador-desktop");

  // ── F2 lend by typing ──
  await page.fill("[data-testid=lend-student]", "agus");
  await page.waitForSelector("#l-student-list li[data-i]");
  await page.keyboard.press("Enter");
  await page.fill("[data-testid=lend-book]", "principito");
  await page.waitForSelector("#l-copy-list li[data-i]");
  await page.keyboard.press("Enter");
  await page.click("[data-testid=lend-submit]");
  await page.waitForSelector("[data-testid=lend-result]");
  await page.waitForTimeout(1400); // let the label finish writing itself
  const resultText = await page.textContent("[data-testid=lend-result]");
  await shot("03-lent-signature", false);
  readback.lend = sql("SELECT s.name, b.title, c.code, l.lent_on, l.due_on FROM loans l JOIN students s ON s.id=l.student_id JOIN copies c ON c.id=l.copy_id JOIN books b ON b.id=c.book_id WHERE s.name='Agustina Silva' AND l.returned_on IS NULL");
  check("lend", "result shows student and book", resultText.includes("Agustina Silva") && resultText.includes("El Principito"), resultText.replace(/\s+/g, " ").slice(0, 120));
  check("lend", "DB has the open loan, due in 14 days", readback.lend.length === 1 && readback.lend[0].title === "El Principito" && readback.lend[0].due_on === addDays(TODAY, 14), JSON.stringify(readback.lend));
  const lentCode = readback.lend[0]?.code;
  check("lend", "focus is back on the student field for the next child", await page.evaluate(() => document.activeElement?.dataset.testid === "lend-student"));

  // ── F3 limit warns, override works ──
  for (const book of ["matilda", "mafalda"]) {
    await page.fill("[data-testid=lend-student]", "agustina");
    await page.waitForSelector("#l-student-list li[data-i]");
    await page.keyboard.press("Enter");
    await page.fill("[data-testid=lend-book]", book);
    await page.waitForSelector("#l-copy-list li[data-i]");
    await page.keyboard.press("Enter");
    await page.click("[data-testid=lend-submit]");
    await page.waitForSelector("[data-testid=lend-result], [data-testid=lend-warning]");
  }
  const warn = await page.textContent("[data-testid=lend-warning]").catch(() => "");
  check("limit", "third book shows the limit warning", warn.includes("ya tiene 2 libros"), warn.trim());
  await shot("04-limit-warning", false);
  check("limit", "nothing was written before confirming", sql("SELECT COUNT(*) n FROM loans l JOIN students s ON s.id=l.student_id WHERE s.name='Agustina Silva' AND returned_on IS NULL")[0].n === 2);
  await page.click("text=Prestar igual");
  await page.waitForSelector("[data-testid=lend-result]");
  readback.limit = sql("SELECT COUNT(*) n FROM loans l JOIN students s ON s.id=l.student_id WHERE s.name='Agustina Silva' AND returned_on IS NULL")[0];
  check("limit", "'Prestar igual' writes the third loan", readback.limit.n === 3, JSON.stringify(readback.limit));

  // ── F4 return with a scanner-style code + Enter, then undo ──
  await page.click("#tab-return");
  await page.fill("[data-testid=return-input]", lentCode);
  await page.keyboard.press("Enter");
  await page.waitForSelector("[data-testid=return-result]");
  await shot("05-returned", false);
  let row = sql(`SELECT l.id, l.returned_on FROM loans l JOIN copies c ON c.id=l.copy_id WHERE c.code='${lentCode}' ORDER BY l.id DESC LIMIT 1`)[0];
  check("return", "scanning the code + Enter returns it", row.returned_on === TODAY, JSON.stringify(row));
  await page.click(".toast .btn");
  await page.waitForTimeout(500);
  row = sql(`SELECT returned_on FROM loans WHERE id=${row.id}`)[0];
  check("return", "Deshacer reopens the loan", row.returned_on === null, JSON.stringify(row));
  readback.undo = row;

  // ── F5 questions ──
  await go("mostrador");
  await page.fill("[data-testid=ask-input]", "¿Quién tiene Matilda?");
  await page.waitForSelector("[data-testid=answer-book]");
  let answer = await page.textContent("[data-testid=answer]");
  check("ask", "'¿Quién tiene Matilda?' names who has each copy", answer.includes("Martina López") && answer.includes("Agustina Silva"), answer.replace(/\s+/g, " ").slice(0, 160));
  await shot("06-ask-who-has", false);
  await page.fill("[data-testid=ask-input]", "joaquin");
  await page.waitForSelector("[data-testid=answer-student]");
  answer = await page.textContent("[data-testid=answer]");
  check("ask", "student name (no accent) answers what they have", answer.includes("Joaquín Pereira") && answer.includes("Cuentos de la selva"), answer.replace(/\s+/g, " ").slice(0, 160));
  await page.click(".chip[data-ask='4°B']");
  await page.waitForFunction(() => document.querySelector("[data-testid=answer]").textContent.includes("4°B:"));
  answer = await page.textContent("[data-testid=answer]");
  check("ask", "class chip summarises 4°B", /4°B: 3 alumnos, \d+ libros prestados/.test(answer), answer.replace(/\s+/g, " ").slice(0, 120));
  await page.click(".chip[data-ask='atrasados']");
  await page.waitForFunction(() => document.querySelector("[data-testid=answer]").textContent.includes("atrasados"));
  answer = await page.textContent("[data-testid=answer]");
  check("ask", "'Atrasados' chip lists 3 late books", answer.includes("Hay 3 libros atrasados"), answer.replace(/\s+/g, " ").slice(0, 120));
  await page.fill("[data-testid=ask-input]", "zzzz");
  await page.waitForFunction(() => document.querySelector("[data-testid=answer]").textContent.includes("No encontré"));
  check("ask", "no match explains what to try", (await page.textContent("[data-testid=answer]")).includes("Probá con"));

  // ── F6 overdue page: oldest first, renew ──
  await go("atrasados");
  await page.waitForSelector("[data-testid=overdue-table]");
  const dues = await page.$$eval("[data-testid=overdue-table] tbody tr", (rows) => rows.map((r) => r.dataset.loan));
  const expected = sql(`SELECT id FROM loans WHERE returned_on IS NULL AND due_on < '${TODAY}' ORDER BY due_on`).map((r) => String(r.id));
  check("overdue", "table lists the late loans, oldest first", JSON.stringify(dues) === JSON.stringify(expected), `${dues} vs ${expected}`);
  await shot("07-atrasados-desktop");
  await page.click(`tr[data-loan="${dues[0]}"] [data-renew]`);
  await page.waitForTimeout(500);
  readback.renew = sql(`SELECT due_on FROM loans WHERE id=${dues[0]}`)[0];
  check("overdue", "Renovar gives 14 more days from today", readback.renew.due_on === addDays(TODAY, 14), JSON.stringify(readback.renew));
  check("overdue", "badge drops to 2", (await page.textContent("[data-testid=overdue-count]")).trim() === "2");

  check("toasts", "never more than 3 toasts on screen", (await page.$$(".toast")).length <= 3);

  // ── F7 add a book ──
  await go("libros");
  await page.click("[data-testid=add-book-toggle]");
  await page.fill("[data-testid=book-title]", "Corazón");
  await page.fill("[data-testid=book-author]", "Edmundo de Amicis");
  await page.fill("[data-testid=book-copies]", "2");
  await page.click("[data-testid=book-save]");
  await page.waitForSelector("[data-testid=copies-table]");
  readback.addBook = sql("SELECT b.title, b.is_demo, c.code FROM books b JOIN copies c ON c.book_id=b.id WHERE b.title='Corazón'");
  check("add-book", "book saved with 2 numbered copies, not marked demo", readback.addBook.length === 2 && readback.addBook.every((r) => /^B-\d{4}$/.test(r.code) && r.is_demo === 0), JSON.stringify(readback.addBook));
  await shot("08-libro-nuevo");

  // ── F8 add a student and import a CSV ──
  await go("alumnos");
  await page.click("[data-testid=add-student-toggle]");
  await page.fill("[data-testid=student-name]", "Ana Gómez");
  await page.fill("[data-testid=student-grade]", "5a");
  await page.click("[data-testid=student-save]");
  await page.waitForFunction(() => document.body.textContent.includes("Ana Gómez"));
  await go("ajustes");
  const csvPath = join(dirname(DB), "alumnos.csv");
  writeFileSync(csvPath, "Nombre;Clase\nPedro Ruiz;1°A\nLola Vega;1°A\nAna Gómez;5°A\n");
  await page.setInputFiles("[data-testid=import-students-file]", csvPath);
  await page.click("#import-students button[type=submit]");
  await page.waitForSelector("[data-testid=import-result]");
  const imp = await page.textContent("[data-testid=import-result]");
  readback.students = sql("SELECT name, grade, is_demo FROM students WHERE is_demo=0 ORDER BY name");
  check("students", "typed '5a' is stored as 5°A", readback.students.some((s) => s.name === "Ana Gómez" && s.grade === "5°A"), JSON.stringify(readback.students));
  check("students", "CSV import adds 2 and skips the duplicate", imp.includes("Cargué 2 alumnos") && imp.includes("1 ya estaban") && readback.students.length === 3, imp.trim());
  await shot("09-ajustes-import");

  // ── F9 edit a due date on the student page ──
  const martina = sql("SELECT id FROM students WHERE name='Martina López'")[0].id;
  await go(`alumnos/${martina}`);
  await page.waitForSelector("[data-testid=student-loans]");
  const dueInput = page.locator("[data-testid=student-loans] input[type=date]").first();
  const loanId = await dueInput.getAttribute("data-due");
  await dueInput.fill("2026-10-30");
  await dueInput.dispatchEvent("change");
  await page.waitForTimeout(500);
  readback.setDue = sql(`SELECT due_on FROM loans WHERE id=${loanId}`)[0];
  check("due-date", "changing the date on the student page saves it", readback.setDue.due_on === "2026-10-30", JSON.stringify(readback.setDue));
  await shot("10-alumno-detalle");

  // ── F10 exports ──
  // Read raw bytes: fetch().text() would silently strip the BOM that Excel needs.
  const csvBytes = Buffer.from(await (await fetch(`${BASE}/api/export/loans`)).arrayBuffer());
  const csv = csvBytes.toString("utf8");
  check("export", "loans CSV opens in Excel (BOM, ';', Spanish header)", csvBytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) && csv.includes("Código;Libro;Autor;Alumno;Clase"), csv.slice(1, 60));
  const backup = Buffer.from(await (await fetch(`${BASE}/api/export/backup`)).arrayBuffer());
  check("export", "backup is a real SQLite file", backup.subarray(0, 15).toString() === "SQLite format 3", `${backup.length} bytes`);

  // ── F11 clear demo keeps real data ──
  await go("ajustes");
  await page.click(".settings [data-action=clear-demo]");
  await page.waitForSelector("[data-testid=demo-strip][hidden]", { state: "attached" });
  readback.afterClear = sql("SELECT (SELECT COUNT(*) FROM books WHERE is_demo=1)+(SELECT COUNT(*) FROM students WHERE is_demo=1) demo, (SELECT COUNT(*) FROM books) books, (SELECT COUNT(*) FROM students) students, (SELECT COUNT(*) FROM loans) loans")[0];
  check("clear-demo", "only demo rows are gone; Corazón and the 3 real students stay", readback.afterClear.demo === 0 && readback.afterClear.books === 1 && readback.afterClear.students === 3 && readback.afterClear.loans === 0, JSON.stringify(readback.afterClear));

  // ── Mobile pass (390px) over every screen, with demo data back ──
  await fetch(`${BASE}/api/demo`, { method: "POST" });
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  phone.on("pageerror", (e) => consoleErrors.push("mobile: " + e.message));
  const bookId = sql("SELECT id FROM books WHERE title='Matilda'")[0].id;
  const studentId = sql("SELECT id FROM students WHERE name='Martina López'")[0].id;
  for (const r of ["mostrador", "atrasados", "libros", `libros/${bookId}`, "alumnos", `alumnos/${studentId}`, "ajustes"]) {
    await phone.goto(`${BASE}/#/${r}`);
    await phone.waitForLoadState("networkidle");
    const sw = await phone.evaluate(() => document.documentElement.scrollWidth);
    check("mobile", `#/${r} fits 390px without sideways scrolling`, sw <= 390, `scrollWidth ${sw}`);
    await phone.screenshot({ path: join(EVIDENCE, `m-${r.replace("/", "-")}.png`), fullPage: true });
  }
  for (const r of ["mostrador", "atrasados", "libros", "alumnos", "ajustes"]) {
    await go(r);
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    check("desktop", `#/${r} fits 1440px`, sw <= 1440, `scrollWidth ${sw}`);
  }
  // Impeccable review captures
  mkdirSync(join(ROOT, ".impeccable", "review"), { recursive: true });
  // Fresh pages, no leftover toasts, tiles rendered: a valid capture of the first screen.
  const openLoans = sql("SELECT COUNT(*) n FROM loans WHERE returned_on IS NULL")[0].n;
  for (const [file, width, height] of [["desktop.png", 1440, 900], ["mobile.png", 390, 844]]) {
    const fresh = await browser.newPage({ viewport: { width, height } });
    await fresh.goto(`${BASE}/#/mostrador`);
    await fresh.waitForFunction((n) => document.querySelectorAll("[data-testid=loan-tile]").length === n && !document.querySelector(".toast"), openLoans);
    await fresh.waitForTimeout(300);
    await fresh.screenshot({ path: join(ROOT, ".impeccable", "review", file), fullPage: true });
    await fresh.close();
  }

  check("console", "no JavaScript errors in any flow", consoleErrors.length === 0, consoleErrors.join(" | "));
  await browser.close();
} catch (err) {
  check("harness", "drive completed", false, err.stack || err.message);
} finally {
  // ── Evidence ── (cleanup never deletes evidence)
  writeFileSync(join(EVIDENCE, "results.json"), JSON.stringify({ stamp: STAMP, today: TODAY, db: DB, failed, results, readback }, null, 2));
  cleanup();
  console.log(`\n${results.length - failed}/${results.length} checks passed. Evidence: ${EVIDENCE}`);
  process.exit(failed ? 1 : 0);
}
