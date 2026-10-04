# Biblioteca

Registro de préstamos para la biblioteca de la escuela: quién se llevó qué libro, cuándo vuelve y qué está atrasado. Hecho para usar en un **iPad** con Safari. Funciona sin internet y los datos quedan solo en ese iPad.

## Para usarla en el iPad

1. Abrí la dirección de la biblioteca en **Safari**.
2. Tocá **Compartir** (el cuadrado con la flecha) → **Agregar a pantalla de inicio**. Queda un ícono "Biblioteca" como cualquier app.
3. Abrila siempre desde ese ícono. Funciona aunque no haya Wi-Fi.
4. La primera vez: probá con **datos de ejemplo**, o cargá alumnos y libros en **Ajustes** (copiá las filas de Excel o Numbers y pegalas).

**Importante:** todo se guarda solo en ese iPad. Una vez por semana tocá **Ajustes → Guardar copia de seguridad**; el archivo queda en la app Archivos y desde ahí se puede mandar por mail o a Drive. Si un día hay que cambiar de iPad, en el nuevo: **Ajustes → Recuperar una copia**. La app avisa cuando pasó una semana sin copia.

- **Mostrador**: prestar y devolver (también con lector de código de barras por Bluetooth), y la caja **Preguntá**: "¿Quién tiene Matilda?", "Martina", "4°B", "atrasados", "más leídos".
- **Atrasados**: la lista para reclamar.
- **Libros / Alumnos**: fichas con historial. Nada se borra: se archiva.
- **Ajustes**: días de préstamo, máximo de libros, cargar planillas, copias de seguridad, planillas para Excel.

## Probarla desde una Mac

Doble clic en **Probar en esta Mac.command**. Se abre en el navegador de la Mac y muestra una dirección para abrirla desde un iPad conectado al mismo Wi-Fi. (Así se prueba todo menos el modo sin internet, que necesita la dirección definitiva con https.)

## For developers

- Static site, no build step: `app/static/`. Logic in `registry.js` (pure, runs in Node and the browser); `local-api.js` answers the same `/api/...` routes the UI calls and saves the state to IndexedDB; `sw.js` caches the app for offline use (bump `VERSION` on every release).
- Host anywhere that serves static files over https (needed for the offline cache and Home Screen install).
- Tests: `npm test` (Node, registry). End to end on WebKit at iPad sizes: `cd tests/e2e && npm install && npx playwright install webkit && npm run verify`. See `VERIFY.md`.
- Design: `PRODUCT.md`, `DESIGN.md`, `.impeccable/surfaces/`.
