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
    const crc = dv.getUint32(p + 16, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = td.decode(b.subarray(p + 46, p + 46 + nameLen)).replace(/^\//, "");
    files.set(name, { method, crc, size, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

async function unzipEntry(b, entry) {
  const out = await inflateEntry(b, entry);
  if (crc32(out) !== entry.crc) throw new XlsxError("La planilla está dañada. Probá guardarla de nuevo desde Excel.");
  return out;
}

async function inflateEntry(b, { method, size, local }) {
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

// ── writing ────────────────────────────────────────────────────────────
// A real .xlsx for the downloads: one sheet, bold frozen header, column widths,
// dates as Excel dates shown dd/mm/yyyy. Entries are stored (not compressed): the
// files are small and this keeps the writer tiny.

const xmlEsc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]))
  // characters XML 1.0 does not allow
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const colName = (i) => { let s = ""; for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
const excelSerial = (iso) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86400000);

/**
 * @param table {name, columns: [[title, width, "date"?]], rows: any[][]}
 * @returns Uint8Array with the .xlsx file
 */
export function writeXlsx({ name, columns, rows }) {
  const cell = (v, r, c, header = false) => {
    const ref = `${colName(c)}${r}`;
    if (v == null || v === "") return "";
    if (header) return `<c r="${ref}" t="inlineStr" s="1"><is><t>${xmlEsc(v)}</t></is></c>`;
    if (columns[c][2] === "date") return `<c r="${ref}" s="2"><v>${excelSerial(v)}</v></c>`;
    if (typeof v === "number") return `<c r="${ref}"><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
  };
  const sheetRows = [
    `<row r="1">${columns.map((col, c) => cell(col[0], 1, c, true)).join("")}</row>`,
    ...rows.map((row, i) => `<row r="${i + 2}">${row.map((v, c) => cell(v, i + 2, c)).join("")}</row>`),
  ];
  const sheetName = xmlEsc(String(name).replace(/[\[\]:*?/\\]/g, "").slice(0, 31) || "Hoja1");
  const files = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    "xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${columns.map((col, c) => `<col min="${c + 1}" max="${c + 1}" width="${col[1] || 12}" customWidth="1"/>`).join("")}</cols><sheetData>${sheetRows.join("")}</sheetData></worksheet>`,
  };
  return zipStored(files);
}

let CRC_TABLE = null;
function crc32(bytes) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC_TABLE[n] = c >>> 0; }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zipStored(files) {
  const te = new TextEncoder();
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = te.encode(name), data = te.encode(text), crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, 0, true); lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true); local.set(nameBytes, 30);
    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true); cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true); cv.setUint32(42, offset, true); central.set(nameBytes, 46);
    locals.push(local, data);
    centrals.push(central);
    offset += local.length + data.length;
  }
  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, centrals.length, true); ev.setUint16(10, centrals.length, true);
  ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + 22);
  let p = 0;
  for (const part of [...locals, ...centrals, end]) { out.set(part, p); p += part.length; }
  return out;
}
