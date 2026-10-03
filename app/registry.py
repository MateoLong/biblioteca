"""The library registry: books, copies, students and loans.

Everything the librarian can do or ask goes through `Registry`. The HTTP
server is a thin JSON layer on top of it, and the tests talk to it directly.
"""
from __future__ import annotations

import csv
import io
import re
import sqlite3
import unicodedata
from datetime import date, datetime, timedelta
from typing import Callable, Optional

SCHEMA = """
CREATE TABLE IF NOT EXISTS books (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS copies (
  id INTEGER PRIMARY KEY,
  book_id INTEGER NOT NULL REFERENCES books(id),
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  grade TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS loans (
  id INTEGER PRIMARY KEY,
  copy_id INTEGER NOT NULL REFERENCES copies(id),
  student_id INTEGER NOT NULL REFERENCES students(id),
  lent_on TEXT NOT NULL,
  due_on TEXT NOT NULL,
  returned_on TEXT
);
-- A copy can only be out with one student at a time.
CREATE UNIQUE INDEX IF NOT EXISTS one_open_loan_per_copy
  ON loans(copy_id) WHERE returned_on IS NULL;
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
"""

DEFAULT_SETTINGS = {"loan_days": "14", "max_loans": "2", "library_name": "Biblioteca"}


class RegistryError(Exception):
    """A request the librarian can fix. `code` lets the UI react; `info` adds context."""

    def __init__(self, code: str, message: str, **info):
        super().__init__(message)
        self.code = code
        self.message = message
        self.info = info


def norm(text: Optional[str]) -> str:
    """Lowercase, strip accents and the ° sign, collapse spaces: 'Cuarto °B ' -> 'cuarto b'."""
    if not text:
        return ""
    text = unicodedata.normalize("NFKD", str(text))
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = text.lower().replace("°", "").replace("º", "")
    return re.sub(r"\s+", " ", text).strip()


def grade_key(grade: str) -> str:
    """'4°B', '4 B', '4b' all become '4b' so classes match however they were typed."""
    return re.sub(r"[^0-9a-z]", "", norm(grade))


class Registry:
    def __init__(self, path: str, today: Optional[Callable[[], date]] = None):
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA foreign_keys = ON")
        self.db.execute("PRAGMA journal_mode = WAL")
        self.db.executescript(SCHEMA)
        for key, value in DEFAULT_SETTINGS.items():
            self.db.execute("INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)", (key, value))
        self.db.commit()
        self._today = today or date.today

    # ── basics ────────────────────────────────────────────────────────────
    def today(self) -> date:
        return self._today()

    def _q(self, sql: str, args=()) -> list[dict]:
        return [dict(r) for r in self.db.execute(sql, args).fetchall()]

    def _one(self, sql: str, args=()) -> Optional[dict]:
        row = self.db.execute(sql, args).fetchone()
        return dict(row) if row else None

    def settings(self) -> dict:
        s = {r["key"]: r["value"] for r in self._q("SELECT key, value FROM settings")}
        return {
            "loan_days": int(s["loan_days"]),
            "max_loans": int(s["max_loans"]),
            "library_name": s["library_name"],
        }

    def update_settings(self, loan_days=None, max_loans=None, library_name=None) -> dict:
        changes = {}
        if loan_days is not None:
            days = _positive_int(loan_days, "Los días de préstamo")
            changes["loan_days"] = str(days)
        if max_loans is not None:
            changes["max_loans"] = str(_positive_int(max_loans, "El máximo de libros"))
        if library_name is not None:
            name = str(library_name).strip()
            if not name:
                raise RegistryError("invalid", "El nombre de la biblioteca no puede quedar vacío.")
            changes["library_name"] = name
        for key, value in changes.items():
            self.db.execute("UPDATE settings SET value = ? WHERE key = ?", (value, key))
        self.db.commit()
        return self.settings()

    # ── books and copies ──────────────────────────────────────────────────
    def _next_code(self) -> str:
        n = 0
        for (code,) in self.db.execute("SELECT code FROM copies"):
            m = re.fullmatch(r"[Bb]-(\d+)", code)
            if m:
                n = max(n, int(m.group(1)))
        return f"B-{n + 1:04d}"

    def add_book(self, title: str, author: str = "", copies: int = 1,
                 codes: Optional[list[str]] = None, demo: bool = False) -> dict:
        title = (title or "").strip()
        if not title:
            raise RegistryError("invalid", "Falta el título del libro.")
        codes = [c.strip() for c in (codes or []) if c and c.strip()]
        count = max(len(codes), int(copies or 1))
        if count < 1 or count > 200:
            raise RegistryError("invalid", "La cantidad de ejemplares tiene que estar entre 1 y 200.")
        for code in codes:
            self._ensure_code_free(code)
        cur = self.db.execute(
            "INSERT INTO books(title, author, is_demo, created_at) VALUES (?, ?, ?, ?)",
            (title, (author or "").strip(), int(demo), _now()),
        )
        book_id = cur.lastrowid
        for i in range(count):
            code = codes[i] if i < len(codes) else self._next_code()
            self.db.execute("INSERT INTO copies(book_id, code) VALUES (?, ?)", (book_id, code.upper()))
        self.db.commit()
        return self.book(book_id)

    def _ensure_code_free(self, code: str):
        taken = self._one("SELECT code FROM copies WHERE code = ? COLLATE NOCASE", (code,))
        if taken:
            raise RegistryError("code_taken", f"El código {taken['code']} ya está en uso.")

    def add_copy(self, book_id: int, code: Optional[str] = None) -> dict:
        self._require_book(book_id)
        code = (code or "").strip() or self._next_code()
        self._ensure_code_free(code)
        self.db.execute("INSERT INTO copies(book_id, code) VALUES (?, ?)", (book_id, code.upper()))
        self.db.commit()
        return self.book(book_id)

    def update_book(self, book_id: int, title=None, author=None) -> dict:
        book = self._require_book(book_id)
        title = book["title"] if title is None else str(title).strip()
        if not title:
            raise RegistryError("invalid", "Falta el título del libro.")
        author = book["author"] if author is None else str(author).strip()
        self.db.execute("UPDATE books SET title = ?, author = ? WHERE id = ?", (title, author, book_id))
        self.db.commit()
        return self.book(book_id)

    def set_book_archived(self, book_id: int, archived: bool) -> dict:
        self._require_book(book_id)
        if archived:
            out = self._q(_OPEN_LOANS_SQL + " AND c.book_id = ?", (book_id,))
            if out:
                raise RegistryError("has_loans", "No se puede archivar: hay ejemplares prestados.",
                                    loans=[self._present_loan(l) for l in out])
        self.db.execute("UPDATE books SET archived = ? WHERE id = ?", (int(archived), book_id))
        self.db.commit()
        return self.book(book_id)

    def set_copy_archived(self, code: str, archived: bool) -> dict:
        copy = self._require_copy(code)
        if archived and self._open_loan_for_copy(copy["id"]):
            raise RegistryError("has_loans", f"El ejemplar {copy['code']} está prestado. Registrá la devolución primero.")
        self.db.execute("UPDATE copies SET archived = ? WHERE id = ?", (int(archived), copy["id"]))
        self.db.commit()
        return self.book(copy["book_id"])

    def _require_book(self, book_id: int) -> dict:
        book = self._one("SELECT * FROM books WHERE id = ?", (book_id,))
        if not book:
            raise RegistryError("not_found", "No encontré ese libro.")
        return book

    def _require_copy(self, code: str) -> dict:
        copy = self._one("SELECT * FROM copies WHERE code = ? COLLATE NOCASE", ((code or "").strip(),))
        if not copy:
            raise RegistryError("not_found", f"No hay ningún ejemplar con el código {code}.")
        return copy

    def book(self, book_id: int) -> dict:
        book = self._require_book(book_id)
        copies = self._q("SELECT * FROM copies WHERE book_id = ? ORDER BY code", (book_id,))
        for c in copies:
            loan = self._open_loan_for_copy(c["id"])
            c["loan"] = self._present_loan(loan) if loan else None
            c["archived"] = bool(c["archived"])
        book["copies"] = copies
        book["archived"] = bool(book["archived"])
        book["available"] = sum(1 for c in copies if not c["archived"] and not c["loan"])
        book["total"] = sum(1 for c in copies if not c["archived"])
        book["times_lent"] = self._one(
            "SELECT COUNT(*) n FROM loans l JOIN copies c ON c.id = l.copy_id WHERE c.book_id = ?", (book_id,)
        )["n"]
        return book

    def books(self, include_archived: bool = False) -> list[dict]:
        rows = self._q(
            """SELECT b.*,
                 SUM(CASE WHEN c.archived = 0 THEN 1 ELSE 0 END) AS total,
                 SUM(CASE WHEN c.archived = 0 AND l.id IS NULL THEN 1 ELSE 0 END) AS available
               FROM books b
               LEFT JOIN copies c ON c.book_id = b.id
               LEFT JOIN loans l ON l.copy_id = c.id AND l.returned_on IS NULL
               WHERE (? OR b.archived = 0)
               GROUP BY b.id""",
            (int(include_archived),),
        )
        for r in rows:
            r["archived"] = bool(r["archived"])
            r["total"] = r["total"] or 0
            r["available"] = r["available"] or 0
        return sorted(rows, key=lambda r: norm(r["title"]))

    def book_history(self, book_id: int) -> list[dict]:
        self._require_book(book_id)
        rows = self._q(_LOANS_SQL + " WHERE c.book_id = ? ORDER BY l.lent_on DESC, l.id DESC", (book_id,))
        return [self._present_loan(r) for r in rows]

    # ── students ──────────────────────────────────────────────────────────
    def add_student(self, name: str, grade: str = "", demo: bool = False) -> dict:
        name = (name or "").strip()
        if not name:
            raise RegistryError("invalid", "Falta el nombre del alumno.")
        cur = self.db.execute(
            "INSERT INTO students(name, grade, is_demo, created_at) VALUES (?, ?, ?, ?)",
            (name, _tidy_grade(grade), int(demo), _now()),
        )
        self.db.commit()
        return self.student(cur.lastrowid)

    def update_student(self, student_id: int, name=None, grade=None) -> dict:
        s = self._require_student(student_id)
        name = s["name"] if name is None else str(name).strip()
        if not name:
            raise RegistryError("invalid", "Falta el nombre del alumno.")
        grade = s["grade"] if grade is None else _tidy_grade(grade)
        self.db.execute("UPDATE students SET name = ?, grade = ? WHERE id = ?", (name, grade, student_id))
        self.db.commit()
        return self.student(student_id)

    def set_student_archived(self, student_id: int, archived: bool) -> dict:
        self._require_student(student_id)
        if archived and self._q(_OPEN_LOANS_SQL + " AND l.student_id = ?", (student_id,)):
            raise RegistryError("has_loans", "No se puede archivar: todavía tiene libros sin devolver.")
        self.db.execute("UPDATE students SET archived = ? WHERE id = ?", (int(archived), student_id))
        self.db.commit()
        return self.student(student_id)

    def _require_student(self, student_id: int) -> dict:
        s = self._one("SELECT * FROM students WHERE id = ?", (student_id,))
        if not s:
            raise RegistryError("not_found", "No encontré a ese alumno.")
        return s

    def student(self, student_id: int) -> dict:
        s = self._require_student(student_id)
        s["archived"] = bool(s["archived"])
        s["loans"] = [self._present_loan(l) for l in
                      self._q(_OPEN_LOANS_SQL + " AND l.student_id = ? ORDER BY l.due_on", (student_id,))]
        s["times_borrowed"] = self._one("SELECT COUNT(*) n FROM loans WHERE student_id = ?", (student_id,))["n"]
        return s

    def students(self, include_archived: bool = False, grade: Optional[str] = None) -> list[dict]:
        rows = self._q(
            """SELECT s.*, COUNT(l.id) AS open_loans,
                 SUM(CASE WHEN l.due_on < ? THEN 1 ELSE 0 END) AS overdue
               FROM students s
               LEFT JOIN loans l ON l.student_id = s.id AND l.returned_on IS NULL
               WHERE (? OR s.archived = 0)
               GROUP BY s.id""",
            (self.today().isoformat(), int(include_archived)),
        )
        if grade:
            rows = [r for r in rows if grade_key(r["grade"]) == grade_key(grade)]
        for r in rows:
            r["archived"] = bool(r["archived"])
            r["overdue"] = r["overdue"] or 0
        return sorted(rows, key=lambda r: (_grade_sort(r["grade"]), norm(r["name"])))

    def grades(self) -> list[str]:
        seen = {}
        for (g,) in self.db.execute("SELECT DISTINCT grade FROM students WHERE archived = 0 AND grade != ''"):
            seen.setdefault(grade_key(g), g)
        return sorted(seen.values(), key=_grade_sort)

    def student_history(self, student_id: int) -> list[dict]:
        self._require_student(student_id)
        rows = self._q(_LOANS_SQL + " WHERE l.student_id = ? ORDER BY l.lent_on DESC, l.id DESC", (student_id,))
        return [self._present_loan(r) for r in rows]

    # ── loans ─────────────────────────────────────────────────────────────
    def _open_loan_for_copy(self, copy_id: int) -> Optional[dict]:
        return self._one(_OPEN_LOANS_SQL + " AND l.copy_id = ?", (copy_id,))

    def _present_loan(self, row: dict) -> dict:
        today = self.today()
        due = date.fromisoformat(row["due_on"])
        returned = row.get("returned_on")
        loan = {
            "id": row["id"],
            "code": row["code"],
            "book_id": row["book_id"],
            "title": row["title"],
            "author": row["author"],
            "student_id": row["student_id"],
            "student": row["student"],
            "grade": row["grade"],
            "lent_on": row["lent_on"],
            "due_on": row["due_on"],
            "returned_on": returned,
            "open": returned is None,
            "days_late": max(0, (today - due).days) if returned is None else 0,
        }
        loan["overdue"] = loan["days_late"] > 0
        return loan

    def lend(self, code: str, student_id: int, due_on: Optional[str] = None, force: bool = False) -> dict:
        """Lend one copy. Warnings (limit reached, overdue books) need `force=True`; conflicts never pass."""
        copy = self._require_copy(code)
        student = self._require_student(student_id)
        book = self._require_book(copy["book_id"])
        if copy["archived"] or book["archived"]:
            raise RegistryError("archived", f"El ejemplar {copy['code']} está dado de baja.")
        if student["archived"]:
            raise RegistryError("archived", f"{student['name']} está archivado/a.")
        holder = self._open_loan_for_copy(copy["id"])
        if holder:
            raise RegistryError(
                "copy_on_loan",
                f"El ejemplar {copy['code']} figura prestado a {holder['student']}.",
                loan=self._present_loan(holder),
            )
        current = self.student(student_id)["loans"]
        if not force:
            warnings = []
            limit = self.settings()["max_loans"]
            if len(current) >= limit:
                warnings.append(f"{student['name']} ya tiene {len(current)} libro{'s' if len(current) != 1 else ''} (el máximo es {limit}).")
            late = [l for l in current if l["overdue"]]
            if late:
                warnings.append(f"Tiene atrasado: {', '.join(l['title'] for l in late)}.")
            if warnings:
                raise RegistryError("needs_confirmation", " ".join(warnings), loans=current)
        today = self.today()
        due = _parse_due(due_on) if due_on else today + timedelta(days=self.settings()["loan_days"])
        if due < today:
            raise RegistryError("invalid", "La fecha de devolución no puede ser anterior a hoy.")
        cur = self.db.execute(
            "INSERT INTO loans(copy_id, student_id, lent_on, due_on) VALUES (?, ?, ?, ?)",
            (copy["id"], student_id, today.isoformat(), due.isoformat()),
        )
        self.db.commit()
        return self.loan(cur.lastrowid)

    def loan(self, loan_id: int) -> dict:
        row = self._one(_LOANS_SQL + " WHERE l.id = ?", (loan_id,))
        if not row:
            raise RegistryError("not_found", "No encontré ese préstamo.")
        return self._present_loan(row)

    def return_copy(self, code: str) -> dict:
        copy = self._require_copy(code)
        loan = self._open_loan_for_copy(copy["id"])
        if not loan:
            raise RegistryError("not_on_loan", f"El ejemplar {copy['code']} no figura prestado.")
        self.db.execute("UPDATE loans SET returned_on = ? WHERE id = ?", (self.today().isoformat(), loan["id"]))
        self.db.commit()
        return self.loan(loan["id"])

    def undo_return(self, loan_id: int) -> dict:
        loan = self.loan(loan_id)
        if loan["open"]:
            return loan
        copy = self._require_copy(loan["code"])
        holder = self._open_loan_for_copy(copy["id"])
        if holder:
            raise RegistryError("copy_on_loan",
                                f"No se puede deshacer: {loan['code']} ya se volvió a prestar a {holder['student']}.")
        self.db.execute("UPDATE loans SET returned_on = NULL WHERE id = ?", (loan_id,))
        self.db.commit()
        return self.loan(loan_id)

    def set_due(self, loan_id: int, due_on: str) -> dict:
        loan = self.loan(loan_id)
        if not loan["open"]:
            raise RegistryError("invalid", "Ese préstamo ya fue devuelto.")
        due = _parse_due(due_on)
        if due < date.fromisoformat(loan["lent_on"]):
            raise RegistryError("invalid", "La fecha de devolución no puede ser anterior al préstamo.")
        self.db.execute("UPDATE loans SET due_on = ? WHERE id = ?", (due.isoformat(), loan_id))
        self.db.commit()
        return self.loan(loan_id)

    def renew(self, loan_id: int) -> dict:
        """Give the loan another full period counted from today."""
        due = self.today() + timedelta(days=self.settings()["loan_days"])
        return self.set_due(loan_id, due.isoformat())

    # ── questions ─────────────────────────────────────────────────────────
    def open_loans(self) -> list[dict]:
        rows = self._q(_OPEN_LOANS_SQL + " ORDER BY l.due_on, s.name")
        return [self._present_loan(r) for r in rows]

    def overdue(self) -> list[dict]:
        return [l for l in self.open_loans() if l["overdue"]]

    def lent_on(self, day: date) -> list[dict]:
        rows = self._q(_LOANS_SQL + " WHERE l.lent_on = ? ORDER BY l.id DESC", (day.isoformat(),))
        return [self._present_loan(r) for r in rows]

    def top_books(self, limit: int = 10) -> list[dict]:
        return self._q(
            """SELECT b.id, b.title, b.author, COUNT(l.id) AS times_lent
               FROM books b JOIN copies c ON c.book_id = b.id JOIN loans l ON l.copy_id = c.id
               GROUP BY b.id ORDER BY times_lent DESC, b.title LIMIT ?""",
            (limit,),
        )

    def grade_report(self, grade: str) -> dict:
        students = self.students(grade=grade)
        ids = {s["id"] for s in students}
        loans = [l for l in self.open_loans() if l["student_id"] in ids]
        label = students[0]["grade"] if students else _tidy_grade(grade)
        return {"grade": label, "students": students, "loans": loans}

    def ask(self, query: str) -> dict:
        """Answer whatever she typed in the question box.

        Recognises a few intents ("atrasados", "hoy", "más leídos", a class like "4°B")
        and otherwise searches books (title, author, code) and students (name).
        """
        q = norm(query)
        q = re.sub(r"[¿?¡!.,]", " ", q)
        q = re.sub(r"^\s*(quien|quienes) (tiene|tienen)\s+", "", q)
        q = re.sub(r"^\s*(que|cuales) (libros? )?(tiene|tienen|se llevo|se llevaron)\s+", "", q)
        q = re.sub(r"\s+", " ", q).strip()
        if not q:
            return {"kind": "empty"}
        if re.search(r"\batrasad|\bvencid|\bdeben\b|\bdebe\b", q):
            return {"kind": "overdue", "loans": self.overdue()}
        if re.fullmatch(r"(prestamos |prestados )?(de )?hoy", q) or q in ("que se presto hoy", "hoy"):
            return {"kind": "today", "loans": self.lent_on(self.today())}
        if re.search(r"\bmas (leido|pedido|prestado)s?\b|\bpopulares?\b|\branking\b", q):
            return {"kind": "top", "books": self.top_books()}
        if re.search(r"\b(prestados|prestamos)( ahora)?\b$", q) or q in ("prestados", "afuera"):
            return {"kind": "open", "loans": self.open_loans()}
        g = re.sub(r"^(clase|grupo|grado) ", "", q)
        if re.fullmatch(r"\d{1,2}\s*[a-z]?", g):
            known = {grade_key(x) for x in self.grades()}
            if grade_key(g) in known:
                return {"kind": "grade", **self.grade_report(g)}

        words = q.split()

        def hit(*fields) -> bool:
            hay = " ".join(norm(f) for f in fields)
            return all(w in hay for w in words)

        copy = self._one("SELECT * FROM copies WHERE code = ? COLLATE NOCASE", (query.strip(),))
        books = []
        for b in self.books():
            if (copy and copy["book_id"] == b["id"]) or hit(b["title"], b["author"]):
                books.append(self.book(b["id"]))
        if not copy:
            for c in self._q("SELECT book_id, code FROM copies"):
                if norm(c["code"]) == q and not any(b["id"] == c["book_id"] for b in books):
                    books.append(self.book(c["book_id"]))
        students = [self.student(s["id"]) for s in self.students() if hit(s["name"])]
        return {"kind": "search", "query": query.strip(), "books": books[:12], "students": students[:12]}

    def suggest_students(self, query: str, limit: int = 8) -> list[dict]:
        words = norm(query).split()
        out = [s for s in self.students() if all(w in norm(s["name"] + " " + s["grade"]) for w in words)]
        return out[:limit]

    def suggest_copies(self, query: str, mode: str, limit: int = 8) -> list[dict]:
        """Type-ahead for the counter. mode='lend' lists available copies, 'return' lists copies on loan."""
        words = norm(query).split()
        rows = self._q(
            """SELECT c.code, c.book_id, b.title, b.author, l.id AS loan_id,
                      s.name AS student, s.grade, l.due_on
               FROM copies c JOIN books b ON b.id = c.book_id
               LEFT JOIN loans l ON l.copy_id = c.id AND l.returned_on IS NULL
               LEFT JOIN students s ON s.id = l.student_id
               WHERE c.archived = 0 AND b.archived = 0"""
        )
        want_open = mode == "return"
        out = []
        for r in rows:
            if (r["loan_id"] is not None) != want_open:
                continue
            hay = norm(" ".join([r["code"], r["title"], r["author"], r["student"] or "", r["grade"] or ""]))
            if all(w in hay for w in words):
                out.append(r)
        exact = norm(query)
        out.sort(key=lambda r: (norm(r["code"]) != exact, norm(r["title"]), r["code"]))
        if mode == "lend":
            # One row per title is enough at the counter; the first free copy goes out.
            seen, unique = set(), []
            for r in out:
                if r["book_id"] in seen and norm(r["code"]) != exact:
                    continue
                seen.add(r["book_id"])
                unique.append(r)
            out = unique
        return out[:limit]

    def summary(self) -> dict:
        loans = self.open_loans()
        return {
            "open": len(loans),
            "overdue": sum(1 for l in loans if l["overdue"]),
            "books": self._one("SELECT COUNT(*) n FROM books WHERE archived = 0")["n"],
            "students": self._one("SELECT COUNT(*) n FROM students WHERE archived = 0")["n"],
            "has_demo": bool(self._one(
                "SELECT (SELECT COUNT(*) FROM books WHERE is_demo = 1) + (SELECT COUNT(*) FROM students WHERE is_demo = 1) n"
            )["n"]),
            "today": self.today().isoformat(),
        }

    # ── import / export ───────────────────────────────────────────────────
    def import_csv(self, kind: str, text: str) -> dict:
        """Import books (titulo, autor, ejemplares, codigo) or students (nombre, clase) from CSV text.

        Accepts ',' or ';' separators and an optional header row. Skips rows that already exist.
        """
        rows = _read_csv(text)
        if not rows:
            raise RegistryError("invalid", "El archivo está vacío.")
        header = [norm(h) for h in rows[0]]
        known = {"titulo", "autor", "ejemplares", "codigo", "codigos", "nombre", "clase", "grado", "grupo"}
        if any(h in known for h in header):
            body = rows[1:]
        else:
            header = (["titulo", "autor", "ejemplares", "codigo"] if kind == "books" else ["nombre", "clase"])
            body = rows
        col = {h: i for i, h in enumerate(header)}

        def get(row, *names):
            for n in names:
                if n in col and col[n] < len(row):
                    return row[col[n]].strip()
            return ""

        added, skipped, errors = 0, 0, []
        for line_no, row in enumerate(body, start=2 if body is not rows else 1):
            if not any(cell.strip() for cell in row):
                continue
            try:
                if kind == "books":
                    title = get(row, "titulo")
                    author = get(row, "autor")
                    if any(norm(b["title"]) == norm(title) and norm(b["author"]) == norm(author)
                           for b in self.books(include_archived=True)):
                        skipped += 1
                        continue
                    codes = [c for c in re.split(r"[\s,|/]+", get(row, "codigo", "codigos")) if c]
                    n = get(row, "ejemplares")
                    self.add_book(title, author, int(n) if n.isdigit() else 1, codes)
                elif kind == "students":
                    name, grade = get(row, "nombre"), get(row, "clase", "grado", "grupo")
                    if any(norm(s["name"]) == norm(name) and grade_key(s["grade"]) == grade_key(grade)
                           for s in self.students(include_archived=True)):
                        skipped += 1
                        continue
                    self.add_student(name, grade)
                else:
                    raise RegistryError("invalid", "Tipo de importación desconocido.")
                added += 1
            except RegistryError as e:
                errors.append(f"Fila {line_no}: {e.message}")
        return {"added": added, "skipped": skipped, "errors": errors[:20]}

    def export_csv(self, kind: str) -> str:
        out = io.StringIO()
        w = csv.writer(out, delimiter=";")
        if kind == "loans":
            w.writerow(["Código", "Libro", "Autor", "Alumno", "Clase", "Prestado", "Vence", "Devuelto", "Estado"])
            for r in self._q(_LOANS_SQL + " ORDER BY l.lent_on DESC, l.id DESC"):
                l = self._present_loan(r)
                state = "Devuelto" if not l["open"] else ("Atrasado" if l["overdue"] else "Prestado")
                w.writerow([l["code"], l["title"], l["author"], l["student"], l["grade"],
                            _dmy(l["lent_on"]), _dmy(l["due_on"]), _dmy(l["returned_on"]), state])
        elif kind == "books":
            w.writerow(["Código", "Título", "Autor", "Estado", "Lo tiene", "Clase", "Vence"])
            for b in self.books(include_archived=True):
                for c in self.book(b["id"])["copies"]:
                    loan = c["loan"]
                    state = "Dado de baja" if c["archived"] or b["archived"] else ("Prestado" if loan else "Disponible")
                    w.writerow([c["code"], b["title"], b["author"], state,
                                loan["student"] if loan else "", loan["grade"] if loan else "",
                                _dmy(loan["due_on"]) if loan else ""])
        elif kind == "students":
            w.writerow(["Nombre", "Clase", "Libros en su poder", "Atrasados", "Archivado"])
            for s in self.students(include_archived=True):
                w.writerow([s["name"], s["grade"], s["open_loans"], s["overdue"], "Sí" if s["archived"] else ""])
        else:
            raise RegistryError("invalid", "Tipo de exportación desconocido.")
        # BOM so Excel opens accents correctly.
        return "﻿" + out.getvalue()

    # ── example data ──────────────────────────────────────────────────────
    def load_demo(self) -> dict:
        from demo_data import BOOKS, STUDENTS, LOANS

        if self.summary()["has_demo"]:
            raise RegistryError("invalid", "Los datos de ejemplo ya están cargados.")
        start = self._next_code_number()
        book_ids, student_ids = [], []
        for i, (title, author, n) in enumerate(BOOKS):
            codes = [f"B-{start + i * 3 + k:04d}" for k in range(n)]
            book_ids.append(self.add_book(title, author, n, codes, demo=True)["id"])
        for name, grade in STUDENTS:
            student_ids.append(self.add_student(name, grade, demo=True)["id"])
        today = self.today()
        for book_i, copy_i, student_i, lent_days_ago, due_in, returned_days_ago in LOANS:
            code = self.book(book_ids[book_i])["copies"][copy_i]["code"]
            copy = self._require_copy(code)
            lent = today - timedelta(days=lent_days_ago)
            returned = (today - timedelta(days=returned_days_ago)).isoformat() if returned_days_ago is not None else None
            self.db.execute(
                "INSERT INTO loans(copy_id, student_id, lent_on, due_on, returned_on) VALUES (?, ?, ?, ?, ?)",
                (copy["id"], student_ids[student_i], lent.isoformat(),
                 (lent + timedelta(days=due_in)).isoformat(), returned),
            )
        self.db.commit()
        return self.summary()

    def _next_code_number(self) -> int:
        return int(self._next_code()[2:])

    def clear_demo(self) -> dict:
        """Remove example books and students, and every loan that touches them."""
        self.db.execute(
            """DELETE FROM loans WHERE student_id IN (SELECT id FROM students WHERE is_demo = 1)
               OR copy_id IN (SELECT c.id FROM copies c JOIN books b ON b.id = c.book_id WHERE b.is_demo = 1)"""
        )
        self.db.execute("DELETE FROM copies WHERE book_id IN (SELECT id FROM books WHERE is_demo = 1)")
        self.db.execute("DELETE FROM books WHERE is_demo = 1")
        self.db.execute("DELETE FROM students WHERE is_demo = 1")
        self.db.commit()
        return self.summary()

    def backup_to(self, path: str):
        dest = sqlite3.connect(path)
        with dest:
            self.db.backup(dest)
        dest.close()


_LOANS_SQL = """
SELECT l.*, c.code, c.book_id, b.title, b.author, s.name AS student, s.grade
FROM loans l
JOIN copies c ON c.id = l.copy_id
JOIN books b ON b.id = c.book_id
JOIN students s ON s.id = l.student_id
"""
_OPEN_LOANS_SQL = _LOANS_SQL + " WHERE l.returned_on IS NULL"


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _positive_int(value, label: str) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        raise RegistryError("invalid", f"{label} tiene que ser un número.")
    if n < 1 or n > 365:
        raise RegistryError("invalid", f"{label} tiene que estar entre 1 y 365.")
    return n


def _parse_due(value: str) -> date:
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        raise RegistryError("invalid", "No entendí la fecha de devolución.")


def _tidy_grade(grade: str) -> str:
    """'4b' -> '4°B', '4° b' -> '4°B'; anything else is kept as typed."""
    g = (grade or "").strip()
    m = re.fullmatch(r"(\d{1,2})\s*[°º]?\s*([A-Za-z])?", g)
    if m:
        return f"{m.group(1)}°{(m.group(2) or '').upper()}"
    return g


def _grade_sort(grade: str):
    m = re.match(r"(\d+)", grade or "")
    return (0 if m else 1, int(m.group(1)) if m else 0, norm(grade))


def _dmy(iso: Optional[str]) -> str:
    if not iso:
        return ""
    y, m, d = iso[:10].split("-")
    return f"{d}/{m}/{y}"


def _read_csv(text: str) -> list[list[str]]:
    text = text.lstrip("﻿")
    first = text.splitlines()[0] if text.strip() else ""
    delim = ";" if first.count(";") > first.count(",") else ","
    if "\t" in first and first.count("\t") > first.count(delim):
        delim = "\t"
    return [r for r in csv.reader(io.StringIO(text), delimiter=delim)]
