// verify-biblioteca: Launch → Doctor → Drive → Evidence → Cleanup.
// Drives the real app in WebKit (Safari's engine) at iPad sizes with touch, and reads every
// change back from what the page saved on the device (IndexedDB).
// Usage: npm run verify   (from tests/e2e)   → evidence in .verify/evidence/<stamp>/
import { webkit } from "playwright";
import { createServer } from "node:http";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const STATIC = join(ROOT, "app", "static");
const STAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const EVIDENCE = join(ROOT, ".verify", "evidence", STAMP);
const PORT = 8811;
const BASE = `http://localhost:${PORT}`;
const TODAY = "2026-10-03"; // fixed so due dates and lateness are deterministic
const IPAD_LANDSCAPE = { viewport: { width: 1180, height: 820 }, hasTouch: true, deviceScaleFactor: 1 };
const IPAD_PORTRAIT = { viewport: { width: 820, height: 1180 }, hasTouch: true, deviceScaleFactor: 1 };
mkdirSync(EVIDENCE, { recursive: true });

const results = [];
const readback = {};
let failed = 0;
function check(flow, claim, ok, detail = "") {
  results.push({ flow, claim, ok: Boolean(ok), detail: String(detail) });
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  [${flow}] ${claim}${detail ? ` — ${detail}` : ""}`);
}
const addDays = (iso, n) => new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);

// ── Launch: a plain static server, like any web host ──
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png",
  ".woff2": "font/woff2", ".webmanifest": "application/manifest+json", ".json": "application/json" };
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, BASE).pathname)).replace(/^(\.\.[/\\])+/, "");
  const file = join(STATIC, path === "/" ? "index.html" : path);
  if (!file.startsWith(STATIC) || !existsSync(file)) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(PORT, r));

const browsers = [];
try {
  // ── Doctor ──
  for (const f of ["index.html", "app.js", "registry.js", "local-api.js", "sw.js", "manifest.webmanifest", "apple-touch-icon.png", "fonts/PatrickHand-400.woff2"]) {
    const r = await fetch(`${BASE}/${f}`);
    check("doctor", `${f} is served`, r.ok, r.status);
  }
  const manifest = await (await fetch(`${BASE}/manifest.webmanifest`)).json();
  check("doctor", "manifest makes it a standalone Home Screen app", manifest.display === "standalone" && manifest.icons.length >= 2);

  const wk = await webkit.launch();
  browsers.push(wk);
  const consoleErrors = [];
  const newIpad = async (opts = IPAD_LANDSCAPE) => {
    const ctx = await wk.newContext({ ...opts, acceptDownloads: true });
    await ctx.addInitScript((d) => { globalThis.BIBLIO_TODAY = d; }, TODAY);
    const p = await ctx.newPage();
    p.on("pageerror", (e) => consoleErrors.push(e.message));
    p.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
    return { ctx, page: p };
  };
  const { ctx, page } = await newIpad();
  const shot = (name, full = true, p = page) => p.screenshot({ path: join(EVIDENCE, `${name}.png`), fullPage: full });
  const go = async (hash, p = page) => { await p.goto(`${BASE}/#/${hash}`); await p.waitForSelector("#main > *"); await p.waitForTimeout(150); };
  // What is actually stored on the device, after every pending write has finished.
  const saved = (p = page) => p.evaluate(() => globalThis.__biblio.saved());
  const openLoans = (st) => st.loans.filter((l) => l.returned_on == null);
  const studentNamed = (st, name) => st.students.find((s) => s.name === name);
  const bookTitled = (st, title) => st.books.find((b) => b.title === title);
  const copyOf = (st, id) => st.copies.find((c) => c.id === id);

  // ── F1 first run → demo data, survives a reload ──
  await go("mostrador");
  check("first-run", "empty library shows the welcome state", await page.isVisible("[data-testid=first-run]"));
  await shot("01-first-run");
  await page.tap("[data-action=load-demo]");
  await page.waitForSelector("[data-testid=demo-strip]:not([hidden])");
  let st = await saved();
  readback.demo = { books: st.books.filter((b) => b.is_demo).length, students: st.students.filter((s) => s.is_demo).length,
    open: openLoans(st).length, overdue: openLoans(st).filter((l) => l.due_on < TODAY).length };
  check("first-run", "demo data saved on the device (12 books, 15 students, 9 out, 3 late)", JSON.stringify(readback.demo) === '{"books":12,"students":15,"open":9,"overdue":3}', JSON.stringify(readback.demo));
  check("first-run", "header badge shows 3 overdue", (await page.textContent("[data-testid=overdue-count]")).trim() === "3");
  await page.reload();
  await page.waitForSelector("[data-testid=loan-tile]");
  check("persistence", "after closing and reopening, the 9 loans are still there", (await page.$$("[data-testid=loan-tile]")).length === 9);
  await shot("02-mostrador-ipad");

  // ── F2 lend: tap a suggestion with a finger, Enter for the book ──
  await page.fill("[data-testid=lend-student]", "agus");
  await page.waitForSelector("#l-student-list li[data-i]");
  await page.tap("#l-student-list li[data-i]");
  check("lend", "tapping a suggestion picks the student", (await page.textContent("[data-testid=picked-student]").catch(() => "")).includes("Agustina Silva"));
  await page.fill("[data-testid=lend-book]", "principito");
  await page.waitForSelector("#l-copy-list li[data-i]");
  await page.keyboard.press("Enter");
  check("lend", "the Vuelve line shows dd/mm and its weekday", (await page.inputValue("[data-testid=lend-due]")) === "17/10" && (await page.textContent("#l-due-day")) === "sábado");
  await page.tap(".due-chips .chip[data-days='7']");
  check("lend", "'1 semana' chip sets 10/10", (await page.inputValue("[data-testid=lend-due]")) === "10/10");
  await page.tap(".due-chips .chip[data-days='14']");
  await page.tap("[data-testid=lend-submit]");
  await page.waitForSelector("[data-testid=lend-result]");
  await page.waitForTimeout(1400); // let the label finish writing itself
  await shot("03-lent-signature", false);
  st = await saved();
  const agus = studentNamed(st, "Agustina Silva");
  const lent = openLoans(st).filter((l) => l.student_id === agus.id);
  readback.lend = lent.map((l) => ({ code: copyOf(st, l.copy_id).code, lent_on: l.lent_on, due_on: l.due_on }));
  const lentCode = readback.lend[0]?.code;
  check("lend", "saved: Agustina has El Principito, due in 14 days", lent.length === 1 && copyOf(st, lent[0].copy_id).book_id === bookTitled(st, "El Principito").id && lent[0].due_on === addDays(TODAY, 14), JSON.stringify(readback.lend));
  check("lend", "focus is back on Nombre for the next child", await page.evaluate(() => document.activeElement?.dataset.testid === "lend-student"));

  // ── F3 limit warns, override works ──
  for (const book of ["matilda", "mafalda"]) {
    await page.fill("[data-testid=lend-student]", "agustina");
    await page.waitForSelector("#l-student-list li[data-i]");
    await page.keyboard.press("Enter");
    await page.fill("[data-testid=lend-book]", book);
    await page.waitForSelector("#l-copy-list li[data-i]");
    await page.keyboard.press("Enter");
    await page.tap("[data-testid=lend-submit]");
    await page.waitForSelector("[data-testid=lend-result], [data-testid=lend-warning]");
  }
  const warn = await page.textContent("[data-testid=lend-warning]").catch(() => "");
  check("limit", "third book shows the limit warning", warn.includes("ya tiene 2 libros"), warn.trim().split("\n")[0]);
  await shot("04-limit-warning", false);
  check("limit", "nothing saved before confirming", openLoans(await saved()).filter((l) => l.student_id === agus.id).length === 2);
  await page.tap("text=Prestar igual");
  await page.waitForSelector("[data-testid=lend-result]");
  check("limit", "'Prestar igual' saves the third loan", openLoans(await saved()).filter((l) => l.student_id === agus.id).length === 3);

  // ── F4 return with a scanner-style code + Enter, then undo ──
  await page.tap("#tab-return");
  await page.fill("[data-testid=return-input]", lentCode);
  await page.keyboard.press("Enter");
  await page.waitForSelector("[data-testid=return-result]");
  await shot("05-returned", false);
  st = await saved();
  const back = st.loans.filter((l) => copyOf(st, l.copy_id).code === lentCode).pop();
  check("return", "scanning the code + Enter saves the return", back.returned_on === TODAY, JSON.stringify(back));
  await page.tap(".toast .btn");
  await page.waitForTimeout(300);
  readback.undo = (await saved()).loans.find((l) => l.id === back.id);
  check("return", "Deshacer reopens the loan", readback.undo.returned_on === null);

  // ── F5 questions ──
  await go("mostrador");
  await page.fill("[data-testid=ask-input]", "¿Quién tiene Matilda?");
  await page.waitForSelector("[data-testid=answer-book]");
  let answer = await page.textContent("[data-testid=answer]");
  check("ask", "'¿Quién tiene Matilda?' names who has each copy", answer.includes("Martina López") && answer.includes("Agustina Silva"), answer.replace(/\s+/g, " ").slice(0, 120));
  await shot("06-ask-who-has", false);
  await page.fill("[data-testid=ask-input]", "joaquin");
  await page.waitForSelector("[data-testid=answer-student]");
  answer = await page.textContent("[data-testid=answer]");
  check("ask", "student name without accent answers what they have", answer.includes("Joaquín Pereira") && answer.includes("Cuentos de la selva"));
  await page.tap(".chip[data-ask='4°B']");
  await page.waitForFunction(() => document.querySelector("[data-testid=answer]").textContent.includes("4°B:"));
  check("ask", "class chip summarises 4°B", /4°B: 3 alumnos, \d+ libros prestados/.test(await page.textContent("[data-testid=answer]")));
  await page.tap(".chip[data-ask='atrasados']");
  await page.waitForFunction(() => document.querySelector("[data-testid=answer]").textContent.includes("atrasados"));
  check("ask", "'Atrasados' chip lists 3 late books", (await page.textContent("[data-testid=answer]")).includes("Hay 3 libros atrasados"));
  await page.fill("[data-testid=ask-input]", "zzzz");
  await page.waitForFunction(() => document.querySelector("[data-testid=answer]").textContent.includes("No encontré"));
  check("ask", "no match explains what to try", (await page.textContent("[data-testid=answer]")).includes("Probá con"));

  // ── F6 overdue page: oldest first, renew ──
  await go("atrasados");
  await page.waitForSelector("[data-testid=overdue-table]");
  const rows = await page.$$eval("[data-testid=overdue-table] tbody tr", (trs) => trs.map((r) => r.dataset.loan));
  st = await saved();
  const expected = openLoans(st).filter((l) => l.due_on < TODAY).sort((a, b) => (a.due_on < b.due_on ? -1 : 1)).map((l) => String(l.id));
  check("overdue", "late loans listed oldest first", JSON.stringify(rows) === JSON.stringify(expected), `${rows} vs ${expected}`);
  await shot("07-atrasados");
  await page.tap(`tr[data-loan="${rows[0]}"] [data-renew]`);
  await page.waitForTimeout(300);
  readback.renew = (await saved()).loans.find((l) => l.id === Number(rows[0])).due_on;
  check("overdue", "Renovar gives 14 more days from today", readback.renew === addDays(TODAY, 14), readback.renew);
  check("overdue", "badge drops to 2", (await page.textContent("[data-testid=overdue-count]")).trim() === "2");

  // ── F7 add a book ──
  await go("libros");
  await page.tap("[data-testid=add-book-toggle]");
  await page.fill("[data-testid=book-title]", "Corazón");
  await page.fill("[data-testid=book-author]", "Edmundo de Amicis");
  await page.fill("[data-testid=book-copies]", "2");
  await page.tap("[data-testid=book-save]");
  await page.waitForSelector("[data-testid=copies-table]");
  st = await saved();
  const corazon = bookTitled(st, "Corazón");
  readback.addBook = st.copies.filter((c) => c.book_id === corazon?.id).map((c) => c.code);
  check("add-book", "book saved with 2 numbered copies, not demo", corazon && !corazon.is_demo && readback.addBook.length === 2 && readback.addBook.every((c) => /^B-\d{4}$/.test(c)), JSON.stringify(readback.addBook));
  await shot("08-libro-nuevo");

  // ── F8 add a student; import by pasting rows (the iPad way) and by file ──
  await go("alumnos");
  await page.tap("[data-testid=add-student-toggle]");
  await page.fill("[data-testid=student-name]", "Ana Gómez");
  await page.fill("[data-testid=student-grade]", "5a");
  await page.tap("[data-testid=student-save]");
  await page.waitForFunction(() => document.body.textContent.includes("Ana Gómez"));
  await go("ajustes");
  await page.fill("[data-testid=import-students-paste]", "Pedro Ruiz\t1°A\nLola Vega\t1°A\nAna Gómez\t5°A");
  await page.tap("#import-students button[type=submit]");
  await page.waitForSelector("#import-students [data-testid=import-result]");
  const imp = await page.textContent("#import-students [data-testid=import-result]");
  const csvPath = join(EVIDENCE, "libros.csv");
  writeFileSync(csvPath, "Titulo;Autor;Ejemplares\nCuentos para chicos;Roy Berocay;1\n");
  await page.setInputFiles("[data-testid=import-books-file]", csvPath);
  await page.tap("#import-books button[type=submit]");
  await page.waitForSelector("#import-books [data-testid=import-result]");
  st = await saved();
  readback.students = st.students.filter((s) => !s.is_demo).map((s) => `${s.name} ${s.grade}`).sort();
  check("students", "typed '5a' is saved as 5°A", readback.students.includes("Ana Gómez 5°A"), JSON.stringify(readback.students));
  check("students", "pasted rows add 2 and skip the duplicate", imp.includes("Cargué 2 alumnos") && imp.includes("1 ya estaban") && readback.students.length === 3, imp.trim());
  check("books", "CSV file import saves the book", Boolean(bookTitled(st, "Cuentos para chicos")));
  await shot("09-ajustes-import");

  // ── F9 edit a due date as dd/mm on the student page ──
  await go(`alumnos/${studentNamed(st, "Martina López").id}`);
  await page.waitForSelector("[data-testid=student-loans]");
  const dueInput = page.locator("[data-testid=student-loans] input[data-due]").first();
  const loanId = Number(await dueInput.getAttribute("data-due"));
  await dueInput.fill("30/10");
  await dueInput.press("Tab");
  await page.waitForTimeout(400);
  readback.setDue = (await saved()).loans.find((l) => l.id === loanId).due_on;
  check("due-date", "typing 30/10 saves 2026-10-30", readback.setDue === "2026-10-30", readback.setDue);
  check("due-date", "one save, one toast", (await page.$$eval(".toast", (ts) => ts.filter((t) => t.textContent.includes("Nueva fecha")).length)) === 1);
  await shot("10-alumno-detalle");

  // ── F10 files: Excel export, backup, restore onto an empty iPad ──
  await go("ajustes");
  const [csvDl] = await Promise.all([page.waitForEvent("download"), page.tap("[data-download=loans]")]);
  const csvBytes = readFileSync(await csvDl.path());
  check("export", "Préstamos file opens in Excel (BOM, ';', Spanish header)", csvBytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) && csvBytes.toString("utf8").includes("Código;Libro;Autor;Alumno;Clase"), csvDl.suggestedFilename());
  const [bkDl] = await Promise.all([page.waitForEvent("download"), page.tap("[data-testid=backup]")]);
  const backupPath = join(EVIDENCE, bkDl.suggestedFilename());
  await bkDl.saveAs(backupPath);
  await page.waitForSelector("[data-testid=last-backup]:has-text('hoy')");
  check("backup", "backup file is named by date and Ajustes says 'Última copia: hoy'", bkDl.suggestedFilename() === `biblioteca-copia-${TODAY}.json`, bkDl.suggestedFilename());
  const fresh = await newIpad();
  await go("ajustes", fresh.page);
  await fresh.page.setInputFiles("[data-testid=restore-file]", backupPath);
  await fresh.page.tap("#restore button[type=submit]");
  await fresh.page.waitForSelector("[data-testid=loan-tile]");
  const [orig, restored] = [await saved(), await saved(fresh.page)];
  readback.restore = { books: restored.books.length, students: restored.students.length, loans: restored.loans.length, open: openLoans(restored).length };
  check("backup", "restoring the file on an empty iPad brings back every book, student and loan", orig.books.length === restored.books.length && orig.students.length === restored.students.length && JSON.stringify(orig.loans) === JSON.stringify(restored.loans), JSON.stringify(readback.restore));
  await fresh.ctx.close();

  // ── F11 clear demo keeps real data; the backup reminder appears ──
  await page.tap(".settings [data-action=clear-demo]");
  await page.waitForSelector("[data-testid=demo-strip][hidden]", { state: "attached" });
  st = await saved();
  readback.afterClear = { demo: st.books.filter((b) => b.is_demo).length + st.students.filter((s) => s.is_demo).length, books: st.books.length, students: st.students.length, loans: st.loans.length };
  check("clear-demo", "only demo rows are gone; real books and 3 real students stay", JSON.stringify(readback.afterClear) === '{"demo":0,"books":2,"students":3,"loans":0}', JSON.stringify(readback.afterClear));
  await page.evaluate(() => { globalThis.BIBLIO_TODAY = "2026-10-12"; location.hash = "#/atrasados"; });
  await page.evaluate(() => { location.hash = "#/mostrador"; });
  await page.waitForTimeout(300);
  check("backup", "9 days after the last copy, the counter reminds her to save one", await page.isVisible("[data-testid=backup-nudge]"));

  // ── Offline: once opened, it works without internet ──
  await page.reload();
  await page.waitForTimeout(800);
  const swReady = await page.evaluate(() => Promise.race([navigator.serviceWorker?.ready.then(() => true), new Promise((r) => setTimeout(() => r(false), 4000))]));
  // Take the web host away entirely (Playwright's simulated offline mode trips WebKit itself).
  await new Promise((r) => { server.close(r); server.closeAllConnections(); });
  let offlineOk = false;
  try { await page.reload(); await page.waitForSelector("[data-testid=loan-tile], [data-testid=first-run], .tiles, .empty-state", { timeout: 5000 }); offlineOk = true; } catch {}
  check("offline", "with the website unreachable, the app still opens with her data", swReady && offlineOk, `service worker ready: ${swReady}, reloaded offline: ${offlineOk}`);
  await new Promise((r) => server.listen(PORT, r));

  // ── Layout: every screen at iPad portrait (820) and the smallest iPad (744) ──
  const demoCtx = await newIpad(IPAD_PORTRAIT);
  await go("mostrador", demoCtx.page);
  await demoCtx.page.tap("[data-action=load-demo]");
  await demoCtx.page.waitForSelector("[data-testid=loan-tile]");
  const ds = await saved(demoCtx.page);
  const routes = ["mostrador", "atrasados", "libros", `libros/${bookTitled(ds, "Matilda").id}`, "alumnos", `alumnos/${studentNamed(ds, "Martina López").id}`, "ajustes"];
  for (const width of [820, 744]) {
    await demoCtx.page.setViewportSize({ width, height: 1180 });
    for (const r of routes) {
      await go(r, demoCtx.page);
      const sw = await demoCtx.page.evaluate(() => document.documentElement.scrollWidth);
      check("layout", `#/${r} fits ${width}px portrait`, sw <= width, `scrollWidth ${sw}`);
      if (width === 820) await shot(`p-${r.replace("/", "-")}`, true, demoCtx.page);
    }
  }
  for (const r of ["mostrador", "atrasados", "libros", "alumnos", "ajustes"]) {
    await go(r);
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    check("layout", `#/${r} fits 1180px landscape`, sw <= 1180, `scrollWidth ${sw}`);
  }

  // Impeccable review captures: fresh pages, no toasts, tiles rendered.
  mkdirSync(join(ROOT, ".impeccable", "review"), { recursive: true });
  const want = openLoans(await saved(demoCtx.page)).length;
  for (const [file, opts] of [["desktop.png", IPAD_LANDSCAPE], ["mobile.png", IPAD_PORTRAIT]]) {
    const p = await demoCtx.ctx.newPage();
    await p.setViewportSize(opts.viewport);
    await p.goto(`${BASE}/#/mostrador`);
    await p.waitForFunction((n) => document.querySelectorAll("[data-testid=loan-tile]").length === n && !document.querySelector(".toast"), want);
    await p.waitForTimeout(300);
    await p.screenshot({ path: join(ROOT, ".impeccable", "review", file), fullPage: true });
    await p.close();
  }
  await demoCtx.ctx.close();

  // 409 is the normal "needs confirmation" answer; nothing else may appear.
  const real = consoleErrors.filter((e) => !/status of 409/.test(e));
  check("console", "no JavaScript errors in any flow", real.length === 0, real.join(" | "));
} catch (err) {
  check("harness", "drive completed", false, err.stack || err.message);
} finally {
  // ── Evidence ── (cleanup never deletes evidence)
  writeFileSync(join(EVIDENCE, "results.json"), JSON.stringify({ stamp: STAMP, today: TODAY, failed, results, readback }, null, 2));
  for (const b of browsers) await b.close().catch(() => {});
  server.close();
  console.log(`\n${results.length - failed}/${results.length} checks passed. Evidence: ${EVIDENCE}`);
  process.exit(failed ? 1 : 0);
}
