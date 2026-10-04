// Behaviour of the registry through its public interface (the same code the iPad runs).
// Run: node --test tests/
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Registry, RegistryError, emptyState, addDays } from "../app/static/registry.js";
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
