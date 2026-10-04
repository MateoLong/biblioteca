# Importing Préstamos creates the Alumnos and Libros it does not find

When she brings over her old registry, a loan row may name a student or book that is not on the list yet. Refusing those rows would make migration painful, so they are created. The result names every one created, so a typo is easy to spot. Each row is all-or-nothing, and the same student + book + lent date is skipped as already imported.
