// Behaviour of the registry through its public interface (the same code the iPad runs).
// Run: node --test tests/
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Registry, RegistryError, emptyState, addDays, tidyColor, typedDay } from "../app/static/registry.js";
import * as DEMO from "../app/static/demo-data.js";

let r, clock, saves, matilda, principito, martina, joaquin, bruno;

beforeEach(() => {
  clock = { day: "2026-10-01" };
  saves = 0;
  r = new Registry(emptyState(), { today: () => clock.day, save: () => saves++ });
  matilda = r.addBook("Matilda", "Roald Dahl", 2);
  principito = r.addBook("El Principito", "Saint-Exupéry");
  martina = r.addStudent("Martina López", "4b");
  joaquin = r.addStudent("Joaquín Pereira", "4°B");
  bruno = r.addStudent("Bruno Rodríguez", "3 B");
});

const rejects = (fn, code) => assert.throws(fn, (e) => e instanceof RegistryError && (!code || e.code === code));

// ── books & students ──
test("copies get sequential codes and custom codes are kept", () => {
  assert.deepEqual(matilda.copies.map((c) => c.code), ["B-0001", "B-0002"]);
  assert.equal(principito.copies[0].code, "B-0003");
  assert.equal(r.addBook("Mafalda", "Quino", 1, ["q-7"]).copies[0].code, "Q-7");
  rejects(() => r.addBook("Otro", "", 1, ["Q-7"]), "code_taken");
});

test("duplicate codes in one request are refused and nothing is left behind", () => {
  const before = JSON.stringify(r.state);
  rejects(() => r.addBook("Dup", "", 1, ["X-1", "x-1"]), "code_taken");
  assert.equal(JSON.stringify(r.state), before);
  const res = r.importCsv("books", "titulo;autor;ejemplares;codigo\nUno;A;2;Z-9 Z-9\nDos;B;1;\n");
  assert.equal(res.added, 1);
  assert.equal(res.errors.length, 1);
  assert.deepEqual(r.ask("dos").books.map((b) => b.title), ["Dos"]);
  assert.deepEqual(r.ask("uno").books, []);
});

test("grades are tidied so the same class matches", () => {
  assert.equal(martina.grade, "4°B");
  assert.equal(bruno.grade, "3°B");
  assert.deepEqual(r.grades(), ["3°B", "4°B"]);
  assert.deepEqual(r.students(false, "4 b").map((s) => s.name), ["Joaquín Pereira", "Martina López"]);
});

test("blank title or name is refused", () => {
  rejects(() => r.addBook("   "));
  rejects(() => r.addStudent(""));
});

// ── lending ──
test("lend sets the due date from settings and marks the copy unavailable", () => {
  const loan = r.lend("b-0001", martina.id);
  assert.equal(loan.due_on, "2026-10-15");
  assert.equal(loan.student, "Martina López");
  const book = r.book(matilda.id);
  assert.equal(book.available, 1);
  assert.equal(book.copies[0].loan.student, "Martina López");
});

test("a copy cannot be lent twice", () => {
  r.lend("B-0001", martina.id);
  assert.throws(() => r.lend("B-0001", joaquin.id, null, true), (e) => e.code === "copy_on_loan" && e.info.loan.student === "Martina López");
});

test("the limit warns but can be overridden", () => {
  r.updateSettings({ max_loans: 1 });
  r.lend("B-0001", martina.id);
  rejects(() => r.lend("B-0003", martina.id), "needs_confirmation");
  assert.equal(r.student(martina.id).loans.length, 1);
  assert.ok(r.lend("B-0003", martina.id, null, true).open);
  assert.equal(r.student(martina.id).loans.length, 2);
});

test("overdue books trigger a warning naming them", () => {
  r.lend("B-0001", martina.id);
  clock.day = addDays(clock.day, 20);
  assert.throws(() => r.lend("B-0003", martina.id), (e) => e.code === "needs_confirmation" && e.message.includes("Matilda"));
});

test("custom due date is kept and past dates are refused", () => {
  assert.equal(r.lend("B-0001", martina.id, "2026-10-30").due_on, "2026-10-30");
  rejects(() => r.lend("B-0002", joaquin.id, "2026-09-01"), "invalid");
  rejects(() => r.lend("B-0002", joaquin.id, "2026-02-31"), "invalid");
});

test("a loan can be written down on an earlier day; its due date counts from that day", () => {
  const loan = r.lend("B-0001", martina.id, null, false, "2026-09-10");
  assert.deepEqual([loan.lent_on, loan.due_on], ["2026-09-10", "2026-09-24"]);
  assert.ok(loan.overdue, "already past its due date, so it shows as late");
  assert.equal(r.lend("B-0003", joaquin.id, "2026-09-20", false, "2026-09-15").due_on, "2026-09-20");
  rejects(() => r.lend("B-0002", bruno.id, null, false, "2026-10-02"), "invalid"); // tomorrow
  rejects(() => r.lend("B-0002", bruno.id, "2026-09-01", false, "2026-09-05"), "invalid"); // due before lent
  rejects(() => r.lend("B-0002", bruno.id, null, false, "2026-02-31"), "invalid");
  assert.equal(r.book(matilda.id).available, 1, "refused loans leave the copy free");
});

test("a return can be written down on an earlier day, but not before the loan", () => {
  r.lend("B-0001", martina.id, null, false, "2026-09-10");
  rejects(() => r.returnCopy("B-0001", "2026-09-09"), "invalid");
  rejects(() => r.returnCopy("B-0001", "2026-10-02"), "invalid");
  assert.equal(r.returnCopy("B-0001", "2026-09-20").returned_on, "2026-09-20");
  assert.equal(r.book(matilda.id).available, 2);
});

test("the lent day of a loan can be fixed afterwards, within its due and return dates", () => {
  const loan = r.lend("B-0001", martina.id);
  assert.equal(r.setLentOn(loan.id, "2026-09-28").lent_on, "2026-09-28");
  assert.equal(r.loan(loan.id).due_on, "2026-10-15", "due date is left alone");
  rejects(() => r.setLentOn(loan.id, "2026-10-02"), "invalid");
  r.returnCopy("B-0001");
  const old = r.lend("B-0002", joaquin.id, "2026-09-20", false, "2026-09-01");
  r.returnCopy("B-0002", "2026-09-05");
  rejects(() => r.setLentOn(old.id, "2026-09-06"), "invalid"); // after it came back
  rejects(() => r.setLentOn(old.id, "2026-09-21"), "invalid"); // after it was due
});

test("a loan made by mistake can be taken back while it is still out", () => {
  const loan = r.lend("B-0001", martina.id);
  assert.equal(r.undoLend(loan.id).title, "Matilda");
  assert.equal(r.student(martina.id).times_borrowed, 0);
  assert.equal(r.book(matilda.id).available, 2);
  const kept = r.lend("B-0001", joaquin.id);
  r.returnCopy("B-0001");
  rejects(() => r.undoLend(kept.id), "invalid");
  assert.equal(r.studentHistory(joaquin.id).length, 1, "returned loans stay in the history");
});

test("the class sheet has a tab per class and a row per student in the order they were loaded", () => {
  const ana = r.addStudent("Ana Álvarez", "4 b");
  r.addStudent("Sin Clase", "");
  r.lend("B-0001", joaquin.id, null, false, "2026-09-25");
  const sheet = r.classSheet("4°b");
  assert.equal(sheet.grade, "4°B");
  assert.deepEqual(sheet.tabs, [{ grade: "3°B", students: 1 }, { grade: "4°B", students: 3 }, { grade: "", students: 1 }]);
  assert.deepEqual(sheet.students.map((s) => s.name), ["Martina López", "Joaquín Pereira", "Ana Álvarez"]);
  assert.deepEqual(sheet.students[1].loans.map((l) => [l.title, l.lent_on]), [["Matilda", "2026-09-25"]]);
  assert.equal(r.classSheet().grade, "3°B", "no class asked: the first tab");
  assert.deepEqual(r.classSheet("").students.map((s) => s.name), ["Sin Clase"]);
  r.setStudentArchived(ana.id, true);
  assert.equal(r.classSheet("4°B").students.length, 2, "archived students leave the sheet");
});

test("a typed day without a year is read the way she means it", () => {
  // return dates: on or after the lent day
  assert.equal(typedDay("17/10", "2026-10-03"), "2026-10-17");
  assert.equal(typedDay("2/10", "2026-10-03"), "2027-10-02", "already past today: next year");
  assert.equal(typedDay("31/12", "2027-01-08", { from: "2026-12-18" }), "2026-12-31", "lent last December: due this December, not next");
  // the day a loan happened: the nearest one, never ahead of today
  assert.equal(typedDay("30/09", "2026-10-03", { past: true }), "2026-09-30");
  assert.equal(typedDay("18/12", "2027-01-08", { past: true }), "2026-12-18");
  assert.equal(typedDay("05/10", "2026-10-03", { past: true }), null, "two days ahead is a typo, not last year");
  assert.equal(typedDay("29/02", "2029-01-10", { past: true }), "2028-02-29");
  // with a year, as typed; nonsense is null
  assert.equal(typedDay("17/10/27", "2026-10-03"), "2027-10-17");
  assert.equal(typedDay("31/02", "2026-10-03"), null);
  assert.equal(typedDay("hola", "2026-10-03"), null);
});

// ── returning ──
test("return closes the loan and keeps history", () => {
  const loan = r.lend("B-0001", martina.id);
  clock.day = "2026-10-04";
  assert.equal(r.returnCopy("B-0001").returned_on, "2026-10-04");
  assert.equal(r.book(matilda.id).available, 2);
  const hist = r.studentHistory(martina.id);
  assert.deepEqual(hist.map((h) => h.id), [loan.id]);
  assert.equal(hist[0].open, false);
});

test("returning a copy that is not out fails", () => rejects(() => r.returnCopy("B-0001"), "not_on_loan"));

test("undo return reopens unless the copy was lent again", () => {
  const loan = r.lend("B-0001", martina.id);
  r.returnCopy("B-0001");
  assert.ok(r.undoReturn(loan.id).open);
  r.returnCopy("B-0001");
  r.lend("B-0001", joaquin.id);
  rejects(() => r.undoReturn(loan.id), "copy_on_loan");
});

test("renew counts a full period from today", () => {
  const loan = r.lend("B-0001", martina.id);
  clock.day = "2026-10-11";
  assert.equal(r.renew(loan.id).due_on, "2026-10-25");
});

// ── questions ──
test("overdue lists only late open loans with days late", () => {
  r.lend("B-0001", martina.id);
  r.lend("B-0003", joaquin.id, "2026-10-30");
  clock.day = "2026-10-20";
  assert.deepEqual(r.overdue().map((l) => [l.student, l.days_late]), [["Martina López", 5]]);
  assert.equal(r.ask("¿Qué está atrasado?").kind, "overdue");
});

test("'who has' ignores accents and question words", () => {
  r.lend("B-0003", joaquin.id);
  const ans = r.ask("¿Quién tiene el principito?");
  assert.equal(ans.kind, "search");
  assert.equal(ans.books[0].copies[0].loan.student, "Joaquín Pereira");
  assert.equal(r.ask("joaquin").students[0].loans[0].title, "El Principito");
});

test("ask by copy code and by class", () => {
  assert.equal(r.ask("b-0002").books[0].title, "Matilda");
  r.lend("B-0001", martina.id);
  const ans = r.ask("4°B");
  assert.equal(ans.kind, "grade");
  assert.equal(ans.students.length, 2);
  assert.deepEqual(ans.loans.map((l) => l.student), ["Martina López"]);
});

test("most read counts every loan", () => {
  for (let i = 0; i < 2; i++) { r.lend("B-0001", martina.id, null, true); r.returnCopy("B-0001"); }
  r.lend("B-0003", martina.id, null, true);
  assert.deepEqual(r.ask("más leídos").books.map((b) => [b.title, b.times_lent]), [["Matilda", 2], ["El Principito", 1]]);
});

test("counter suggestions split available and on-loan copies", () => {
  r.lend("B-0001", martina.id);
  assert.deepEqual(r.suggestCopies("matil", "lend").map((c) => c.code), ["B-0002"]);
  assert.deepEqual(r.suggestCopies("martina", "return").map((c) => [c.code, c.student]), [["B-0001", "Martina López"]]);
});

// ── archive, import/export, backup ──
test("archive is refused while books are out, and history survives", () => {
  r.lend("B-0001", martina.id);
  rejects(() => r.setStudentArchived(martina.id, true), "has_loans");
  rejects(() => r.setBookArchived(matilda.id, true), "has_loans");
  r.returnCopy("B-0001");
  assert.ok(r.setStudentArchived(martina.id, true).archived);
  assert.equal(r.studentHistory(martina.id).length, 1);
});

test("import students and books from Excel-style CSV and pasted tabs", () => {
  let res = r.importCsv("students", "Nombre;Clase\nAna Gómez;5a\nMartina López;4°B\n");
  assert.deepEqual([res.added, res.skipped], [1, 1]);
  assert.equal(r.students(false, "5A")[0].name, "Ana Gómez");
  res = r.importCsv("students", "Lola Vega\t1°A\nPedro Ruiz\t1°A");
  assert.equal(res.added, 2);
  res = r.importCsv("books", 'titulo,autor,ejemplares\n"Corazón, de Amicis",Edmundo de Amicis,3\n,sin titulo,1\n');
  assert.equal(res.added, 1);
  assert.equal(res.errors.length, 1);
  assert.equal(r.ask("corazon").books[0].total, 3);
});

// ── age-band colour (the sticker on the real book) ──
test("colour is read from a name or an age range, and anything else is refused", () => {
  for (const [typed, want] of [["Azul", "azul"], [" ROJO ", "rojo"], ["verde", "verde"], ["0 a 7", "azul"], ["7-10", "rojo"],
    ["7 a 10 años", "rojo"], ["10 al 12", "verde"], ["", ""], ["Sin color", ""], [null, ""],
    ["Azul (0 a 7)", "azul"], ["de 7 a 10", "rojo"], ["7/10", "rojo"],
    // what Excel leaves when it turns "7-10" / "10-12" into dates: serials, or the date pasted as text
    ["46302", "rojo"], ["46213", "rojo"], ["46366", "verde"], ["07/10/2026", "rojo"], ["12/10/2026", "verde"]]) assert.equal(tidyColor(typed), want, String(typed));
  for (const bad of ["amarillo", "7 a 12", "8", "46300", "05/10/2026"]) rejects(() => tidyColor(bad), "invalid");
});

test("a book keeps its colour, can change it, and loans and suggestions carry it", () => {
  assert.equal(matilda.color, "");
  const monstruo = r.addBook("El monstruo de colores", "Anna Llenas", 1, [], false, "0 a 7");
  assert.equal(r.book(monstruo.id).color, "azul");
  assert.equal(r.updateBook(matilda.id, { color: "rojo" }).color, "rojo");
  assert.equal(r.updateBook(matilda.id, { title: "Matilda" }).color, "rojo", "editing the title leaves the colour alone");
  rejects(() => r.updateBook(matilda.id, { color: "violeta" }), "invalid");
  assert.equal(r.book(matilda.id).color, "rojo", "a refused colour changes nothing");
  r.lend("B-0001", martina.id);
  assert.equal(r.openLoans()[0].color, "rojo");
  assert.equal(r.suggestCopies("monstruo", "lend")[0].color, "azul");
  assert.equal(r.topBooks()[0].color, "rojo");
  assert.equal(r.updateBook(matilda.id, { color: "" }).color, "", "the colour can be cleared");
});

test("book import reads a Color or Edad column; an unreadable colour loads the book without one and says so", () => {
  let res = r.importCsv("books", "Titulo;Autor;Ejemplares;Color\nCorazón;De Amicis;1;Verde\nPinocho;Collodi;1;\nOtro;X;2;fucsia\n");
  assert.equal(res.added, 3, "an unreadable colour never drops the book");
  assert.equal(res.errors.length, 1);
  assert.match(res.errors[0], /Fila 4: no entendí el color «fucsia»; cargué «Otro» sin color/);
  assert.equal(r.ask("corazon").books[0].color, "verde");
  assert.equal(r.ask("pinocho").books[0].color, "");
  assert.equal(r.ask("otro").books[0].color, "");
  assert.equal(r.ask("otro").books[0].total, 2);
  res = r.importCsv("books", "titulo\tedad\nRuperto\t7 a 10");
  assert.equal(r.ask("ruperto").books[0].color, "rojo");
});

test("an old backup without colours restores with every book unset, and the Libros sheet has a Color column", () => {
  const old = JSON.parse(r.backup());
  for (const b of old.books) delete b.color;
  const other = new Registry(emptyState(), { today: () => clock.day });
  other.restore(JSON.stringify(old));
  assert.deepEqual(other.books().map((b) => b.color), ["", ""]);
  const edited = JSON.parse(r.backup());
  edited.books[0].color = "Azul";
  edited.books[1].color = "<b>";
  other.restore(JSON.stringify(edited));
  assert.deepEqual(other.books().map((b) => b.color).sort(), ["", "azul"], "a hand-edited colour is tidied, junk is dropped");
  r.updateBook(matilda.id, { color: "rojo" });
  const t = r.exportTable("books");
  assert.equal(t.columns[3][0], "Color");
  assert.equal(t.rows.find((row) => row[1] === "Matilda")[3], "Rojo");
});

test("demo books come with their colours", () => {
  const d = new Registry(emptyState(), { today: () => clock.day });
  d.loadDemo(DEMO);
  assert.equal(d.ask("monstruo de colores").books[0].color, "azul");
  assert.ok(d.books().every((b) => ["azul", "rojo", "verde"].includes(b.color)));
});

test("export loans CSV has states, ';' and a BOM", () => {
  r.lend("B-0001", martina.id);
  clock.day = "2026-11-01";
  const text = r.exportCsv("loans");
  assert.ok(text.startsWith("﻿Código;Libro"));
  assert.ok(text.includes("B-0001;Matilda;Roald Dahl;Martina López;4°B;01/10/2026;15/10/2026;;Atrasado"));
});

test("a backup restores everything exactly, and a wrong file is refused", () => {
  r.lend("B-0001", martina.id);
  const file = r.backup();
  assert.equal(r.summary().last_backup, "2026-10-01");
  const other = new Registry(emptyState(), { today: () => clock.day });
  other.restore(file);
  assert.deepEqual(other.openLoans(), r.openLoans());
  assert.deepEqual(other.books(), r.books());
  rejects(() => other.restore('{"hola": 1}'), "invalid");
  rejects(() => other.restore("not json"), "invalid");
  assert.equal(other.openLoans().length, 1);
});

test("every change is saved, and a refused change saves nothing", () => {
  const n = saves;
  r.lend("B-0001", martina.id);
  assert.equal(saves, n + 1);
  rejects(() => r.lend("B-0001", joaquin.id, null, true));
  assert.equal(saves, n + 1);
});

test("if saving fails, the change is undone in memory too", () => {
  let failing = false;
  const fragile = new Registry(emptyState(), { today: () => clock.day, save: () => { if (failing) throw new Error("disk full"); } });
  fragile.addBook("Matilda", "Roald Dahl");
  const kid = fragile.addStudent("Ana", "1A");
  failing = true;
  assert.throws(() => fragile.lend("B-0001", kid.id), /disk full/);
  assert.equal(fragile.openLoans().length, 0);
  assert.equal(fragile.book(1).available, 1);
});

test("demo data loads and clears without touching real rows", () => {
  r.lend("B-0001", martina.id);
  r.loadDemo(DEMO);
  assert.ok(r.summary().has_demo);
  assert.ok(r.overdue().length > 0);
  r.clearDemo();
  const s = r.summary();
  assert.equal(s.has_demo, false);
  assert.deepEqual([s.books, s.students, s.open], [2, 3, 1]);
});
