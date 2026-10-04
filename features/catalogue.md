# Libros y alumnos
Path: Libros/Alumnos → Agregar; Ajustes → pick the Excel file (.xlsx, first sheet) or a CSV from Files, or paste rows copied from Excel/Numbers.
End state: rows saved (grades normalised: "5a" → "5°A"; copies numbered B-0001…); CSV import reports added / already there / row errors; archive keeps history and is refused while books are out.
Edge: rows already in the list (same name + class, or same title + author) are skipped and counted; a row with a problem is reported by its Excel row number; a file that isn't a spreadsheet gets a clear message.
Colour (age band): each book has Azul (0 a 7 años), Rojo (7 a 10), Verde (10 a 12) or none. Set on Agregar libro and in the book's Editar; import reads a "Color" or "Edad" column ("Rojo", "7 a 10"); an unknown colour is a row error. The forro shows the band (grey when unset) on every screen; Libros has filter chips Todos / Azul / Rojo / Verde / Sin color with counts. Old backups restore with every book unset.
