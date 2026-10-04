// Importing an existing loan registry, spreadsheet dates, and .xlsx downloads that read back.
// Run: node --test tests/
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Registry, emptyState, sheetDate, readCsv } from "../app/static/registry.js";
import { readXlsx, writeXlsx } from "../app/static/xlsx.js";
import * as DEMO from "../app/static/demo-data.js";

let r;
beforeEach(() => {
  r = new Registry(emptyState(), { today: () => "2026-10-03" });
  r.addBook("Matilda", "Roald Dahl", 2);
  r.addBook("El Principito", "Saint-Exupéry");
  r.addStudent("Martina López", "4°B");
  r.addStudent("Joaquín Pereira", "4°B");
});
const xlsx = (name) => readXlsx(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

test("spreadsheet dates: Excel serials, dd/mm/yyyy, dd/mm/yy, dd/mm, ISO; nonsense is refused", () => {
  assert.equal(sheetDate("46296"), "2026-10-01");
  assert.equal(sheetDate("17/10/2026"), "2026-10-17");
  assert.equal(sheetDate("1-9-26"), "2026-09-01");
  assert.equal(sheetDate("5/3", 2027), "2027-03-05");
  assert.equal(sheetDate("2026-10-17"), "2026-10-17");
  assert.equal(sheetDate(""), null);
  assert.throws(() => sheetDate("31/02/2026"), /No entendí la fecha/);
  assert.throws(() => sheetDate("ayer"), /No entendí la fecha/);
});

test("a real Excel registry: open and returned loans, new student and book named, bad row reported", async () => {
  const res = r.importLoans(await xlsx("prestamos-excel.xlsx"));
  assert.equal(res.added, 3);
  assert.equal(res.returned, 1);
  assert.deepEqual(res.new_students, ["Ana Nueva (1°A)"]);
  assert.deepEqual(res.new_books, ["Un libro que no estaba"]);
  assert.deepEqual(res.errors, ["Fila 5: Falta el alumno."]);

  const martina = r.ask("martina").students[0];
  assert.deepEqual(martina.loans.map((l) => [l.title, l.lent_on, l.due_on]), [["Matilda", "2026-10-01", "2026-10-15"]]);
  const joaquin = r.ask("joaquin").students[0];
  assert.equal(joaquin.loans.length, 0); // returned on 02/10, so only in history
  assert.deepEqual(r.studentHistory(joaquin.id).map((l) => [l.title, l.lent_on, l.returned_on]), [["El Principito", "2026-09-20", "2026-10-02"]]);
  const ana = r.ask("ana nueva").students[0];
  assert.deepEqual(ana.loans.map((l) => [l.title, l.due_on]), [["Un libro que no estaba", "2026-10-12"]]); // 28/09 + 14 days
  assert.equal(r.overdue().length, 0); // today is 03/10: nothing imported is late yet
});

test("importing the same file twice adds nothing", async () => {
  r.importLoans(await xlsx("prestamos-excel.xlsx"));
  const again = r.importLoans(await xlsx("prestamos-excel.xlsx"));
  assert.deepEqual([again.added, again.skipped, again.new_students, again.new_books], [0, 3, [], []]);
});

test("a copy already out is refused for that row only, and the row creates nothing", () => {
  r.lend("B-0003", r.ask("martina").students[0].id); // El Principito, the only copy
  const res = r.importLoans(readCsv("Alumno;Libro\nAlumna Nueva;El Principito\nJoaquín Pereira;Matilda\n"));
  assert.equal(res.added, 1);
  assert.match(res.errors[0], /^Fila 2: Todos los ejemplares de El Principito ya figuran prestados/);
  assert.equal(r.students().some((s) => s.name === "Alumna Nueva"), false); // rolled back with its row
});

test("by code, with own-export columns; two students with the same name need the class", () => {
  r.addStudent("Martina López", "6°A");
  const res = r.importLoans(readCsv("Código;Libro;Autor;Alumno;Clase;Prestado;Vence;Devuelto;Estado\nB-0002;Matilda;Roald Dahl;Martina López;6a;02/10/2026;16/10/2026;;Prestado\n;Matilda;;Martina López;;;;;\n"));
  assert.equal(res.added, 1);
  assert.match(res.errors[0], /Hay 2 alumnos llamados Martina López; agregá la clase/);
  assert.equal(r.student(r.students(false, "6A")[0].id).loans[0].code, "B-0002");
});

test("missing column titles get a clear message", () => {
  assert.throws(() => r.importLoans(readCsv("Martina;Matilda\n")), /títulos de las columnas/);
});

test(".xlsx downloads read back: the Préstamos export re-imports into an empty registry", async () => {
  r.loadDemo(DEMO);
  const file = writeXlsx(r.exportTable("loans"));
  const rows = await readXlsx(file);
  assert.deepEqual(rows[0], ["Código", "Libro", "Autor", "Alumno", "Clase", "Prestado", "Vence", "Devuelto", "Estado"]);
  const empty = new Registry(emptyState(), { today: () => "2026-10-03" });
  const res = empty.importLoans(rows);
  assert.equal(res.errors.length, 0, res.errors.join("\n"));
  assert.equal(res.added, r.state.loans.length);
  const key = (l) => [l.code, l.student, l.lent_on, l.due_on, l.returned_on].join("|");
  assert.deepEqual(empty.openLoans().map(key).sort(), r.openLoans().map(key).sort());
  assert.deepEqual(empty.overdue().length, r.overdue().length);
});

test(".xlsx downloads hold real Excel dates (sortable, shown dd/mm/yyyy), not text", async () => {
  r.lend("B-0001", r.ask("martina").students[0].id);
  const rows = await readXlsx(writeXlsx(r.exportTable("loans")));
  assert.equal(rows[1][5], "46298"); // 03/10/2026 as an Excel date number
  assert.equal(rows[1][6], "46312"); // 17/10/2026
  assert.equal(sheetDate(rows[1][5]), "2026-10-03");
});

test("a damaged file is refused instead of read wrong", async () => {
  const file = writeXlsx(r.exportTable("students"));
  const at = new TextDecoder("latin1").decode(file).indexOf("Martina");
  file[at] = "W".charCodeAt(0); // flip one byte inside the sheet
  await assert.rejects(readXlsx(file), /dañada/);
});

test(".xlsx downloads keep accents, symbols and numbers", async () => {
  r.addStudent('Ñandú "Tito" O\'Neil & <Pérez>', "5a");
  const rows = await readXlsx(writeXlsx(r.exportTable("students")));
  assert.ok(rows.some((row) => row[0] === 'Ñandú "Tito" O\'Neil & <Pérez>' && row[1] === "5°A" && row[2] === "0"));
});
