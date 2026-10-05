# Loans and returns carry the day she says, not only today

She keeps the register after the fact: a class visits on Wednesday and she writes it down on Friday, as she did in Excel. Until now a loan was always dated today and its due date could not be before today, so writing down an earlier day was impossible.

- `lend` takes a lent day (default today) and `returnCopy` a return day (default today). Neither may be after today; a return may not be before its loan. The due date defaults to the loan period after the lent day, not after today.
- A due date before today is now accepted when the lent day is earlier: a loan written down late can already be overdue, and it shows as Atrasado at once. With the lent day = today the old rule holds (due not before today).
- The class sheet applies one Fecha to every loan and return made on it, because a class visit happens on one day. The counter keeps its Prestado day between children for the same reason, and both fall back to today on a new day, so an old date never lingers.
- A loan still out can be removed (`undoLend`, the sheet's Deshacer): typing on the wrong row is the common mistake in a grid. Returned loans are history and cannot be removed.
- Not checked: a backdated loan overlapping a returned loan of the same copy. The counter only offers free copies, and per-copy overlap mattered less than letting her catch up.
