// The "server" now lives in the page: the same routes the screens always called,
// answered by the Registry, with everything saved on this device (IndexedDB).
import { Registry, RegistryError, emptyState, localToday, readCsv } from "./registry.js";
import * as DEMO from "./demo-data.js";
import { writeXlsx } from "./xlsx.js";

const DB_NAME = "biblioteca";
const STORE = "kv";
const KEY = "state";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function readState(db) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
function writeState(db, state) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(state, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

let db = null;
let registry = null;
let latest = null;   // newest state not yet written
let writing = null;  // the running write loop, if any
let onSaveError = () => {};

// Tests pin the date with window.BIBLIO_TODAY; she always gets the iPad's own date.
const today = () => globalThis.BIBLIO_TODAY || localToday();

/** Load the saved registry (or start empty). Call once before anything else. */
export async function start({ saveError } = {}) {
  onSaveError = saveError || onSaveError;
  db = await openDb();
  const saved = await readState(db);
  registry = new Registry(saved || emptyState(), { today, save: persist });
  // Ask Safari to keep this data even when the iPad is low on space.
  navigator.storage?.persist?.().catch(() => {});
  // If the app was open in two places, pick up the newer copy when coming back.
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible") return;
    const stored = await readState(db).catch(() => null);
    if (stored && (stored.rev || 0) > (registry.state.rev || 0)) registry.state = stored;
  });
  globalThis.__biblio = { state: () => registry.state, saved: () => flushed().then(() => readState(db)) };
  return registry;
}

// Saves are coalesced: while one write runs, later changes only mark the newest state,
// which is written next. A big import costs a couple of writes, not one per row.
function persist(state) {
  state.rev = (state.rev || 0) + 1;
  latest = state;
  writing ??= (async () => {
    while (latest) {
      const snapshot = structuredClone(latest);
      latest = null;
      try { await writeState(db, snapshot); } catch (err) { onSaveError(err); }
    }
    writing = null;
  })();
}

/** Resolves once every change so far is written to the device. */
export const flushed = async () => { while (writing) await writing; };

// ── routes ─────────────────────────────────────────────────────────────
const ROUTES = [
  ["GET", /^\/api\/summary$/, () => ({ ...registry.summary(), settings: registry.settings(), grades: registry.grades() })],
  ["GET", /^\/api\/ask$/, (q) => registry.ask(q.get("q") || "")],
  ["GET", /^\/api\/suggest\/students$/, (q) => registry.suggestStudents(q.get("q") || "")],
  ["GET", /^\/api\/suggest\/copies$/, (q) => registry.suggestCopies(q.get("q") || "", q.get("mode") || "lend")],
  ["GET", /^\/api\/loans$/, (q) => (q.get("filter") === "overdue" ? registry.overdue() : registry.openLoans())],
  ["POST", /^\/api\/loans$/, (q, b) => registry.lend(b.code || "", Number(b.student_id) || 0, b.due_on, Boolean(b.force))],
  ["POST", /^\/api\/returns$/, (q, b) => registry.returnCopy(b.code || "")],
  ["POST", /^\/api\/loans\/(\d+)\/undo-return$/, (q, b, id) => registry.undoReturn(id)],
  ["POST", /^\/api\/loans\/(\d+)\/renew$/, (q, b, id) => registry.renew(id)],
  ["PATCH", /^\/api\/loans\/(\d+)$/, (q, b, id) => registry.setDue(id, b.due_on || "")],
  ["GET", /^\/api\/books$/, (q) => registry.books(q.get("archived") === "1")],
  ["POST", /^\/api\/books$/, (q, b) => registry.addBook(b.title || "", b.author || "", Number(b.copies) || 1,
    String(b.codes || "").split(/[\s,]+/).filter(Boolean))],
  ["GET", /^\/api\/books\/(\d+)$/, (q, b, id) => ({ ...registry.book(id), history: registry.bookHistory(id) })],
  ["PATCH", /^\/api\/books\/(\d+)$/, (q, b, id) => {
    if ("archived" in b) registry.setBookArchived(id, b.archived);
    if ("title" in b || "author" in b) registry.updateBook(id, b);
    return registry.book(id);
  }],
  ["POST", /^\/api\/books\/(\d+)\/copies$/, (q, b, id) => registry.addCopy(id, b.code)],
  ["PATCH", /^\/api\/copies\/([^/]+)$/, (q, b, code) => registry.setCopyArchived(decodeURIComponent(code), Boolean(b.archived))],
  ["GET", /^\/api\/students$/, (q) => registry.students(q.get("archived") === "1", q.get("grade") || null)],
  ["POST", /^\/api\/students$/, (q, b) => registry.addStudent(b.name || "", b.grade || "")],
  ["GET", /^\/api\/students\/(\d+)$/, (q, b, id) => ({ ...registry.student(id), history: registry.studentHistory(id) })],
  ["PATCH", /^\/api\/students\/(\d+)$/, (q, b, id) => {
    if ("archived" in b) registry.setStudentArchived(id, b.archived);
    if ("name" in b || "grade" in b) registry.updateStudent(id, b);
    return registry.student(id);
  }],
  ["PATCH", /^\/api\/settings$/, (q, b) => registry.updateSettings(b)],
  ["POST", /^\/api\/import\/(books|students)$/, (q, b, kind) =>
    (Array.isArray(b.rows) ? registry.importRows(kind, b.rows) : registry.importCsv(kind, b.text || ""))],
  ["POST", /^\/api\/import\/loans$/, (q, b) => registry.importLoans(Array.isArray(b.rows) ? b.rows : readCsv(b.text || ""))],
  ["POST", /^\/api\/restore$/, (q, b) => registry.restore(b.text || "")],
  ["POST", /^\/api\/demo$/, () => registry.loadDemo(DEMO)],
  ["DELETE", /^\/api\/demo$/, () => registry.clearDemo()],
];

/** Same contract the old HTTP server had: resolves with data, rejects with {status, data}. */
export async function call(method, path, body = {}) {
  const url = new URL(path, "http://local");
  for (const [m, pattern, fn] of ROUTES) {
    const match = url.pathname.match(pattern);
    if (m !== method || !match) continue;
    try {
      const data = fn(url.searchParams, body && typeof body === "object" ? body : {}, ...match.slice(1));
      return structuredClone(data);
    } catch (err) {
      if (err instanceof RegistryError) {
        throw { status: err.code === "not_found" ? 404 : 409, data: { error: err.message, code: err.code, ...err.info } };
      }
      console.error(err);
      throw { status: 500, data: { error: "No se pudo guardar. No se cambió nada; probá de nuevo." } };
    }
  }
  throw { status: 404, data: { error: "No encontrado." } };
}

// ── files: Excel exports and full backups ─────────────────────────────
export function download(kind) {
  const day = registry.today();
  let data, name, type;
  if (kind === "backup") {
    data = registry.backup();
    name = `biblioteca-copia-${day}.json`;
    type = "application/json";
  } else {
    const names = { loans: "prestamos", books: "libros", students: "alumnos" };
    data = writeXlsx(registry.exportTable(kind));
    name = `${names[kind]}-${day}.xlsx`;
    type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return name;
}
