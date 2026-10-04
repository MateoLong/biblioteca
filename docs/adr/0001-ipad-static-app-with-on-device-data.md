# The app runs entirely in Safari on her iPad, with data stored only on the device

The first version was a Python server with SQLite on a computer. The librarian's only device is an iPad, which cannot run it. So the registry moved into the page (`registry.js`): it is saved in IndexedDB, works offline through a service worker, and installs to the Home Screen.

## Consequences

- There is no server copy of her data. The weekly Copia de seguridad (a JSON file, with a reminder) is the only safety net. Changing the storage key or the backup format without a migration can lose her data.
- The whole registry is one document, saved with coalesced writes: a burst of changes becomes one or two writes. That keeps big imports fast and means nothing is lost if she closes the app.
