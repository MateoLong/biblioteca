"""Local web server: serves the page and a small JSON API over the Registry.

Run:  python3 app/server.py            (opens the browser)
Env:  BIBLIO_DB=path/to.db  BIBLIO_PORT=8765  BIBLIO_NO_BROWSER=1  BIBLIO_TODAY=2026-10-03
"""
from __future__ import annotations

import json
import mimetypes
import os
import re
import sys
import tempfile
import threading
import webbrowser
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from registry import Registry, RegistryError  # noqa: E402

STATIC = HERE / "static"
ROOT = HERE.parent
DB_PATH = os.environ.get("BIBLIO_DB") or str(ROOT / "datos" / "biblioteca.db")

_fixed_today = os.environ.get("BIBLIO_TODAY")
registry: Registry  # set in main()
lock = threading.Lock()


def route(method: str, pattern: str):
    def deco(fn):
        ROUTES.append((method, re.compile("^" + pattern + "$"), fn))
        return fn
    return deco


ROUTES: list = []


@route("GET", "/api/summary")
def _summary(q, body):
    return {**registry.summary(), "settings": registry.settings(), "grades": registry.grades()}


@route("GET", "/api/ask")
def _ask(q, body):
    return registry.ask(q.get("q", ""))


@route("GET", "/api/suggest/students")
def _suggest_students(q, body):
    return registry.suggest_students(q.get("q", ""))


@route("GET", "/api/suggest/copies")
def _suggest_copies(q, body):
    return registry.suggest_copies(q.get("q", ""), q.get("mode", "lend"))


@route("GET", "/api/loans")
def _loans(q, body):
    return registry.overdue() if q.get("filter") == "overdue" else registry.open_loans()


@route("POST", "/api/loans")
def _lend(q, body):
    return registry.lend(body.get("code", ""), int(body.get("student_id") or 0),
                         body.get("due_on"), bool(body.get("force")))


@route("POST", "/api/returns")
def _return(q, body):
    return registry.return_copy(body.get("code", ""))


@route("POST", r"/api/loans/(\d+)/undo-return")
def _undo(q, body, loan_id):
    return registry.undo_return(int(loan_id))


@route("POST", r"/api/loans/(\d+)/renew")
def _renew(q, body, loan_id):
    return registry.renew(int(loan_id))


@route("PATCH", r"/api/loans/(\d+)")
def _set_due(q, body, loan_id):
    return registry.set_due(int(loan_id), body.get("due_on", ""))


@route("GET", "/api/books")
def _books(q, body):
    return registry.books(include_archived=q.get("archived") == "1")


@route("POST", "/api/books")
def _add_book(q, body):
    codes = [c for c in re.split(r"[\s,]+", body.get("codes") or "") if c]
    return registry.add_book(body.get("title", ""), body.get("author", ""), int(body.get("copies") or 1), codes)


@route("GET", r"/api/books/(\d+)")
def _book(q, body, book_id):
    return {**registry.book(int(book_id)), "history": registry.book_history(int(book_id))}


@route("PATCH", r"/api/books/(\d+)")
def _update_book(q, body, book_id):
    book_id = int(book_id)
    if "archived" in body:
        registry.set_book_archived(book_id, bool(body["archived"]))
    if "title" in body or "author" in body:
        registry.update_book(book_id, body.get("title"), body.get("author"))
    return registry.book(book_id)


@route("POST", r"/api/books/(\d+)/copies")
def _add_copy(q, body, book_id):
    return registry.add_copy(int(book_id), body.get("code"))


@route("PATCH", r"/api/copies/([^/]+)")
def _copy(q, body, code):
    return registry.set_copy_archived(code, bool(body.get("archived")))


@route("GET", "/api/students")
def _students(q, body):
    return registry.students(include_archived=q.get("archived") == "1", grade=q.get("grade") or None)


@route("POST", "/api/students")
def _add_student(q, body):
    return registry.add_student(body.get("name", ""), body.get("grade", ""))


@route("GET", r"/api/students/(\d+)")
def _student(q, body, student_id):
    return {**registry.student(int(student_id)), "history": registry.student_history(int(student_id))}


@route("PATCH", r"/api/students/(\d+)")
def _update_student(q, body, student_id):
    student_id = int(student_id)
    if "archived" in body:
        registry.set_student_archived(student_id, bool(body["archived"]))
    if "name" in body or "grade" in body:
        registry.update_student(student_id, body.get("name"), body.get("grade"))
    return registry.student(student_id)


@route("GET", "/api/settings")
def _settings(q, body):
    return registry.settings()


@route("PATCH", "/api/settings")
def _update_settings(q, body):
    return registry.update_settings(body.get("loan_days"), body.get("max_loans"), body.get("library_name"))


@route("POST", r"/api/import/(books|students)")
def _import(q, body, kind):
    return registry.import_csv(kind, body.get("text", ""))


@route("POST", "/api/demo")
def _demo(q, body):
    return registry.load_demo()


@route("DELETE", "/api/demo")
def _clear_demo(q, body):
    return registry.clear_demo()


class Handler(BaseHTTPRequestHandler):
    server_version = "Biblioteca/1.0"

    def log_message(self, fmt, *args):  # keep the terminal quiet for her
        if os.environ.get("BIBLIO_LOG"):
            super().log_message(fmt, *args)

    def _send(self, status: int, payload: bytes, ctype: str, extra: dict | None = None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(payload)

    def _json(self, status: int, data):
        self._send(status, json.dumps(data, ensure_ascii=False).encode(), "application/json; charset=utf-8")

    def _dispatch(self, method: str):
        url = urlparse(self.path)
        if not url.path.startswith("/api/"):
            return self._static(url.path) if method == "GET" else self._json(404, {"error": "No encontrado."})
        if url.path.startswith("/api/export/"):
            return self._export(url.path.rsplit("/", 1)[-1])
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        body = {}
        length = int(self.headers.get("Content-Length") or 0)
        if length:
            try:
                body = json.loads(self.rfile.read(length) or b"{}")
            except json.JSONDecodeError:
                return self._json(400, {"error": "Pedido inválido."})
        for m, pattern, fn in ROUTES:
            match = pattern.match(url.path)
            if m == method and match:
                try:
                    with lock:
                        return self._json(200, fn(q, body, *match.groups()))
                except RegistryError as e:
                    status = 404 if e.code == "not_found" else 409
                    return self._json(status, {"error": e.message, "code": e.code, **e.info})
                except (ValueError, TypeError) as e:
                    return self._json(400, {"error": "Algún dato no tiene el formato esperado.", "detail": str(e)})
        self._json(404, {"error": "No encontrado."})

    def _export(self, kind: str):
        today = registry.today().isoformat()
        if kind == "backup":
            fd, tmp = tempfile.mkstemp(suffix=".db")
            os.close(fd)
            try:
                with lock:
                    registry.backup_to(tmp)
                data = Path(tmp).read_bytes()
            finally:
                os.unlink(tmp)
            return self._send(200, data, "application/octet-stream",
                              {"Content-Disposition": f'attachment; filename="biblioteca-copia-{today}.db"'})
        names = {"loans": "prestamos", "books": "libros", "students": "alumnos"}
        if kind not in names:
            return self._json(404, {"error": "No encontrado."})
        with lock:
            text = registry.export_csv(kind)
        self._send(200, text.encode("utf-8"), "text/csv; charset=utf-8",
                   {"Content-Disposition": f'attachment; filename="{names[kind]}-{today}.csv"'})

    def _static(self, path: str):
        rel = "index.html" if path in ("/", "") else path.lstrip("/")
        target = (STATIC / rel).resolve()
        if not str(target).startswith(str(STATIC)) or not target.is_file():
            return self._json(404, {"error": "No encontrado."})
        ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if target.suffix == ".woff2":
            ctype = "font/woff2"
        if ctype.startswith("text/") or ctype in ("application/javascript", "image/svg+xml"):
            ctype += "; charset=utf-8"
        self._send(200, target.read_bytes(), ctype)

    def do_GET(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")

    def do_PATCH(self):
        self._dispatch("PATCH")

    def do_DELETE(self):
        self._dispatch("DELETE")


def main():
    global registry
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    today = (lambda: date.fromisoformat(_fixed_today)) if _fixed_today else None
    registry = Registry(DB_PATH, today=today)
    port = int(os.environ.get("BIBLIO_PORT", "8765"))
    try:
        server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    except OSError:
        # Already running (she double-clicked twice): just open it.
        print(f"La biblioteca ya está abierta en http://localhost:{port}")
        if not os.environ.get("BIBLIO_NO_BROWSER"):
            webbrowser.open(f"http://localhost:{port}")
        return
    url = f"http://localhost:{port}"
    print(f"Biblioteca abierta en {url}\nDejá esta ventana abierta mientras la usás. Para cerrar: Ctrl+C.")
    if not os.environ.get("BIBLIO_NO_BROWSER"):
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
