// verify-biblioteca: Launch → Doctor → Drive → Evidence → Cleanup.
// Drives the real app in WebKit (Safari's engine) at iPad sizes with touch, and reads every
// change back from what the page saved on the device (IndexedDB).
// Usage: npm run verify   (from tests/e2e)   → evidence in .verify/evidence/<stamp>/
import { webkit } from "playwright";
import { createServer } from "node:http";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { readXlsx } from "../../app/static/xlsx.js";

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
  check("help", "welcome state points to Cómo se usa", await page.isVisible("[data-testid=first-run] a[href='#/ayuda']"));
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

  // ── F1a every place a book is drawn carries its age band: all demo books have one, so nothing may be grey ──
  const bandAudit = async (where) => {
    const r = await page.evaluate(() => {
      const els = [...document.querySelectorAll("#main .forro[data-color], #main .etiqueta")];
      const bad = els.filter((e) => (e.classList.contains("etiqueta") ? (e.getAttribute("style") || "").includes("gris") : !["azul", "rojo", "verde"].includes(e.dataset.color)));
      return { n: els.length, bad: bad.length };
    });
    check("color", `${where}: every book drawn in its band colour (${r.n} drawn)`, r.n > 0 && r.bad === 0, JSON.stringify(r));
  };
  await bandAudit("Mostrador tiles and etiquetas");
  await page.tap(".chip[data-ask=atrasados]");
  await page.waitForFunction(() => document.querySelector("[data-testid=answer] .forro"));
  await bandAudit("Preguntá answer");
  await page.fill("[data-testid=lend-book]", "a");
  await page.waitForSelector("[role=option] .forro");
  await bandAudit("lend suggestions");
  await go("atrasados");
  await bandAudit("Atrasados");
  await go(`alumnos/${studentNamed(await saved(), "Martina López").id}`);
  await bandAudit("a student's page");

  // ── F1b help: the "?" opens Cómo se usa, reads only, and its links lead back to the screens ──
  const beforeHelp = JSON.stringify(await saved());
  await page.tap("[data-testid=help-link]");
  await page.waitForSelector("[data-testid=help-prestar]");
  const cards = await page.$$eval("[data-testid^=help-]:not([data-testid=help-link])", (els) => els.map((e) => e.dataset.testid.slice(5)));
  check("help", "'?' opens the 8 help cards", cards.join(",") === "prestar,clases,devolver,atrasados,preguntar,cargar,copia,probar", cards.join(","));
  check("help", "the '?' is marked as the current page", (await page.getAttribute("[data-testid=help-link]", "aria-current")) === "page");
  check("help", "loan length in the steps comes from Ajustes (14 días)", (await page.textContent("[data-testid=help-prestar]")).includes("14 días"));
  await shot("02b-ayuda");
  await page.tap("[data-testid=help-prestar] a[href='#/mostrador']");
  await page.waitForSelector("[data-testid=lend-submit]");
  check("help", "'Ir al Mostrador' lands on the counter", page.url().endsWith("#/mostrador"), page.url());
  check("help", "reading the help writes nothing to the device", JSON.stringify(await saved()) === beforeHelp);

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
  await page.tap("[data-testid=color-verde]");
  await page.tap("[data-testid=book-save]");
  await page.waitForSelector("[data-testid=copies-table]");
  st = await saved();
  const corazon = bookTitled(st, "Corazón");
  readback.addBook = st.copies.filter((c) => c.book_id === corazon?.id).map((c) => c.code);
  check("add-book", "book saved with 2 numbered copies, not demo", corazon && !corazon.is_demo && readback.addBook.length === 2 && readback.addBook.every((c) => /^B-\d{4}$/.test(c)), JSON.stringify(readback.addBook));
  await shot("08-libro-nuevo");
  check("color", "new book saved with its age band (verde)", corazon?.color === "verde", corazon?.color);
  check("color", "its page says Verde · 10 a 12 años and its forro is the green ink",
    (await page.textContent("[data-testid=book-color]")).includes("Verde · 10 a 12 años")
    && await page.$eval(".detail-head .forro", (el) => getComputedStyle(el).backgroundColor) === "rgb(33, 128, 74)");
  await page.tap("#edit-toggle");
  await page.tap("#edit-form [data-testid=color-rojo]");
  await page.tap("#edit-form button[type=submit]");
  await page.waitForFunction(() => document.querySelector("[data-testid=book-color]")?.textContent.includes("Rojo"));
  check("color", "changing it to rojo is saved", bookTitled(await saved(), "Corazón").color === "rojo");
  await go("libros?color=rojo");
  const redRows = await page.$$eval("[data-testid=books-table] tbody .forro", (els) => els.map((e) => e.dataset.color));
  const wantRed = (await saved()).books.filter((b) => !b.archived && b.color === "rojo").length;
  check("color", "the Rojo filter lists exactly the red books", redRows.length === wantRed && redRows.every((c) => c === "rojo"), `${redRows.length} shown, ${wantRed} saved`);
  await shot("08b-libros-rojo");
  await go(`libros/${corazon.id}`);
  check("hints", "a book nobody took yet says where to lend it", (await page.textContent("[data-testid=history-empty]")).includes("Se presta desde el Mostrador"));

  // ── F8 add a student; import by pasting rows (the iPad way) and by file ──
  await go("alumnos");
  await page.tap("[data-testid=add-student-toggle]");
  await page.fill("[data-testid=student-name]", "Ana Gómez");
  await page.fill("[data-testid=student-grade]", "5a");
  await page.tap("[data-testid=student-save]");
  await page.waitForFunction(() => document.body.textContent.includes("Ana Gómez"));
  await go(`alumnos/${studentNamed(await saved(), "Ana Gómez").id}`);
  check("hints", "a student with no loans is pointed to the yellow 'Prestarle un libro' above",
    (await page.textContent("[data-testid=history-empty]")).includes("botón amarillo de arriba") && await page.isVisible("a.btn-go[href^='#/mostrador?alumno=']"));
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
  // Files made by Microsoft Excel itself (tests/fixtures), picked from the iPad's Files app.
  await page.setInputFiles("[data-testid=import-students-file]", join(ROOT, "tests", "fixtures", "alumnos-excel.xlsx"));
  await page.tap("#import-students button[type=submit]");
  // Martina and Joaquín (written "4b") are already in the demo list, so they must be skipped.
  await page.waitForFunction(() => /Cargué 2 alumnos\. 2 ya estaban/.test(document.querySelector("#import-students [data-testid=import-result]")?.textContent || ""));
  await page.setInputFiles("[data-testid=import-books-file]", join(ROOT, "tests", "fixtures", "libros-excel.xlsx"));
  await page.tap("#import-books button[type=submit]");
  // Cuentos de la selva and Matilda (same author) already exist; only El "Principito" is new.
  await page.waitForFunction(() => /Cargué 1 libro\. 2 ya estaban/.test(document.querySelector("#import-books [data-testid=import-result]")?.textContent || ""));
  st = await saved();
  readback.xlsx = { nandu: studentNamed(st, "Ñandú O'Neil & Pérez")?.grade, sofia: studentNamed(st, "Sofía <la de 6>")?.grade,
    principito: st.copies.filter((c) => c.book_id === bookTitled(st, 'El "Principito"')?.id).length,
    martinas: st.students.filter((x) => x.name === "Martina López").length };
  check("xlsx", "Excel students file saved with tidy classes", readback.xlsx.nandu === "5°A" && readback.xlsx.sofia === "6°", JSON.stringify(readback.xlsx));
  check("xlsx", "Excel books file: copies from the number cell; existing books and students not duplicated", readback.xlsx.principito === 2 && readback.xlsx.martinas === 1, JSON.stringify(readback.xlsx));
  const [notXlsx] = [join(EVIDENCE, "no-es-excel.xlsx")];
  writeFileSync(notXlsx, "esto no es una planilla");
  await page.setInputFiles("[data-testid=import-students-file]", notXlsx);
  await page.tap("#import-students button[type=submit]");
  await page.waitForSelector("#import-students .notice-error");
  check("xlsx", "a broken .xlsx gets a clear Spanish message", (await page.textContent("#import-students .notice-error")).includes("no es una planilla de Excel"));

  // Her old loan registry, made in Microsoft Excel with real date cells.
  await page.setInputFiles("[data-testid=import-loans-file]", join(ROOT, "tests", "fixtures", "prestamos-excel.xlsx"));
  await page.tap("#import-loans button[type=submit]");
  await page.waitForSelector("#import-loans [data-testid=import-result]");
  const loansMsg = (await page.textContent("#import-loans [data-testid=import-result]")).replace(/\s+/g, " ").trim();
  st = await saved();
  const anaNueva = studentNamed(st, "Ana Nueva");
  const anaLoan = st.loans.find((l) => l.student_id === anaNueva?.id);
  const joaquinPrincipito = st.loans.find((l) => l.student_id === studentNamed(st, "Joaquín Pereira").id && l.lent_on === "2026-09-20");
  readback.importLoans = { msg: loansMsg, ana: anaLoan && { lent_on: anaLoan.lent_on, due_on: anaLoan.due_on, returned_on: anaLoan.returned_on }, joaquin: joaquinPrincipito && joaquinPrincipito.returned_on };
  check("loans-import", "result names what was loaded and created, and which rows need a look",
    /Cargué 2 préstamos \(1 ya devuelto/.test(loansMsg) && loansMsg.includes("Alumnos nuevos: Ana Nueva (1°A)") && loansMsg.includes("Libros nuevos: Un libro que no estaba")
    && loansMsg.includes("Fila 2: Todos los ejemplares de Matilda ya figuran prestados") && loansMsg.includes("Fila 5: Falta el alumno"), loansMsg);
  check("loans-import", "saved: Ana's loan from Excel's date cells (28/09 + 14 days) and Joaquín's returned one in history",
    anaLoan && anaLoan.lent_on === "2026-09-28" && anaLoan.due_on === "2026-10-12" && anaLoan.returned_on === null && readback.importLoans.joaquin === "2026-10-02", JSON.stringify(readback.importLoans));
  await shot("09b-ajustes-prestamos");
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
  const [xlDl] = await Promise.all([page.waitForEvent("download"), page.tap("[data-download=loans]")]);
  const xlRows = await readXlsx(readFileSync(await xlDl.path()));
  const openNow = openLoans(await saved()).length;
  readback.exportXlsx = { file: xlDl.suggestedFilename(), header: xlRows[0], rows: xlRows.length - 1 };
  check("export", "Préstamos downloads as a real Excel .xlsx with every loan", xlDl.suggestedFilename() === `prestamos-${TODAY}.xlsx` && xlRows[0].join("|") === "Código|Libro|Autor|Alumno|Clase|Prestado|Vence|Devuelto|Estado" && xlRows.length - 1 === (await saved()).loans.length, JSON.stringify(readback.exportXlsx));
  void openNow;
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
  check("clear-demo", "only demo rows are gone; the 4 real books, 6 real students and Ana Nueva's loan stay", JSON.stringify(readback.afterClear) === '{"demo":0,"books":4,"students":6,"loans":1}', JSON.stringify(readback.afterClear));
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

  // ── F12 Clases: her Excel workbook. A tab per class, a row per student, one date for the sheet ──
  {
    const { ctx: cctx, page: cp } = await newIpad();
    await go("mostrador", cp);
    await cp.tap("[data-action=load-demo]");
    await cp.waitForSelector("[data-testid=loan-tile]");
    let cs = await saved(cp);
    const sid = (name) => studentNamed(cs, name).id;
    const row = (name) => `[data-testid=sheet-row][data-student="${sid(name)}"]`;
    const loansOf = (state, name) => state.loans.filter((l) => l.student_id === studentNamed(state, name).id);
    const titleOf = (state, l) => state.books.find((b) => b.id === copyOf(state, l.copy_id).book_id).title;

    await cp.tap("nav.tabs a[data-tab=clases]");
    await cp.waitForSelector("[data-testid=sheet-tabs]");
    const tabs = await cp.$$eval("[data-testid=sheet-tabs] a", (as) => as.map((a) => a.textContent.replace(/\s+/g, " ").trim()));
    check("clases", "one tab per class, with how many students", tabs.join(",") === "2°A 2,3°B 3,4°A 2,4°B 3,5°A 2,6°B 3", tabs.join(","));
    await cp.tap("[data-testid=sheet-tabs] a:has-text('4°B')");
    await cp.waitForFunction(() => document.querySelector("[data-testid=sheet-tabs] [aria-current=page]")?.textContent.includes("4°B"));
    const names = await cp.$$eval("[data-testid=sheet-row] .student-link", (as) => as.map((a) => a.textContent));
    check("clases", "4°B lists its students in the order they were loaded", names.join(",") === "Martina López,Joaquín Pereira,Agustina Silva", names.join(","));
    check("clases", "each row shows what the child has now", (await cp.textContent(row("Martina López"))).includes("Matilda"));

    // The class came on Wednesday; she writes it down on Saturday.
    await cp.fill("[data-testid=sheet-lent]", "30/09");
    check("clases", "Fecha 30/09 moves Vuelve to 14/10, two weeks after", (await cp.inputValue("[data-testid=sheet-due]")) === "14/10");
    check("clases", "the sheet says loudly that it is writing down another day", (await cp.textContent("[data-testid=sheet-note]")).includes("miércoles 30/09") && await cp.$eval("#sheet-dates", (el) => el.classList.contains("is-earlier-day")));
    await cp.waitForTimeout(300); // let the chips finish fading
    await shot("11-clases-fecha", false, cp);

    await cp.fill(`${row("Joaquín Pereira")} [data-testid=sheet-input]`, "pinocho");
    await cp.waitForSelector(`${row("Joaquín Pereira")} li[data-i]`);
    await cp.keyboard.press("Enter");
    await cp.waitForFunction((sel) => document.querySelector(sel)?.textContent.includes("Las aventuras de Pinocho"), row("Joaquín Pereira"));
    cs = await saved(cp);
    const pin = loansOf(cs, "Joaquín Pereira").find((l) => titleOf(cs, l) === "Las aventuras de Pinocho");
    readback.sheetLend = pin && { lent_on: pin.lent_on, due_on: pin.due_on };
    check("clases", "Enter on a row saves the loan with the sheet's dates", pin && pin.lent_on === "2026-09-30" && pin.due_on === "2026-10-14", JSON.stringify(readback.sheetLend));
    check("clases", "and moves on to the next child's row, like Excel", await cp.evaluate((id) => document.activeElement?.id === `take-${id}`, sid("Agustina Silva")));

    // A barcode scanner on Agustina's row: the code, then Enter.
    const ruperto = cs.copies.find((c) => c.book_id === bookTitled(cs, "Ruperto detective").id).code;
    await cp.keyboard.type(ruperto);
    await cp.keyboard.press("Enter");
    await cp.waitForFunction((sel) => document.querySelector(sel)?.textContent.includes("Ruperto detective"), row("Agustina Silva"));
    check("clases", "a scanned code + Enter lends that copy", loansOf(await saved(cp), "Agustina Silva").some((l) => l.returned_on == null && copyOf(cs, l.copy_id).code === ruperto));

    await cp.tap(`${row("Martina López")} [data-held]`);
    await cp.waitForFunction((sel) => !document.querySelector(sel)?.textContent.includes("Matilda"), row("Martina López"));
    cs = await saved(cp);
    const mat = loansOf(cs, "Martina López").find((l) => titleOf(cs, l) === "Matilda" && l.lent_on === "2026-09-30");
    check("clases", "'Devolvió' returns it on the sheet's day, not today", mat?.returned_on === "2026-09-30", JSON.stringify(mat));
    await shot("12-clases-4B", true, cp);

    await cp.tap(".toast:has-text('Prestado: Ruperto') .btn");
    await cp.waitForFunction((sel) => !document.querySelector(sel)?.textContent.includes("Ruperto"), row("Agustina Silva"));
    check("clases", "Deshacer takes back a loan typed on the wrong row", !loansOf(await saved(cp), "Agustina Silva").some((l) => l.returned_on == null));

    // Joaquín now has 2 books: a third warns on his row and saves nothing until confirmed.
    await cp.fill(`${row("Joaquín Pereira")} [data-testid=sheet-input]`, "superzorro");
    await cp.waitForSelector(`${row("Joaquín Pereira")} li[data-i]`);
    await cp.keyboard.press("Enter");
    await cp.waitForSelector(`${row("Joaquín Pereira")} [data-testid=sheet-warning]`);
    const before3 = loansOf(await saved(cp), "Joaquín Pereira").filter((l) => l.returned_on == null).length;
    check("clases", "the limit warns on the child's own row, nothing saved yet", before3 === 2 && (await cp.textContent(`${row("Joaquín Pereira")} [data-testid=sheet-warning]`)).includes("ya tiene 2 libros"));
    await cp.tap(`${row("Joaquín Pereira")} [data-act=force]`);
    await cp.waitForFunction((sel) => document.querySelector(sel)?.textContent.includes("El Superzorro"), row("Joaquín Pereira"));
    check("clases", "'Prestar igual' saves it", loansOf(await saved(cp), "Joaquín Pereira").filter((l) => l.returned_on == null).length === 3);

    await cp.fill("[data-testid=sheet-add-student]", "Valentina Ríos");
    await cp.keyboard.press("Enter");
    await cp.waitForFunction(() => [...document.querySelectorAll("[data-testid=sheet-row] .student-link")].some((a) => a.textContent === "Valentina Ríos"));
    check("clases", "the last row adds a student to this class", studentNamed(await saved(cp), "Valentina Ríos")?.grade === "4°B");

    // Left open overnight: the sheet still says "hoy" from yesterday. Saving must not use yesterday.
    await cp.fill("[data-testid=sheet-lent]", "03/10");
    await cp.evaluate(() => { globalThis.BIBLIO_TODAY = "2026-10-04"; });
    await cp.fill(`${row("Agustina Silva")} [data-testid=sheet-input]`, "monstruo de colores");
    await cp.waitForSelector(`${row("Agustina Silva")} li[data-i]`);
    await cp.keyboard.press("Enter");
    await cp.waitForFunction(() => document.querySelector("[data-testid=sheet-lent]")?.value === "04/10");
    check("clases", "on a new day nothing is saved with yesterday's date; the sheet resets to today and says so",
      !loansOf(await saved(cp), "Agustina Silva").some((l) => l.returned_on == null) && (await cp.textContent(".toasts")).includes("Empezó otro día"));
    await cp.fill(`${row("Agustina Silva")} [data-testid=sheet-input]`, "monstruo de colores");
    await cp.waitForSelector(`${row("Agustina Silva")} li[data-i]`);
    await cp.keyboard.press("Enter");
    await cp.waitForFunction((sel) => document.querySelector(sel)?.textContent.includes("El monstruo de colores"), row("Agustina Silva"));
    check("clases", "loading it again saves it on the new today", loansOf(await saved(cp), "Agustina Silva").find((l) => l.returned_on == null)?.lent_on === "2026-10-04");
    await cp.evaluate(() => { globalThis.BIBLIO_TODAY = "2026-10-03"; });

    await cp.reload();
    await cp.waitForSelector("[data-testid=sheet]");
    check("clases", "after reopening, the sheet is still on 4°B", (await cp.textContent("[data-testid=sheet-tabs] [aria-current=page]")).includes("4°B"));

    // The counter: "Prestado" is today, and can be another day.
    await go("mostrador", cp);
    check("lend-date", "Prestado starts on today", (await cp.inputValue("[data-testid=lend-lent]")) === "03/10" && (await cp.textContent("#l-lent-day")) === "hoy");
    await cp.fill("[data-testid=lend-student]", "lucia");
    await cp.waitForSelector("#l-student-list li[data-i]");
    await cp.keyboard.press("Enter");
    await cp.fill("[data-testid=lend-book]", "mafalda");
    await cp.waitForSelector("#l-copy-list li[data-i]");
    await cp.keyboard.press("Enter");
    await cp.tap(".chip[data-back='1']");
    check("lend-date", "'Ayer' sets 02/10 and Vuelve follows to 16/10", (await cp.inputValue("[data-testid=lend-lent]")) === "02/10" && (await cp.inputValue("[data-testid=lend-due]")) === "16/10");
    await cp.tap("[data-testid=lend-submit]");
    await cp.waitForSelector("[data-testid=lend-result]");
    cs = await saved(cp);
    const luc = loansOf(cs, "Lucía Fernández").find((l) => l.returned_on == null && titleOf(cs, l) === "Mafalda 1");
    check("lend-date", "saved with lent_on 2026-10-02, due 2026-10-16", luc?.lent_on === "2026-10-02" && luc?.due_on === "2026-10-16", JSON.stringify(luc));
    check("lend-date", "the next child keeps the same Prestado day", (await cp.inputValue("[data-testid=lend-lent]")) === "02/10");

    // Left open overnight with "02/10" still on the label: the next day nothing is saved with it.
    await cp.evaluate(() => { globalThis.BIBLIO_TODAY = "2026-10-04"; });
    const before = (await saved(cp)).loans.length;
    await cp.fill("[data-testid=lend-student]", "felipe");
    await cp.waitForSelector("#l-student-list li[data-i]");
    await cp.keyboard.press("Enter");
    await cp.fill("[data-testid=lend-book]", "charlie");
    await cp.waitForSelector("#l-copy-list li[data-i]");
    await cp.keyboard.press("Enter");
    await cp.tap("[data-testid=lend-submit]");
    await cp.waitForFunction(() => document.querySelector("#lend-notice")?.textContent.includes("Empezó otro día"));
    check("lend-date", "on a new day nothing is saved with the old Prestado; it goes back to today and says so",
      (await saved(cp)).loans.length === before && (await cp.inputValue("[data-testid=lend-lent]")) === "04/10");
    await cp.tap("[data-testid=lend-submit]");
    await cp.waitForSelector("[data-testid=lend-result]");
    cs = await saved(cp);
    check("lend-date", "tapping Prestar again saves it on the new today", loansOf(cs, "Felipe Méndez").find((l) => l.returned_on == null)?.lent_on === "2026-10-04");
    await cp.evaluate(() => { globalThis.BIBLIO_TODAY = "2026-10-03"; });

    // Fixing the lent day of a loan already saved, on the student's page.
    await go(`alumnos/${sid("Lucía Fernández")}`, cp);
    const lentInput = cp.locator(`[data-testid=student-loans] input[data-lent="${luc.id}"]`);
    await lentInput.fill("28/09");
    await lentInput.press("Tab");
    await cp.waitForTimeout(400);
    readback.setLent = (await saved(cp)).loans.find((l) => l.id === luc.id);
    check("lend-date", "typing 28/09 on the student's page saves 2026-09-28 (last month, not next year)", readback.setLent.lent_on === "2026-09-28" && readback.setLent.due_on === "2026-10-16", JSON.stringify(readback.setLent));
    await cctx.close();
  }

  // ── Layout: every screen at iPad portrait (820) and the smallest iPad (744) ──
  const demoCtx = await newIpad(IPAD_PORTRAIT);
  await go("mostrador", demoCtx.page);
  await demoCtx.page.tap("[data-action=load-demo]");
  await demoCtx.page.waitForSelector("[data-testid=loan-tile]");
  const ds = await saved(demoCtx.page);
  const routes = ["mostrador", "clases", "clases?clase=4%C2%B0B", "atrasados", "libros", `libros/${bookTitled(ds, "Matilda").id}`, "alumnos", `alumnos/${studentNamed(ds, "Martina López").id}`, "ajustes", "ayuda"];
  for (const width of [820, 744]) {
    await demoCtx.page.setViewportSize({ width, height: 1180 });
    for (const r of routes) {
      await go(r, demoCtx.page);
      const sw = await demoCtx.page.evaluate(() => document.documentElement.scrollWidth);
      check("layout", `#/${r} fits ${width}px portrait`, sw <= width, `scrollWidth ${sw}`);
      if (width === 820) await shot(`p-${r.replace(/[/?=%]/g, "-")}`, true, demoCtx.page);
    }
  }
  for (const r of ["mostrador", "clases", "atrasados", "libros", "alumnos", "ajustes", "ayuda"]) {
    await go(r);
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    check("layout", `#/${r} fits 1180px landscape`, sw <= 1180, `scrollWidth ${sw}`);
  }
  // Older iPads are 1080 wide held sideways: the six tabs and the "?" stay on one line.
  await page.setViewportSize({ width: 1080, height: 810 });
  await go("clases");
  const band = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, h: document.querySelector(".band").offsetHeight }));
  check("layout", "at 1080px landscape the band is one line and nothing scrolls sideways", band.sw <= 1080 && band.h < 80, JSON.stringify(band));
  await page.setViewportSize(IPAD_LANDSCAPE.viewport);

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
