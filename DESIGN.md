Design Notes

Database
- Uses better-sqlite3 for a simple, synchronous SQLite integration with minimal overhead.
- WAL mode is enabled for better concurrent read/write behavior.
- `foreign_keys=ON` is set to enforce relational integrity.

Schema
- `channels(channelId TEXT PRIMARY KEY)`
- `playlist_items(itemId TEXT PRIMARY KEY, channelId TEXT NOT NULL, idx INTEGER NOT NULL, title TEXT NOT NULL, createdAt INTEGER NOT NULL)`
- Unique constraint and index on `(channelId, idx)` for ordered playback.

Migrations
- Idempotent `CREATE TABLE IF NOT EXISTS` and index creation in `migrate(db)`.
- The app runs migrations when it opens the default db file.

Testing
- Tests create a temporary sqlite file per test, run migrations, and inject the db into `createApp({ db })`.
- This avoids shared state and keeps tests deterministic.
