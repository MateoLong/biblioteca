# Excel files are read and written by our own small code, not a spreadsheet library

She works in Excel (.xlsx). The usual library is large, would have to be cached for offline use, and its free npm version has known security advisories. An .xlsx is a zip of XML: `xlsx.js` unzips it with the browser's DecompressionStream (so iPadOS 16.4+ is needed) and checks zip checksums. It reads only the first sheet and writes one-sheet files with real dates.

To keep it honest, it is tested against files made by Microsoft Excel, LibreOffice and openpyxl (`tests/fixtures/`). Older iPads get a message to paste rows instead.
