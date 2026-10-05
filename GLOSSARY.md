# Biblioteca

The lending registry of one school library, kept by the librarian at the counter on her iPad. It records which student has which book and answers her everyday questions about it.

## Catalogue

**Libro**:
A title the library owns, by title and author. It is never lent itself: its copies are.
_Avoid_: título, obra

**Ejemplar**:
One physical copy of a Libro, identified by its Código. This is the thing that is lent and returned.
_Avoid_: copia, unidad, item

**Código**:
The short label on an Ejemplar (B-0042 by default, or the school's own), unique across the library and typed or scanned at the counter.
_Avoid_: ID, número de inventario

**Color**:
The age band a Libro is for, matching the coloured sticker on the real book: Azul (0 a 7 años), Rojo (7 a 10), Verde (10 a 12). A Libro without one is "Sin color" and shows grey. It belongs to the Libro, not to each Ejemplar.
_Avoid_: categoría, nivel, edad (as the field name)

**Sección**:
Where a Libro lives in the catalogue beyond its age band: Cómics, No ficción, Roald Dahl, Material de referencia… It came from the tabs of her catalogue workbooks. Optional.
_Avoid_: categoría, estante

**Idioma**:
The language a Libro is written in: Español or Inglés (the school has a catalogue for each).
_Avoid_: lengua

**Notas** (of an Ejemplar):
What is particular to one physical copy: who donated it, its edition, "autografiado". Each copy has its own.
_Avoid_: observaciones, comentarios

**Dar de baja**:
To take one Ejemplar out of circulation (lost or damaged) while keeping its history.
_Avoid_: borrar, eliminar

## People

**Alumno**:
A student who can borrow, known by name and Clase.
_Avoid_: usuario, socio, lector

**Clase**:
The student's grade and group, written like 4°B. However it is typed ("4b", "4 B"), it is one Clase.
_Avoid_: grupo, curso, grado (as separate ideas)

## Lending

**Préstamo**:
One Ejemplar in the hands of one Alumno from a lent date until its Devolución. It stays in the history forever.
_Avoid_: retiro, salida

**Planilla**:
One Clase's sheet, the way she kept it in Excel: a tab per Clase, a row per Alumno. She sets the day once (Fecha) and every Préstamo and Devolución written on it carries that day.
_Avoid_: hoja de cálculo, grilla, tabla

**Vence**:
The date a Préstamo should come back. It defaults to the loan period after the lent date.
_Avoid_: fecha límite, deadline

**Atrasado**:
A Préstamo still out after its Vence date.
_Avoid_: vencido, moroso

**Devolución**:
The moment an Ejemplar comes back and its Préstamo closes. It can be undone right after.

**Renovar**:
To give a Préstamo a new full period counted from today.
_Avoid_: extender, prorrogar

**Límite**:
How many Préstamos an Alumno may have at once. Going over it warns but never blocks.

**Archivar**:
To hide a Libro or an Alumno from daily lists without losing its history. Nothing in the registry is deleted.
_Avoid_: borrar, eliminar

## Safety

**Datos de ejemplo**:
Invented students, books and loans for trying the app, marked so they can be removed without touching real ones.

**Copia de seguridad**:
A file with the whole registry, the only other copy of what lives on her iPad.
_Avoid_: backup, exportación
