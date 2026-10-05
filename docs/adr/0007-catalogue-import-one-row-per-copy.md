# The catalogue imports one row per copy, and books carry editorial, idioma and sección

The school's catalogue is two workbooks (Spanish, English), a tab per age band plus tabs like Cómics or Roald Dahl, one row per physical copy, copies numbered "(1)", "(2)" in the title, and free note columns (collection, donor, "Uruguayo"). Importing it as "one row per title, skip repeats" would have thrown away every second copy and every note.

- A book gains Editorial, Idioma and Sección; an Ejemplar gains Notas (donations and editions belong to the physical copy). Old state loads with them empty.
- Book import groups rows: same title + author, and the same colour / idioma / sección where the row gives them, is one book; each row adds its copies with its note. Only books that existed before the import are skipped, so re-importing a file is still harmless.
- The same title under two stickers or in two sections stays two books, like the two tabs it came from.
- The Libros download uses the import's column names, one row per copy, so it round-trips.
- Turning her workbooks into that one file is a one-off job done outside the app (the "(n)" copy marks, tab → colour or sección, 1,220 books / 1,308 copies). The app does not read her raw multi-tab layout; her real catalogue is never committed to this public repo.
