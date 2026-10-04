// The library registry: books, copies, students and loans.
// Everything the librarian can do or ask goes through `Registry`. It runs in the browser
// (data saved on the iPad) and in Node for the tests. State is one plain object, so a
// backup is just that object as JSON.

export const DEFAULT_SETTINGS = { loan_days: 14, max_loans: 2, library_name: "Biblioteca" };

export class RegistryError extends Error {
  constructor(code, message, info = {}) {
    super(message);
    this.code = code;
    this.info = info;
  }
}

export function emptyState() {
  return {
    version: 1,
    seq: { book: 0, copy: 0, student: 0, loan: 0 },
    books: [], copies: [], students: [], loans: [],
    settings: { ...DEFAULT_SETTINGS },
    last_backup: null,
  };
}

/** Lowercase, strip accents and the ° sign, collapse spaces: 'Cuarto °B ' -> 'cuarto b'. */
export function norm(text) {
  if (!text) return "";
  return String(text).normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[°º]/g, "").replace(/\s+/g, " ").trim();
}

/** '4°B', '4 B', '4b' all become '4b' so classes match however they were typed. */
export const gradeKey = (grade) => norm(grade).replace(/[^0-9a-z]/g, "");

/** '4b' -> '4°B', '4° b' -> '4°B'; anything else is kept as typed. */
export function tidyGrade(grade) {
  const g = String(grade || "").trim();
  const m = g.match(/^(\d{1,2})\s*[°º]?\s*([A-Za-z])?$/);
  return m ? `${m[1]}°${(m[2] || "").toUpperCase()}` : g;
}

const gradeSort = (g) => { const m = String(g || "").match(/^(\d+)/); return [m ? 0 : 1, m ? Number(m[1]) : 0, norm(g)]; };
const cmp = (a, b) => { for (let i = 0; i < a.length; i++) { if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1; } return 0; };
const byKey = (fn) => (x, y) => cmp(fn(x), fn(y));

const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return isoDate(d); };
export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00`) - Date.parse(`${a}T12:00:00`)) / 86400000);
export const localToday = () => isoDate(new Date());

function validIso(value) {
  const s = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T12:00:00`);
  return isNaN(d) || isoDate(d) !== s ? null : s;
}
function parseDue(value) {
  const s = validIso(value);
  if (!s) throw new RegistryError("invalid", "No entendí la fecha de devolución.");
  return s;
}
/**
 * A date as it comes out of a spreadsheet cell: an Excel date serial (45933),
 * dd/mm/yyyy, dd/mm/yy, dd/mm (this year), or yyyy-mm-dd. Empty -> null.
 */
export function sheetDate(value, thisYear = new Date().getFullYear()) {
  const v = String(value ?? "").trim();
  if (!v) return null;
  if (/^\d+(\.\d+)?$/.test(v) && Number(v) > 20000 && Number(v) < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(v)) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  let iso = null;
  if (m) iso = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = v.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/);
  if (m) iso = `${m[3] ? (m[3].length === 2 ? "20" + m[3] : m[3]) : thisYear}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  if (!iso || !validIso(iso)) throw new RegistryError("invalid", `No entendí la fecha «${v}». Escribila como 17/10/2026.`);
  return iso;
}

function positiveInt(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new RegistryError("invalid", `${label} tiene que ser un número.`);
  if (n < 1 || n > 365) throw new RegistryError("invalid", `${label} tiene que estar entre 1 y 365.`);
  return n;
}
const now = () => new Date().toISOString().slice(0, 19);

export class Registry {
  /**
   * @param state  plain object from emptyState() or a backup
   * @param opts.today  () => 'YYYY-MM-DD'
   * @param opts.save   (state) => void|Promise, called after every change
   */
  constructor(state, { today = localToday, save = () => {} } = {}) {
    this.state = migrate(state || emptyState());
    this._today = today;
    this._save = save;
  }

  today() { return this._today(); }

  // Every change goes through here: work on a copy, swap it in only if nothing threw.
  // A failed request can never leave half a change behind.
  _write(fn) {
    const draft = structuredClone(this.state);
    const before = this.state;
    this.state = draft;
    try {
      const out = fn(draft);
      this._save(this.state);
      return out;
    } catch (err) {
      this.state = before;
      throw err;
    }
  }

  _nextId(kind) { return ++this.state.seq[kind]; }

  settings() { return { ...this.state.settings }; }

  updateSettings({ loan_days, max_loans, library_name } = {}) {
    const changes = {};
    if (loan_days != null) changes.loan_days = positiveInt(loan_days, "Los días de préstamo");
    if (max_loans != null) changes.max_loans = positiveInt(max_loans, "El máximo de libros");
    if (library_name != null) {
      const name = String(library_name).trim();
      if (!name) throw new RegistryError("invalid", "El nombre de la biblioteca no puede quedar vacío.");
      changes.library_name = name;
    }
    this._write((s) => Object.assign(s.settings, changes));
    return this.settings();
  }

  // ── books and copies ───────────────────────────────────────────────
  _nextCode() {
    let n = 0;
    for (const c of this.state.copies) {
      const m = c.code.match(/^B-(\d+)$/i);
      if (m) n = Math.max(n, Number(m[1]));
    }
    return `B-${String(n + 1).padStart(4, "0")}`;
  }

  _copyByCode(code) {
    const k = String(code || "").trim().toUpperCase();
    return this.state.copies.find((c) => c.code.toUpperCase() === k) || null;
  }

  _ensureCodeFree(code) {
    const taken = this._copyByCode(code);
    if (taken) throw new RegistryError("code_taken", `El código ${taken.code} ya está en uso.`);
  }

  addBook(title, author = "", copies = 1, codes = [], demo = false) {
    title = String(title || "").trim();
    if (!title) throw new RegistryError("invalid", "Falta el título del libro.");
    codes = (codes || []).map((c) => String(c).trim()).filter(Boolean);
    const count = Math.max(codes.length, Number(copies) || 1);
    if (count < 1 || count > 200) throw new RegistryError("invalid", "La cantidad de ejemplares tiene que estar entre 1 y 200.");
    const seen = new Set();
    for (const code of codes) {
      if (seen.has(code.toUpperCase())) throw new RegistryError("code_taken", `El código ${code.toUpperCase()} está repetido.`);
      seen.add(code.toUpperCase());
      this._ensureCodeFree(code);
    }
    const id = this._write((s) => {
      const bookId = this._nextId("book");
      s.books.push({ id: bookId, title, author: String(author || "").trim(), archived: false, is_demo: demo, created_at: now() });
      for (let i = 0; i < count; i++) {
        const code = i < codes.length ? codes[i] : this._nextCode();
        s.copies.push({ id: this._nextId("copy"), book_id: bookId, code: code.toUpperCase(), archived: false });
      }
      return bookId;
    });
    return this.book(id);
  }

  addCopy(bookId, code) {
    this._requireBook(bookId);
    code = String(code || "").trim() || this._nextCode();
    this._ensureCodeFree(code);
    this._write((s) => s.copies.push({ id: this._nextId("copy"), book_id: Number(bookId), code: code.toUpperCase(), archived: false }));
    return this.book(bookId);
  }

  updateBook(bookId, { title, author } = {}) {
    const b = this._requireBook(bookId);
    title = title == null ? b.title : String(title).trim();
    if (!title) throw new RegistryError("invalid", "Falta el título del libro.");
    author = author == null ? b.author : String(author).trim();
    this._write((s) => Object.assign(s.books.find((x) => x.id === b.id), { title, author }));
    return this.book(bookId);
  }

  setBookArchived(bookId, archived) {
    const b = this._requireBook(bookId);
    if (archived) {
      const out = this._openLoans().filter((l) => this._copy(l.copy_id).book_id === b.id);
      if (out.length) throw new RegistryError("has_loans", "No se puede archivar: hay ejemplares prestados.", { loans: out.map((l) => this._present(l)) });
    }
    this._write((s) => { s.books.find((x) => x.id === b.id).archived = Boolean(archived); });
    return this.book(bookId);
  }

  setCopyArchived(code, archived) {
    const c = this._requireCopy(code);
    if (archived && this._openLoanForCopy(c.id)) throw new RegistryError("has_loans", `El ejemplar ${c.code} está prestado. Registrá la devolución primero.`);
    this._write((s) => { s.copies.find((x) => x.id === c.id).archived = Boolean(archived); });
    return this.book(c.book_id);
  }

  _requireBook(id) {
    const b = this.state.books.find((x) => x.id === Number(id));
    if (!b) throw new RegistryError("not_found", "No encontré ese libro.");
    return b;
  }
  _requireCopy(code) {
    const c = this._copyByCode(code);
    if (!c) throw new RegistryError("not_found", `No hay ningún ejemplar con el código ${code}.`);
    return c;
  }
  _copy(id) { return this.state.copies.find((c) => c.id === id); }

  book(bookId) {
    const b = { ...this._requireBook(bookId) };
    const copies = this.state.copies.filter((c) => c.book_id === b.id)
      .sort(byKey((c) => [c.code]))
      .map((c) => { const loan = this._openLoanForCopy(c.id); return { ...c, loan: loan ? this._present(loan) : null }; });
    b.copies = copies;
    b.available = copies.filter((c) => !c.archived && !c.loan).length;
    b.total = copies.filter((c) => !c.archived).length;
    const ids = new Set(copies.map((c) => c.id));
    b.times_lent = this.state.loans.filter((l) => ids.has(l.copy_id)).length;
    return b;
  }

  books(includeArchived = false) {
    return this.state.books.filter((b) => includeArchived || !b.archived).map((b) => {
      const copies = this.state.copies.filter((c) => c.book_id === b.id && !c.archived);
      return { ...b, total: copies.length, available: copies.filter((c) => !this._openLoanForCopy(c.id)).length };
    }).sort(byKey((b) => [norm(b.title)]));
  }

  bookHistory(bookId) {
    const b = this._requireBook(bookId);
    return this._sortedLoans(this.state.loans.filter((l) => this._copy(l.copy_id).book_id === b.id));
  }

  // ── students ───────────────────────────────────────────────────────
  addStudent(name, grade = "", demo = false) {
    name = String(name || "").trim();
    if (!name) throw new RegistryError("invalid", "Falta el nombre del alumno.");
    const id = this._write((s) => {
      const sid = this._nextId("student");
      s.students.push({ id: sid, name, grade: tidyGrade(grade), archived: false, is_demo: demo, created_at: now() });
      return sid;
    });
    return this.student(id);
  }

  updateStudent(studentId, { name, grade } = {}) {
    const st = this._requireStudent(studentId);
    name = name == null ? st.name : String(name).trim();
    if (!name) throw new RegistryError("invalid", "Falta el nombre del alumno.");
    grade = grade == null ? st.grade : tidyGrade(grade);
    this._write((s) => Object.assign(s.students.find((x) => x.id === st.id), { name, grade }));
    return this.student(studentId);
  }

  setStudentArchived(studentId, archived) {
    const st = this._requireStudent(studentId);
    if (archived && this._openLoans().some((l) => l.student_id === st.id)) {
      throw new RegistryError("has_loans", "No se puede archivar: todavía tiene libros sin devolver.");
    }
    this._write((s) => { s.students.find((x) => x.id === st.id).archived = Boolean(archived); });
    return this.student(studentId);
  }

  _requireStudent(id) {
    const st = this.state.students.find((x) => x.id === Number(id));
    if (!st) throw new RegistryError("not_found", "No encontré a ese alumno.");
    return st;
  }

  student(studentId) {
    const st = { ...this._requireStudent(studentId) };
    st.loans = this._openLoans().filter((l) => l.student_id === st.id)
      .sort(byKey((l) => [l.due_on])).map((l) => this._present(l));
    st.times_borrowed = this.state.loans.filter((l) => l.student_id === st.id).length;
    return st;
  }

  students(includeArchived = false, grade = null) {
    const today = this.today();
    let rows = this.state.students.filter((s) => includeArchived || !s.archived).map((s) => {
      const open = this._openLoans().filter((l) => l.student_id === s.id);
      return { ...s, open_loans: open.length, overdue: open.filter((l) => l.due_on < today).length };
    });
    if (grade) rows = rows.filter((r) => gradeKey(r.grade) === gradeKey(grade));
    return rows.sort(byKey((r) => [...gradeSort(r.grade), norm(r.name)]));
  }

  grades() {
    const seen = new Map();
    for (const s of this.state.students) if (!s.archived && s.grade && !seen.has(gradeKey(s.grade))) seen.set(gradeKey(s.grade), s.grade);
    return [...seen.values()].sort(byKey(gradeSort));
  }

  studentHistory(studentId) {
    const st = this._requireStudent(studentId);
    return this._sortedLoans(this.state.loans.filter((l) => l.student_id === st.id));
  }

  // ── loans ──────────────────────────────────────────────────────────
  _openLoans() { return this.state.loans.filter((l) => l.returned_on == null); }
  _openLoanForCopy(copyId) { return this.state.loans.find((l) => l.copy_id === copyId && l.returned_on == null) || null; }
  _sortedLoans(loans) {
    return loans.slice().sort((a, b) => (a.lent_on === b.lent_on ? b.id - a.id : a.lent_on < b.lent_on ? 1 : -1)).map((l) => this._present(l));
  }

  _present(l) {
    const c = this._copy(l.copy_id);
    const b = this.state.books.find((x) => x.id === c.book_id);
    const s = this.state.students.find((x) => x.id === l.student_id);
    const open = l.returned_on == null;
    const daysLate = open ? Math.max(0, daysBetween(l.due_on, this.today())) : 0;
    return {
      id: l.id, code: c.code, book_id: b.id, title: b.title, author: b.author,
      student_id: s.id, student: s.name, grade: s.grade,
      lent_on: l.lent_on, due_on: l.due_on, returned_on: l.returned_on ?? null,
      open, days_late: daysLate, overdue: daysLate > 0,
    };
  }

  /** Lend one copy. Warnings (limit reached, overdue books) need force; conflicts never pass. */
  lend(code, studentId, dueOn = null, force = false) {
    const copy = this._requireCopy(code);
    const st = this._requireStudent(studentId);
    const book = this._requireBook(copy.book_id);
    if (copy.archived || book.archived) throw new RegistryError("archived", `El ejemplar ${copy.code} está dado de baja.`);
    if (st.archived) throw new RegistryError("archived", `${st.name} está archivado/a.`);
    const holder = this._openLoanForCopy(copy.id);
    if (holder) {
      const h = this._present(holder);
      throw new RegistryError("copy_on_loan", `El ejemplar ${copy.code} figura prestado a ${h.student}.`, { loan: h });
    }
    const current = this.student(st.id).loans;
    if (!force) {
      const warnings = [];
      const limit = this.state.settings.max_loans;
      if (current.length >= limit) warnings.push(`${st.name} ya tiene ${current.length} libro${current.length !== 1 ? "s" : ""} (el máximo es ${limit}).`);
      const late = current.filter((l) => l.overdue);
      if (late.length) warnings.push(`Tiene atrasado: ${late.map((l) => l.title).join(", ")}.`);
      if (warnings.length) throw new RegistryError("needs_confirmation", warnings.join(" "), { loans: current });
    }
    const today = this.today();
    const due = dueOn ? parseDue(dueOn) : addDays(today, this.state.settings.loan_days);
    if (due < today) throw new RegistryError("invalid", "La fecha de devolución no puede ser anterior a hoy.");
    const id = this._write((s) => {
      const lid = this._nextId("loan");
      s.loans.push({ id: lid, copy_id: copy.id, student_id: st.id, lent_on: today, due_on: due, returned_on: null });
      return lid;
    });
    return this.loan(id);
  }

  _requireLoan(id) {
    const l = this.state.loans.find((x) => x.id === Number(id));
    if (!l) throw new RegistryError("not_found", "No encontré ese préstamo.");
    return l;
  }
  loan(id) { return this._present(this._requireLoan(id)); }

  returnCopy(code) {
    const copy = this._requireCopy(code);
    const loan = this._openLoanForCopy(copy.id);
    if (!loan) throw new RegistryError("not_on_loan", `El ejemplar ${copy.code} no figura prestado.`);
    this._write((s) => { s.loans.find((l) => l.id === loan.id).returned_on = this.today(); });
    return this.loan(loan.id);
  }

  undoReturn(loanId) {
    const loan = this._requireLoan(loanId);
    if (loan.returned_on == null) return this.loan(loanId);
    const holder = this._openLoanForCopy(loan.copy_id);
    if (holder) {
      throw new RegistryError("copy_on_loan", `No se puede deshacer: ${this._copy(loan.copy_id).code} ya se volvió a prestar a ${this._present(holder).student}.`);
    }
    this._write((s) => { s.loans.find((l) => l.id === loan.id).returned_on = null; });
    return this.loan(loanId);
  }

  setDue(loanId, dueOn) {
    const loan = this._requireLoan(loanId);
    if (loan.returned_on != null) throw new RegistryError("invalid", "Ese préstamo ya fue devuelto.");
    const due = parseDue(dueOn);
    if (due < loan.lent_on) throw new RegistryError("invalid", "La fecha de devolución no puede ser anterior al préstamo.");
    this._write((s) => { s.loans.find((l) => l.id === loan.id).due_on = due; });
    return this.loan(loanId);
  }

  /** Give the loan another full period counted from today. */
  renew(loanId) { return this.setDue(loanId, addDays(this.today(), this.state.settings.loan_days)); }

  // ── questions ──────────────────────────────────────────────────────
  openLoans() {
    return this._openLoans().map((l) => this._present(l)).sort(byKey((l) => [l.due_on, norm(l.student)]));
  }
  overdue() { return this.openLoans().filter((l) => l.overdue); }
  lentOn(day) { return this._sortedLoans(this.state.loans.filter((l) => l.lent_on === day)); }

  topBooks(limit = 10) {
    const counts = new Map();
    for (const l of this.state.loans) { const b = this._copy(l.copy_id).book_id; counts.set(b, (counts.get(b) || 0) + 1); }
    return [...counts].map(([id, n]) => { const b = this.state.books.find((x) => x.id === id); return { id, title: b.title, author: b.author, times_lent: n }; })
      .sort((a, b) => b.times_lent - a.times_lent || (a.title < b.title ? -1 : 1)).slice(0, limit);
  }

  gradeReport(grade) {
    const students = this.students(false, grade);
    const ids = new Set(students.map((s) => s.id));
    return { grade: students[0]?.grade || tidyGrade(grade), students, loans: this.openLoans().filter((l) => ids.has(l.student_id)) };
  }

  /**
   * Answer whatever she typed in the question box. Recognises a few intents
   * ("atrasados", "hoy", "más leídos", a class like "4°B") and otherwise searches
   * books (title, author, code) and students (name).
   */
  ask(query) {
    let q = norm(query).replace(/[¿?¡!.,]/g, " ");
    q = q.replace(/^\s*(quien|quienes) (tiene|tienen)\s+/, "");
    q = q.replace(/^\s*(que|cuales) (libros? )?(tiene|tienen|se llevo|se llevaron)\s+/, "");
    q = q.replace(/\s+/g, " ").trim();
    if (!q) return { kind: "empty" };
    if (/\batrasad|\bvencid|\bdeben?\b/.test(q)) return { kind: "overdue", loans: this.overdue() };
    if (/^(prestamos |prestados )?(de )?hoy$/.test(q) || q === "que se presto hoy") return { kind: "today", loans: this.lentOn(this.today()) };
    if (/\bmas (leido|pedido|prestado)s?\b|\bpopulares?\b|\branking\b/.test(q)) return { kind: "top", books: this.topBooks() };
    if (/\b(prestados|prestamos)( ahora)?$/.test(q) || q === "afuera") return { kind: "open", loans: this.openLoans() };
    const g = q.replace(/^(clase|grupo|grado) /, "");
    if (/^\d{1,2}\s*[a-z]?$/.test(g) && this.grades().some((x) => gradeKey(x) === gradeKey(g))) {
      return { kind: "grade", ...this.gradeReport(g) };
    }
    const words = q.split(" ");
    const hit = (...fields) => { const hay = fields.map(norm).join(" "); return words.every((w) => hay.includes(w)); };
    const copy = this._copyByCode(query);
    const books = [];
    for (const b of this.books()) {
      if ((copy && copy.book_id === b.id) || hit(b.title, b.author)) books.push(this.book(b.id));
    }
    const students = this.students().filter((s) => hit(s.name)).map((s) => this.student(s.id));
    return { kind: "search", query: String(query).trim(), books: books.slice(0, 12), students: students.slice(0, 12) };
  }

  suggestStudents(query, limit = 8) {
    const words = norm(query).split(" ").filter(Boolean);
    return this.students().filter((s) => words.every((w) => norm(`${s.name} ${s.grade}`).includes(w))).slice(0, limit);
  }

  /** Type-ahead for the counter. mode 'lend' lists available copies, 'return' lists copies on loan. */
  suggestCopies(query, mode, limit = 8) {
    const words = norm(query).split(" ").filter(Boolean);
    const exact = norm(query);
    let out = [];
    for (const c of this.state.copies) {
      const b = this.state.books.find((x) => x.id === c.book_id);
      if (c.archived || b.archived) continue;
      const loan = this._openLoanForCopy(c.id);
      if (Boolean(loan) !== (mode === "return")) continue;
      const s = loan ? this.state.students.find((x) => x.id === loan.student_id) : null;
      const row = { code: c.code, book_id: b.id, title: b.title, author: b.author, loan_id: loan?.id ?? null,
        student: s?.name ?? null, grade: s?.grade ?? null, due_on: loan?.due_on ?? null };
      const hay = norm([c.code, b.title, b.author, s?.name || "", s?.grade || ""].join(" "));
      if (words.every((w) => hay.includes(w))) out.push(row);
    }
    out.sort(byKey((r) => [norm(r.code) !== exact ? 1 : 0, norm(r.title), r.code]));
    if (mode === "lend") {
      // One row per title is enough at the counter; the first free copy goes out.
      const seen = new Set();
      out = out.filter((r) => { if (seen.has(r.book_id) && norm(r.code) !== exact) return false; seen.add(r.book_id); return true; });
    }
    return out.slice(0, limit);
  }

  summary() {
    const loans = this.openLoans();
    return {
      open: loans.length,
      overdue: loans.filter((l) => l.overdue).length,
      books: this.state.books.filter((b) => !b.archived).length,
      students: this.state.students.filter((s) => !s.archived).length,
      has_demo: this.state.books.some((b) => b.is_demo) || this.state.students.some((s) => s.is_demo),
      today: this.today(),
      last_backup: this.state.last_backup,
    };
  }

  // ── import / export ────────────────────────────────────────────────
  /**
   * Import books (titulo, autor, ejemplares, codigo) or students (nombre, clase) from CSV
   * or pasted spreadsheet text. Accepts ',', ';' or tab and an optional header row.
   * Skips rows that already exist; a bad row is reported and never half-saved.
   */
  importCsv(kind, text) {
    return this.importRows(kind, readCsv(text));
  }

  /** Same as importCsv, for rows already read from a spreadsheet (e.g. an .xlsx). */
  importRows(kind, rows) {
    rows = (rows || []).map((r) => (r || []).map((c) => String(c ?? "")));
    const top = rows.findIndex((r) => r.some((c) => c.trim()));
    if (top < 0) throw new RegistryError("invalid", "El archivo está vacío.");
    let header = rows[top].map(norm);
    const known = new Set(["titulo", "autor", "ejemplares", "codigo", "codigos", "nombre", "clase", "grado", "grupo"]);
    let body, firstLine;
    if (header.some((h) => known.has(h))) { body = rows.slice(top + 1); firstLine = top + 2; }
    else { header = kind === "books" ? ["titulo", "autor", "ejemplares", "codigo"] : ["nombre", "clase"]; body = rows.slice(top); firstLine = top + 1; }
    const col = new Map(header.map((h, i) => [h, i]));
    const get = (row, ...names) => { for (const n of names) if (col.has(n) && col.get(n) < row.length) return String(row[col.get(n)]).trim(); return ""; };
    let added = 0, skipped = 0;
    const errors = [];
    body.forEach((row, i) => {
      if (!row.some((cell) => String(cell).trim())) return;
      try {
        if (kind === "books") {
          const title = get(row, "titulo"), author = get(row, "autor");
          if (this.state.books.some((b) => norm(b.title) === norm(title) && norm(b.author) === norm(author))) { skipped++; return; }
          const codes = get(row, "codigo", "codigos").split(/[\s,|/]+/).filter(Boolean);
          const n = get(row, "ejemplares");
          this.addBook(title, author, /^\d+(\.0+)?$/.test(n) ? Number(n) : 1, codes);
        } else if (kind === "students") {
          const name = get(row, "nombre"), grade = get(row, "clase", "grado", "grupo");
          if (this.state.students.some((s) => norm(s.name) === norm(name) && gradeKey(s.grade) === gradeKey(grade))) { skipped++; return; }
          this.addStudent(name, grade);
        } else {
          throw new RegistryError("invalid", "Tipo de importación desconocido.");
        }
        added++;
      } catch (err) {
        if (!(err instanceof RegistryError)) throw err;
        errors.push(`Fila ${firstLine + i}: ${err.message}`);
      }
    });
    return { added, skipped, errors: errors.slice(0, 20) };
  }

  /**
   * Bring over an existing loan registry: one row per loan with the student, the book
   * (title or code) and optionally the lent / due / returned dates. Students and books
   * that are not on the list yet are created and named in the result. Each row is all or
   * nothing; rows already imported are skipped. Accepts the app's own Préstamos export.
   */
  importLoans(rows) {
    rows = (rows || []).map((r) => (r || []).map((c) => String(c ?? "").trim()));
    const top = rows.findIndex((r) => r.some(Boolean));
    if (top < 0) throw new RegistryError("invalid", "El archivo está vacío.");
    const alias = {
      alumno: "alumno", nombre: "alumno", estudiante: "alumno", "nombre del alumno": "alumno",
      clase: "clase", grado: "clase", grupo: "clase",
      libro: "libro", titulo: "libro", "titulo del libro": "libro",
      autor: "autor", codigo: "codigo", ejemplar: "codigo",
      prestado: "prestado", fecha: "prestado", "fecha de prestamo": "prestado", desde: "prestado", "se lo llevo": "prestado",
      vence: "vence", vuelve: "vence", "fecha de devolucion": "vence", devolver: "vence", hasta: "vence",
      devuelto: "devuelto", devolvio: "devuelto", "fecha devuelto": "devuelto", "devuelto el": "devuelto",
    };
    const col = new Map();
    rows[top].forEach((h, i) => { const k = alias[norm(h)]; if (k && !col.has(k)) col.set(k, i); });
    if (!col.has("alumno") || !(col.has("libro") || col.has("codigo"))) {
      throw new RegistryError("invalid", "La primera fila tiene que tener los títulos de las columnas: Alumno, Libro (o Código) y, si querés, Clase, Prestado, Vence y Devuelto.");
    }
    const get = (row, k) => (col.has(k) ? row[col.get(k)] || "" : "");
    const today = this.today();
    const res = { added: 0, returned: 0, skipped: 0, new_students: [], new_books: [], errors: [] };

    rows.slice(top + 1).forEach((row, i) => {
      if (!row.some(Boolean)) return;
      const line = top + 2 + i;
      const before = this.state;
      const created = { students: [], books: [] };
      try {
        const name = get(row, "alumno");
        if (!name) throw new RegistryError("invalid", "Falta el alumno.");
        const grade = get(row, "clase");
        const year = Number(today.slice(0, 4));
        const lentOn = sheetDate(get(row, "prestado"), year) || today;
        const returnedOn = sheetDate(get(row, "devuelto"), year);
        const dueOn = sheetDate(get(row, "vence"), year) || addDays(lentOn, this.state.settings.loan_days);
        if (dueOn < lentOn) throw new RegistryError("invalid", "La fecha de vencimiento es anterior al préstamo.");
        if (returnedOn && returnedOn < lentOn) throw new RegistryError("invalid", "La fecha de devolución es anterior al préstamo.");

        // Student: same name (and class, when given); create it when missing.
        let matches = this.state.students.filter((s) => norm(s.name) === norm(name) && (!grade || gradeKey(s.grade) === gradeKey(grade)));
        if (matches.length > 1) throw new RegistryError("invalid", `Hay ${matches.length} alumnos llamados ${name}; agregá la clase.`);
        let student = matches[0];
        if (!student) { student = this.addStudent(name, grade); created.students.push(`${student.name}${student.grade ? ` (${student.grade})` : ""}`); }

        // Book: by code, else by title (and author when both have one).
        const code = get(row, "codigo"), title = get(row, "libro"), author = get(row, "autor");
        const open = returnedOn == null;
        let copy = code ? this._copyByCode(code) : null;
        let book = copy ? this.state.books.find((b) => b.id === copy.book_id)
          : title ? this.state.books.find((b) => norm(b.title) === norm(title) && (!author || !b.author || norm(b.author) === norm(author))) : null;
        if (!book && !title) throw new RegistryError("invalid", `No hay ningún ejemplar con el código ${code}.`);

        // Already imported: same student, same book, same day.
        if (book && this.state.loans.some((l) => l.student_id === student.id && l.lent_on === lentOn && this._copy(l.copy_id).book_id === book.id)) {
          if (this.state !== before) { this.state = before; this._save(this.state); }
          res.skipped++;
          return;
        }

        // Copy: the one with that code, else a free copy of the title; create what's missing.
        if (!book) { book = this.addBook(title, author, 1, code ? [code] : []); created.books.push(book.title); }
        else if (code && !copy) { this.addCopy(book.id, code); }
        if (!copy) {
          const copies = this.state.copies.filter((c) => c.book_id === book.id && !c.archived);
          copy = code ? this._copyByCode(code) : (open ? copies.find((c) => !this._openLoanForCopy(c.id)) : copies[0]);
          if (!copy) throw new RegistryError("invalid", `Todos los ejemplares de ${book.title} ya figuran prestados. Agregá otro ejemplar en Libros.`);
        }
        if (open) {
          const holder = this._openLoanForCopy(copy.id);
          if (holder) throw new RegistryError("copy_on_loan", `El ejemplar ${copy.code} ya figura prestado a ${this._present(holder).student}.`);
        }
        this._write((s) => {
          s.loans.push({ id: this._nextId("loan"), copy_id: copy.id, student_id: student.id, lent_on: lentOn, due_on: dueOn, returned_on: returnedOn });
        });
        res.added++;
        if (!open) res.returned++;
        res.new_students.push(...created.students);
        res.new_books.push(...created.books);
      } catch (err) {
        if (!(err instanceof RegistryError)) throw err;
        if (this.state !== before) { this.state = before; this._save(this.state); }
        res.errors.push(`Fila ${line}: ${err.message}`);
      }
    });
    res.errors = res.errors.slice(0, 20);
    return res;
  }

  /** The three lists she can download, as columns + typed rows (dates stay ISO). */
  exportTable(kind) {
    const D = "date";
    if (kind === "loans") {
      return {
        name: "Préstamos",
        columns: [["Código", 10], ["Libro", 34], ["Autor", 24], ["Alumno", 26], ["Clase", 8], ["Prestado", 12, D], ["Vence", 12, D], ["Devuelto", 12, D], ["Estado", 11]],
        rows: this._sortedLoans(this.state.loans).map((l) => [l.code, l.title, l.author, l.student, l.grade, l.lent_on, l.due_on, l.returned_on,
          !l.open ? "Devuelto" : l.overdue ? "Atrasado" : "Prestado"]),
      };
    }
    if (kind === "books") {
      const rows = [];
      for (const b of this.books(true)) {
        for (const c of this.book(b.id).copies) {
          rows.push([c.code, b.title, b.author, c.archived || b.archived ? "Dado de baja" : c.loan ? "Prestado" : "Disponible",
            c.loan?.student || "", c.loan?.grade || "", c.loan?.due_on || null]);
        }
      }
      return { name: "Libros", columns: [["Código", 10], ["Título", 34], ["Autor", 24], ["Estado", 13], ["Lo tiene", 26], ["Clase", 8], ["Vence", 12, D]], rows };
    }
    if (kind === "students") {
      return {
        name: "Alumnos",
        columns: [["Nombre", 28], ["Clase", 8], ["Libros en su poder", 18], ["Atrasados", 11], ["Archivado", 11]],
        rows: this.students(true).map((s) => [s.name, s.grade, s.open_loans, s.overdue, s.archived ? "Sí" : ""]),
      };
    }
    throw new RegistryError("invalid", "Tipo de exportación desconocido.");
  }

  exportCsv(kind) {
    const { columns, rows } = this.exportTable(kind);
    const dmy = (iso) => (iso ? iso.split("-").reverse().join("/") : "");
    const cell = (v, i) => {
      const t = columns[i][2] === "date" ? dmy(v) : String(v ?? "");
      return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const lines = [columns.map((c) => c[0]).join(";"), ...rows.map((r) => r.map(cell).join(";"))];
    // BOM so Excel opens accents correctly; ';' because Spanish Excel expects it.
    return "﻿" + lines.join("\r\n") + "\r\n";
  }

  // ── backup ─────────────────────────────────────────────────────────
  /** The whole registry as a JSON string, and remembers that a copy was made today. */
  backup() {
    this._write((s) => { s.last_backup = this.today(); });
    return JSON.stringify({ app: "biblioteca", saved_at: now(), ...this.state }, null, 1);
  }

  /** Replace everything with a backup file's contents (validated first). */
  restore(text) {
    let data;
    try { data = JSON.parse(text); } catch { throw new RegistryError("invalid", "Ese archivo no es una copia de la biblioteca."); }
    if (!data || data.app !== "biblioteca" || !Array.isArray(data.books) || !Array.isArray(data.loans)) {
      throw new RegistryError("invalid", "Ese archivo no es una copia de la biblioteca.");
    }
    const { app, saved_at, ...state } = data;
    this._write((s) => { for (const k of Object.keys(s)) delete s[k]; Object.assign(s, migrate(state)); });
    return this.summary();
  }

  // ── example data ───────────────────────────────────────────────────
  loadDemo(demo) {
    if (this.summary().has_demo) throw new RegistryError("invalid", "Los datos de ejemplo ya están cargados.");
    const start = Number(this._nextCode().slice(2));
    const bookIds = [], studentIds = [];
    demo.BOOKS.forEach(([title, author, n], i) => {
      const codes = Array.from({ length: n }, (_, k) => `B-${String(start + i * 3 + k).padStart(4, "0")}`);
      bookIds.push(this.addBook(title, author, n, codes, true).id);
    });
    for (const [name, grade] of demo.STUDENTS) studentIds.push(this.addStudent(name, grade, true).id);
    const today = this.today();
    this._write((s) => {
      for (const [bi, ci, si, lentAgo, length, returnedAgo] of demo.LOANS) {
        const code = this.book(bookIds[bi]).copies[ci].code;
        const copy = s.copies.find((c) => c.code === code);
        const lent = addDays(today, -lentAgo);
        s.loans.push({ id: this._nextId("loan"), copy_id: copy.id, student_id: studentIds[si], lent_on: lent,
          due_on: addDays(lent, length), returned_on: returnedAgo == null ? null : addDays(today, -returnedAgo) });
      }
    });
    return this.summary();
  }

  /** Remove example books and students, and every loan that touches them. */
  clearDemo() {
    this._write((s) => {
      const demoStudents = new Set(s.students.filter((x) => x.is_demo).map((x) => x.id));
      const demoBooks = new Set(s.books.filter((x) => x.is_demo).map((x) => x.id));
      const demoCopies = new Set(s.copies.filter((c) => demoBooks.has(c.book_id)).map((c) => c.id));
      s.loans = s.loans.filter((l) => !demoStudents.has(l.student_id) && !demoCopies.has(l.copy_id));
      s.copies = s.copies.filter((c) => !demoCopies.has(c.id));
      s.books = s.books.filter((b) => !demoBooks.has(b.id));
      s.students = s.students.filter((x) => !demoStudents.has(x.id));
    });
    return this.summary();
  }
}

function migrate(state) {
  const base = emptyState();
  return { ...base, ...state, seq: { ...base.seq, ...(state.seq || {}) }, settings: { ...base.settings, ...(state.settings || {}) } };
}

/** CSV / pasted spreadsheet text -> rows. Handles quotes; picks ';', ',' or tab from the first line. */
export function readCsv(text) {
  text = String(text || "").replace(/^﻿/, "");
  if (!text.trim()) return [];
  const first = text.split(/\r?\n/)[0];
  const count = (ch) => first.split(ch).length - 1;
  let delim = count(";") > count(",") ? ";" : ",";
  if (count("\t") > count(delim)) delim = "\t";
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
