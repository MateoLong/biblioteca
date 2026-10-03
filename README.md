# Biblioteca

Registro de préstamos para la biblioteca de la escuela: quién se llevó qué libro, cuándo vuelve y qué está atrasado. Funciona sin internet, en la propia computadora.

## Para usarla (Mac)

1. Doble clic en **Abrir Biblioteca.command**. La primera vez, si macOS no la deja abrir: clic derecho → **Abrir** → **Abrir**.
2. Se abre el navegador con la biblioteca. **Dejá la ventanita negra abierta** mientras la usás; cerrala cuando termines.
3. Primera vez: probá con **datos de ejemplo**, o cargá tus alumnos y libros desde Excel en **Ajustes**.

En Windows: doble clic en **Abrir Biblioteca (Windows).bat** (necesita Python 3 de python.org).

- **Mostrador**: prestar y devolver (también con lector de código de barras), y la caja **Preguntá**: "¿Quién tiene Matilda?", "Martina", "4°B", "atrasados", "más leídos".
- **Atrasados**: la lista para reclamar, se puede imprimir.
- **Libros / Alumnos**: fichas con historial. Nada se borra: se archiva.
- **Ajustes**: días de préstamo, máximo de libros, cargar planillas, descargar copias.

Todo queda en `datos/biblioteca.db`. Guardá una **Copia de seguridad completa** (Ajustes) en un pendrive de vez en cuando.

## For developers

- Python 3.9+ standard library only; no install. `python3 app/server.py` (env: `BIBLIO_DB`, `BIBLIO_PORT`, `BIBLIO_TODAY`, `BIBLIO_NO_BROWSER`).
- Logic lives in `app/registry.py`; `app/server.py` is a thin JSON layer; the UI is `app/static/` (vanilla JS, local fonts, Lucide icon sprite).
- Tests: `python3 -m unittest discover -s tests`; end to end: `cd tests/e2e && npm install && npm run verify`. See `VERIFY.md`.
- Design: `PRODUCT.md`, `.impeccable/surfaces/` (direction contract), `DESIGN.md`.
