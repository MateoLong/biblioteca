# A book's colour is its age band, set by her

The school marks every book with a coloured sticker by reading age: azul 0 a 7 años, rojo 7 a 10, verde 10 a 12. Until now the app gave each book a decorative forro colour derived from its id, which would clash with the real stickers (a red forro on a blue-sticker book). So the forro colour now means the band, and only those three inks are used for book covers. The print still comes from the id, so books of the same band stay distinguishable.

- Stored as `book.color`: `"azul" | "rojo" | "verde" | ""`. Typed input accepts the colour name or the age range ("0 a 7", "7-10 años"); anything else is refused with a message, never guessed.
- A book without a band is grey ("Sin color"), not a random colour, so a colour on screen always means an age. The Libros filter has a "Sin color" chip listing the ones still to set.
- Backups made before this have no `color`; `migrate()` sets it to `""` on load and restore, so old copies still restore (tested).
- Excel: the Libros sheet gets a "Color" column, and book import reads a "Color" or "Edad" column, so an exported sheet re-imports with its colours (copies per title and archived state do not round-trip; that predates this).
- Excel turns "7-10" / "10-12" into dates. A date serial or a pasted date whose day and month are 7 and 10 (or 10 and 12) is read back as that range.
- An unreadable colour never costs her the book: the row is imported without a colour and the result says which row and what it couldn't read. A hand-edited backup's colour is tidied the same way on restore, and junk becomes "".
