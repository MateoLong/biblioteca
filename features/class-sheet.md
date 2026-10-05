# Planilla de la clase
Path: Clases → tap the class tab (4°B) → set Fecha once (today by default; Ayer, or type 30/09) → on each student's row type part of the title or scan the code, Enter.
End state: a loan row exists with lent_on = the sheet's Fecha and due_on = its Vuelve (Fecha + loan_days by default; moving Fecha keeps the length); the row shows the new book and focus moves to the next student's row. "Devolvió" on a book closes its loan with returned_on = the sheet's Fecha. The toast's Deshacer removes a loan typed on the wrong row. The last row adds a student to that class.
Edge: limit or late book → yellow warning on that row, nothing written until "Prestar igual". Fecha after today, or a return before the loan's lent day, is refused. A Fecha not set today goes back to today the next day.
Rows: active students of that class, in the order they were loaded (her Excel order). Students without a class get a "Sin clase" tab.
