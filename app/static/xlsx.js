// Reads the first sheet of an Excel .xlsx file into rows of text, with no library:
// an .xlsx is a zip of XML files, and the browser can unzip on its own (DecompressionStream).
// Works the same in Safari (iPadOS 16.4+) and in Node for the tests.

export class XlsxError extends Error {}

const td = new TextDecoder();

/** @param {ArrayBuffer|Uint8Array} data  @returns {Promise<string[][]>} */
export async function readXlsx(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const files = listZip(bytes);
  if (!files.has("xl/workbook.xml")) throw new XlsxError("Ese archivo no es una planilla de Excel (.xlsx).");
  const read = async (name) => (files.has(name) ? td.decode(await unzipEntry(bytes, files.get(name))) : null);

  const shared = parseSharedStrings((await read("xl/sharedStrings.xml")) || "");
  const sheetPath = firstSheetPath(await read("xl/workbook.xml"), (await read("xl/_rels/workbook.xml.rels")) || "", files);
  const sheet = await read(sheetPath);
  if (!sheet) throw new XlsxError("No encontré ninguna hoja en la planilla.");
  return parseSheet(sheet, shared);
}

// ── zip ────────────────────────────────────────────────────────────────
function listZip(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new XlsxError("Ese archivo no es una planilla de Excel (.xlsx).");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new XlsxError("La planilla está dañada.");
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = td.decode(b.subarray(p + 46, p + 46 + nameLen)).replace(/^\//, "");
    files.set(name, { method, size, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

async function unzipEntry(b, { method, size, local }) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (dv.getUint32(local, true) !== 0x04034b50) throw new XlsxError("La planilla está dañada.");
  const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
  const raw = b.subarray(start, start + size);
  if (method === 0) return raw;
  if (method !== 8) throw new XlsxError("La planilla usa una compresión que no conozco.");
  if (typeof DecompressionStream === "undefined") {
    throw new XlsxError("Este iPad no puede abrir .xlsx (necesita iPadOS 16.4 o más nuevo). Copiá y pegá las filas.");
  }
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ── xml ────────────────────────────────────────────────────────────────
// Spreadsheet XML is machine-written and regular, so a few patterns read it reliably
// in both the browser and Node (which has no DOMParser).
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) =>
    e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()]);
}
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`)); return m ? decode(m[1]) : null; };
const stripNs = (xml) => xml.replace(/<(\/?)[A-Za-z0-9_]+:/g, "<$1"); // <x:row> -> <row>

/** Text of every <t> in a string item (plain or rich text runs). */
function itemText(xml) {
  let out = "";
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)) out += decode(m[1] || "");
  return out;
}

function parseSharedStrings(xml) {
  return [...stripNs(xml).matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)].map((m) => itemText(m[1] || ""));
}

function firstSheetPath(workbook, rels, files) {
  const wb = stripNs(workbook);
  const sheet = wb.match(/<sheet\b[^>]*>/);
  const rid = sheet && (attr(sheet[0], "r:id") || attr(sheet[0], "id"));
  if (rid) {
    for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
      if (attr(m[0], "Id") === rid) {
        const target = attr(m[0], "Target");
        const path = target.startsWith("/") ? target.slice(1) : `xl/${target}`.replace(/\/\.\//g, "/");
        if (files.has(path)) return path;
      }
    }
  }
  return [...files.keys()].filter((f) => /^xl\/worksheets\/[^/]+\.xml$/.test(f)).sort()[0] || null;
}

const colIndex = (ref) => {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, "").toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

function parseSheet(xml, shared) {
  const rows = [];
  const data = stripNs(xml).match(/<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/);
  if (!data) return rows;
  for (const rm of data[1].matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g)) {
    const rowAttrs = rm[1] ?? rm[3] ?? "";
    const r = Number(attr(`<row ${rowAttrs}>`, "r")) || rows.length + 1;
    const cells = [];
    let next = 0;
    for (const cm of (rm[2] || "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const tag = `<c ${cm[1]}>`;
      const ref = attr(tag, "r");
      const i = ref ? colIndex(ref) : next;
      next = i + 1;
      const inner = cm[2] || "";
      const type = attr(tag, "t");
      const v = inner.match(/<v>([\s\S]*?)<\/v>/);
      let text = "";
      if (type === "s") text = v ? shared[Number(v[1])] ?? "" : "";
      else if (type === "inlineStr") text = itemText((inner.match(/<is>([\s\S]*?)<\/is>/) || [])[1] || "");
      else if (type === "b") text = v ? (v[1] === "1" ? "VERDADERO" : "FALSO") : "";
      else text = v ? decode(v[1]) : "";
      cells[i] = text;
    }
    while (rows.length < r - 1) rows.push([]); // keep blank rows so "Fila N" matches Excel
    rows[r - 1] = Array.from(cells, (c) => c ?? "");
  }
  return rows;
}
