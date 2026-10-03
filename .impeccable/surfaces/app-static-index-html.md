---
version: 1
slug: "app-static-index-html"
primary_target: "app/static/index.html"
related_targets: []
---

# Surface: the library desk app (all screens)

Scope: app/static/index.html and every screen it routes to (Mostrador, Atrasados, Libros, Alumnos, Ajustes). Mode: Operate.
Audience/job: one librarian at the counter with a queue of children; lend, return, answer "who has / what has / what's late".
Constraints: offline, Spanish (UY), no modals for routine tasks, undo instead of confirm.
Decision process: owner delegated choices ("go with your suggestions"); the assigned direction was taken unattended, no decision page shown.

## Direction contract

THESIS: Every book wears its school forro and every loan is an etiqueta escolar filled in by hand. Refuses the category default of a grey admin table with one blue accent, and the cute-app default of pastel cards with emoji.

OWN-WORLD: Contact-paper colour fields (cobalt "moña" blue shell band with a small repeating star print, tomato, sunflower, grass, violet, turquoise, pink as book forros) on a cool túnica-white ground. Etiquetas: white label with a rounded double frame in the book's forro colour, a "Nombre / Grado" line set in Patrick Hand. UI type is Baloo 2 for headings and buttons, Atkinson Hyperlegible for data. Sunflower yellow is the only action colour (raise from the warm-consumer canon card: colour only where something can be pressed).

STORY: She sees the counter at once, lends or returns in two typed words plus Enter, and answers any question in the same search box, in full sentences ("Matilda lo tiene Martina López, 4°B, hasta el 17/10").

FIRST VIEWPORT: Cobalt forro band on top with the library name and tabs (Mostrador · Atrasados with count · Libros · Alumnos · Ajustes). Left two-thirds: the counter, a Prestar / Devolver switch, two type-ahead fields, a big sunflower button. Right third: "Preguntá" search plus question chips, with answers rendered beneath. Below: "Prestados ahora" as a strip of book forros, each with its etiqueta.

SIGNATURE MOVE: on lend, the etiqueta slides onto the book's forro tile and the student's name writes itself onto the label line (clip-path reveal, about 600 ms, honouring reduced motion). Raises: book forro colour as each book's identity, from the streaming-wall challenger's "artwork is the only colour"; overdue rows ordered by due date and holding the tomato state until resolved, from the gate-board challenger.

FORM: assigned candidate 7 of 7 (forro + etiqueta escolar), seed key 398b9d90.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
