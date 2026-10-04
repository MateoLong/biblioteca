# Cargar préstamos desde Excel
Path: Ajustes → Cargar préstamos desde Excel → pick the .xlsx (or CSV, or paste rows with the title row).
Columns (by title, any order): Alumno, Libro (title) or Código, and optionally Clase, Autor, Prestado, Vence, Devuelto. Dates: Excel date cells, dd/mm/yyyy, dd/mm, or yyyy-mm-dd.
End state: each row becomes one loan (open, or in the history when Devuelto has a date); missing Prestado = today, missing Vence = Prestado + loan days; students and books not on the list are created and named in the result; a row whose book has no free copy, or that names two students with the same name without a class, is reported by its Excel row and changes nothing; importing the same file again adds nothing; the app's own Préstamos download re-imports cleanly.
