Design Notes

1. Indexing rule
- 0-based indexing (0..N-1) for playlist items.
- Chosen to match array semantics in clients and make pagination/offset reasoning straightforward.

2. Persistence choice + data model
- SQLite with better-sqlite3 for a lightweight, synchronous, easy-to-test persistence layer.
- WAL mode is enabled for better read/write concurrency; `foreign_keys=ON` enforces relational integrity.
- Tables:
  - `channels(channelId TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 1)`
  - `playlist_items(itemId TEXT PRIMARY KEY, channelId TEXT NOT NULL, idx INTEGER NOT NULL, title TEXT NOT NULL, createdAt INTEGER NOT NULL, FOREIGN KEY(channelId) REFERENCES channels(channelId))`
- Indexes:
  - Unique index on `(channelId, idx)` to enforce contiguous ordering.
  - Non-unique index on `(channelId, idx)` for ordered reads and pagination.

3. Pagination strategy
- Cursor-based pagination using `idx` as the cursor.
- Cursor semantics: `cursor` is the last returned item’s `idx`; the next page returns items with `idx > cursor`.
- Response shape:
  - `items`: ordered by `idx` ascending
  - `page`: `{ limit, nextCursor, hasMore }`
  - `totalCount`
  - `serverFingerprint`
- Concurrency: if a client is stale, mutations are rejected via fingerprint mismatch. Clients should refresh via list when they receive 409.

4. Fingerprint algorithm
- Per-channel version integer stored in `channels.version`, returned as a string.
- Version increments on every successful insert, delete, or move.
- Tradeoffs: zero collisions and very cheap; does not encode content/order itself, so correctness depends on bumping version for every mutation.

5. Safe shifting strategy
- All insert/delete/move operations run inside a SQLite transaction for atomicity.
- To avoid transient UNIQUE(channelId, idx) violations, shifts are performed row-by-row in a safe order:
  - Insert: select affected rows ordered by `idx DESC`, then update each row to `idx + 1`.
  - Delete: select rows with `idx > deletedIdx` ordered by `idx ASC`, then update each to `idx - 1`.
  - Move: temporarily set the moved item’s `idx` to `-1`, then shift ranges row-by-row (ASC or DESC as appropriate), then set the moved item to `newIndex`.
- This avoids collisions during mid-update when the unique index is enforced.

6. API schema conventions + error format
- Success status codes:
  - 200 for list, delete, move, sync-check
  - 201 for insert
- Error status codes:
  - 400 for invalid input (`{ errorCode: "INVALID_REQUEST" }`)
  - 404 for missing items (`{ errorCode: "ITEM_NOT_FOUND" }`)
  - 409 for fingerprint mismatch (`{ errorCode: "PLAYLIST_FINGERPRINT_MISMATCH", serverFingerprint }`)
- `clientFingerprint` is provided in the JSON request body for all mutating endpoints (insert, delete, move, sync-check) to keep a consistent API shape.
