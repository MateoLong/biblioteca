// .xlsx reading, against files made by the real apps (Microsoft Excel, LibreOffice, openpyxl)
// plus a hand-built one with inline strings and uncompressed entries.
// Run: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readXlsx, XlsxError } from "../app/static/xlsx.js";
import { Registry, emptyState } from "../app/static/registry.js";

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const fresh = () => new Registry(emptyState(), { today: () => "2026-10-03" });

test("Excel: accents, ñ, &, apostrophe, <>, a number cell and a blank row", async () => {
  const rows = await readXlsx(fixture("alumnos-excel.xlsx"));
  assert.deepEqual(rows, [
    ["Nombre", "Clase"],
    ["Martina López", "4°B"],
    ["Joaquín Pereira", "4b"],
    ["Ñandú O'Neil & Pérez", "5° A"],
    [],
    ["Sofía <la de 6>", "6"],
  ]);
});

test("Excel: books with number cells, quotes and an empty trailing cell", async () => {
  const rows = await readXlsx(fixture("libros-excel.xlsx"));
  assert.deepEqual(rows[0], ["Título", "Autor", "Ejemplares", "Código"]);
  assert.deepEqual(rows[1].slice(0, 3), ["Cuentos de la selva", "Horacio Quiroga", "3"]);
  assert.deepEqual(rows[2], ["Matilda", "Roald Dahl", "1", "B-0040"]);
  assert.deepEqual(rows[3].slice(0, 3), ['El "Principito"', "Antoine de Saint-Exupéry", "2"]);
});

test("LibreOffice file reads the same way", async () => {
  assert.deepEqual(await readXlsx(fixture("alumnos-libreoffice.xlsx")), [
    ["Nombre", "Clase"], ["Lucía Fernández", "3°A"], ["Bruno Rodríguez", "3a"],
  ]);
});

test("openpyxl: blank first row, rich text, empty cell, gap row; only the first sheet", async () => {
  const rows = await readXlsx(fixture("alumnos-openpyxl.xlsx"));
  assert.deepEqual(rows, [[], ["Nombre", "Clase"], ["Renata Díaz", "6°B"], ["Tomás"], [], ["Lautaro Ramos", "6b"], ["", "1°A"]]);
});

test("inline strings, namespaced tags and shared strings, absolute sheet path, stored entries, a gap mid-row", async () => {
  assert.deepEqual(await readXlsx(fixture("libros-inline-stored.xlsx")), [["titulo", "autor", "ejemplares"], ["Mafalda & Cía", "Quino", "2"], ["Corazón", "", "1"]]);
});

test("a file that is not a spreadsheet is refused with a clear message", async () => {
  await assert.rejects(readXlsx(new TextEncoder().encode("Nombre;Clase\nAna;1A\n")), XlsxError);
  await assert.rejects(readXlsx(new Uint8Array(0)), XlsxError);
});

test("importing the Excel students file: classes tidied, rows numbered like Excel", async () => {
  const r = fresh();
  const res = r.importRows("students", await readXlsx(fixture("alumnos-excel.xlsx")));
  assert.deepEqual([res.added, res.skipped, res.errors], [4, 0, []]);
  assert.deepEqual(r.students().map((s) => `${s.name} ${s.grade}`), [
    "Joaquín Pereira 4°B", "Martina López 4°B", "Ñandú O'Neil & Pérez 5°A", "Sofía <la de 6> 6°",
  ]);
  // importing the same file again adds nothing
  assert.equal(r.importRows("students", await readXlsx(fixture("alumnos-excel.xlsx"))).skipped, 4);
});

test("importing the Excel books file: copies from the number cell, given codes kept", async () => {
  const r = fresh();
  const res = r.importRows("books", await readXlsx(fixture("libros-excel.xlsx")));
  assert.equal(res.added, 3);
  assert.equal(r.ask("cuentos selva").books[0].total, 3);
  assert.deepEqual(r.ask("matilda").books[0].copies.map((c) => c.code), ["B-0040"]);
  assert.equal(r.ask("principito").books[0].total, 2);
});

test("a header below a blank first row is found, a student without a class is accepted, a row without a name is reported by its Excel row", async () => {
  const r = fresh();
  const res = r.importRows("students", await readXlsx(fixture("alumnos-openpyxl.xlsx")));
  assert.equal(res.added, 3); // Renata, Tomás (no class), Lautaro
  assert.deepEqual(res.errors, ["Fila 7: Falta el nombre del alumno."]); // the row number she sees in Excel
  assert.deepEqual(r.students().map((s) => s.name).sort(), ["Lautaro Ramos", "Renata Díaz", "Tomás"]);
  assert.equal(r.students(false, "6B").length, 2);
});
