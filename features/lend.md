# Prestar un libro
Path: Mostrador → Prestar → type part of the student's name, Enter → type part of the title (or scan the code), Enter → Prestar.
End state: the book tile appears with its etiqueta filled in (Nombre, Grado, Vuelve); a loan row exists with lent_on = today and due_on = today + loan_days; focus is back on Alumno for the next child.
Edge: student already at the limit or with a late book → yellow warning, nothing written until "Prestar igual". Copy already out → offer "Registrar devolución y prestar".
