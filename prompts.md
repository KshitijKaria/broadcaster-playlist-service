## 1. You are working in a Node.js Express 5 project with Vitest + Supertest E2E tests.

Current state:
- app.js: Express app factory that registers express.json() and mounts a health router.
- index.js: starts the app on PORT (default 3000) and logs the URL.
- routes/health.js: GET /health returns { status: "ok" }.
- test/health.test.js: Vitest + Supertest checks /health 200 and JSON {status:"ok"}.
- package.json deps: express@5, better-sqlite3
- dev deps: vitest, supertest
- README.md, DESIGN.md, ASSUMPTIONS.md exist but are empty.

TASK:
Install/configure and implement better-sqlite3 usage + initial schema in a clean, testable way.

Requirements:
1) Create a small DB module using better-sqlite3:
   - src/db/db.js (or db.js if src/ not used): exports
     - openDb({ filename }): returns a connected db instance
     - migrate(db): runs migrations (idempotent)
     - closeDb(db)
   - Use WAL mode + foreign_keys=ON.
   - Use a migrations table to track schema version OR use CREATE TABLE IF NOT EXISTS + indexes (idempotent is fine).

2) Implement schema for playlist system:
   - channels(channelId TEXT PRIMARY KEY)
   - playlist_items(
       itemId TEXT PRIMARY KEY,
       channelId TEXT NOT NULL,
       idx INTEGER NOT NULL,
       title TEXT NOT NULL,
       createdAt INTEGER NOT NULL,
       FOREIGN KEY(channelId) REFERENCES channels(channelId)
     )
   - Enforce UNIQUE(channelId, idx)
   - Index on (channelId, idx)

3) Wire DB into the Express app factory:
   - Modify app.js so createApp accepts options:
     createApp({ db } = {})
   - If db is not passed, open a default persistent db file (e.g. ./data/playlist.db),
     run migrate(db), and attach db to app.locals.db.
   - Add graceful close handling in index.js for SIGINT/SIGTERM if app opened the db.
   - Tests should be able to pass their own db.

4) Add a new router for a minimal DB-backed endpoint to prove persistence works:
   - Route: GET /api/debug/db-info
   - Response: { ok: true, channelCount: <int>, itemCount: <int> }
   - It should query SQLite counts and return them.
   - This is temporary but helps verify db wiring and migrations.

5) Add E2E tests for DB wiring:
   - Create test helpers that open a temp sqlite file per test (not :memory:),
     run migrate, and pass db into createApp.
   - Test: GET /api/debug/db-info returns 200 and {ok:true, channelCount:0, itemCount:0}.
   - Test: insert a channel + one playlist_item directly via db in the test (SQL),
     then GET /api/debug/db-info shows updated counts.
   - Ensure db is closed at end of tests.

6) Update docs (write concise content, not empty):
   - README.md: how to run server + tests, what endpoints exist so far
   - DESIGN.md: explain why better-sqlite3, schema, why WAL, how db injected for tests
   - ASSUMPTIONS.md: note that debug endpoint is temporary and for assignment scaffolding

Constraints:
- Keep code small and clean.
- Use CommonJS or ESM consistently with the existing project (match current files).
- No ORMs. Use better-sqlite3 prepared statements.
- All tests must be deterministic and runnable with: npm test

Deliverables:
- New/updated files: db module, migrations, debug router, app.js/index.js updates, tests, docs.
- Ensure existing /health test still passes.
- Ensure new tests pass.


## 2. You are working in a Node.js (ESM) repo with:
- Express 5
- better-sqlite3
- Vitest + Supertest
- createApp() factory in app.js
- index.js starts server on PORT
- health router already exists and has passing tests

Implement the next milestone for the broadcaster playlist assignment:

A) Persistence wiring
1) Ensure the SQLite schema migrations run on startup and in tests.
2) If there is a DB module with openDb() and migrate(db), call migrate(db) wherever db is created.

B) Add required endpoint: paginated list items
Implement:
GET /api/channels/:channelId/playlist/items?limit=..&cursor=..

Requirements:
- Return items in playlist order by idx ascending.
- Pagination: use cursor-based pagination where cursor is the last returned index (integer).
  - If cursor is omitted: start from beginning.
  - Query should return items with idx > cursor.
  - Use limit with default 50, min 1, max 200.
  - Fetch limit+1 rows to determine hasMore.
  - nextCursor is the last item's index if hasMore else null.
- Response JSON shape:
{
  "items": [ { "itemId": "...", "index": 0, "title": "..." }, ... ],
  "page": { "limit": 50, "nextCursor": 49, "hasMore": true },
  "totalCount": 4000,
  "serverFingerprint": "..."
}
- serverFingerprint must be deterministic for the channel’s current playlist ordering.
  Use a per-channel version integer stored in the DB (e.g., channels.version default 1) and return it as a string.
  If channels table does not have version, update migration to add it (including safe upgrade for existing DBs).
- Ensure a channel row exists before listing (insert-on-conflict-do-nothing).

C) Add an E2E test for pagination
Create tests/pagination.e2e.test.js using Vitest + Supertest that:
- Creates a temp sqlite DB file (in os.tmpdir()) for isolation.
- Opens db + runs migrate(db).
- Seeds 120 items for channel "demo-news" with idx 0..119 and unique itemIds.
- Calls the list endpoint with limit=50 and loops using nextCursor until hasMore is false.
- Asserts:
  - totalCount is 120 on each page
  - serverFingerprint exists and is a string
  - items are strictly increasing by index within each page
  - across all pages, exactly 120 unique itemIds are returned (no missing, no duplicates)
- The test should not require starting a server on a port; use Supertest with the Express app instance.

D) Keep repo conventions
- Use ESM imports/exports (package.json has "type":"module").
- Keep /health behavior unchanged.
- Keep code minimal and readable, no extra debug endpoints.
- After implementation, `npm test` should pass.

Make the minimal necessary file additions/edits:
- Add or update DB module (openDb/migrate helpers and channel version helpers).
- Update app.js to register the new route.
- Ensure server entry uses openDb + migrate and attaches db (either via dependency injection createApp({db}) or app.locals.db).
- Add the new E2E test.

## 3. You are working in a Node.js (ESM) Express repo with:
- Express 5
- better-sqlite3
- SQLite schema includes:
  - channels(channelId TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 1)
  - playlist_items(itemId TEXT PRIMARY KEY, channelId TEXT NOT NULL, idx INTEGER NOT NULL, title TEXT NOT NULL, createdAt INTEGER NOT NULL)
  - UNIQUE(channelId, idx)
- DB helpers exist (or add if missing):
  - ensureChannel(db, channelId)
  - getChannelVersion(db, channelId)
  - bumpChannelVersion(db, channelId) -> increments version and returns new version
- The app stores db either via dependency injection createApp({ db }) or app.locals.db
- List endpoint already returns serverFingerprint = String(version)
- Tests use Vitest + Supertest

Implement required endpoint:
POST /api/channels/:channelId/playlist/items

Request body JSON:
{ "title": "Breaking News", "index": 0, "clientFingerprint": "..." }

Behavior:
1) Validate input:
   - title must be a non-empty string
   - index must be an integer
   - clientFingerprint must be a non-empty string
   - if invalid -> 400 with a simple errorCode (e.g., INVALID_REQUEST)
2) Determine current playlist length N for this channel (COUNT(*) from playlist_items).
   Choose and document an out-of-range policy:
   - If index < 0 -> 400
   - If index > N -> 400 (do NOT clamp)  [use this policy unless code already chose clamp]
3) Fingerprint check:
   - ensureChannel(db, channelId)
   - currentVersion = getChannelVersion(db, channelId)
   - if clientFingerprint !== String(currentVersion):
       return 409 with JSON:
       { "errorCode": "PLAYLIST_FINGERPRINT_MISMATCH", "serverFingerprint": String(currentVersion) }
4) If match, perform insert atomically in ONE SQLite transaction:
   - Shift items: UPDATE playlist_items SET idx = idx + 1
     WHERE channelId = ? AND idx >= ?
     (Do shift before inserting to avoid UNIQUE(channelId, idx) conflicts.)
   - Insert the new row with:
     - itemId generated by server (use crypto.randomUUID())
     - channelId
     - idx = requested index
     - title = provided title
     - createdAt = Date.now()
   - Increment channels.version by 1 inside the same transaction.
   - Return 201 with JSON:
     {
       "item": { "itemId": "<newId>", "index": <index>, "title": "<title>" },
       "serverFingerprint": "<newVersionAsString>"
     }
5) Error handling:
   - If channel does not exist, ensureChannel should create it.
   - If insertion fails due to constraints unexpectedly, return 500 with a simple errorCode.

Add E2E tests in tests/insert.e2e.test.js:
A) Successful insert at start (index 0):
   - Seed channel with items idx 0..4
   - GET list -> obtain serverFingerprint
   - POST insert at 0 with matching clientFingerprint
   - Assert 201, returned item index 0, fingerprint changed
   - Fetch all items and assert ordering + contiguity (0..5), no duplicates, exactly 6 items.
B) Successful insert in middle (e.g., index 2) and at end (index N).
C) Out-of-range insert:
   - index < 0 -> 400
   - index > N -> 400
D) Fingerprint mismatch:
   - Use an intentionally stale fingerprint (e.g., "0" or previous value)
   - Assert 409 and response includes errorCode and current serverFingerprint

Keep changes minimal and consistent with existing response shapes and error envelope conventions.
After implementation, `npm test` must pass.

## 4. You are working in a Node.js (ESM) Express repo with:
- Express 5
- better-sqlite3
- SQLite schema includes:
  - channels(channelId TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 1)
  - playlist_items(itemId TEXT PRIMARY KEY, channelId TEXT NOT NULL, idx INTEGER NOT NULL, title TEXT NOT NULL, createdAt INTEGER NOT NULL)
  - UNIQUE(channelId, idx)
- DB helpers exist (or add if missing):
  - ensureChannel(db, channelId)
  - getChannelVersion(db, channelId)
  - bumpChannelVersion(db, channelId) -> increments version and returns new version
- List endpoint returns serverFingerprint = String(version)
- Insert endpoint exists and uses request body field "clientFingerprint"
- Tests use Vitest + Supertest

Implement required endpoint:
DELETE /api/channels/:channelId/playlist/items/:itemId

Fingerprint transport choice:
- Use request body JSON: { "clientFingerprint": "..." }
- Keep this consistent with POST insert and POST move endpoints.
- Validate that the request has JSON body and clientFingerprint is a non-empty string.

Behavior:
1) Ensure channel exists via ensureChannel(db, channelId).
2) Read currentVersion = getChannelVersion(db, channelId).
3) If clientFingerprint !== String(currentVersion):
   - Return 409 with JSON:
     { "errorCode": "PLAYLIST_FINGERPRINT_MISMATCH", "serverFingerprint": String(currentVersion) }
4) If fingerprint matches, do delete + shift atomically in ONE SQLite transaction:
   a) Look up the item row by (channelId, itemId) to find its current idx:
      SELECT idx FROM playlist_items WHERE channelId=? AND itemId=?;
   b) If not found:
      - Choose and implement a policy: return 404 with { "errorCode": "ITEM_NOT_FOUND" } (recommended)
   c) If found:
      - DELETE FROM playlist_items WHERE channelId=? AND itemId=?;
      - Shift down all items after it:
        UPDATE playlist_items SET idx = idx - 1
        WHERE channelId=? AND idx > deletedIdx;
      - Increment channels.version by 1 within the same transaction and capture the new version.
5) Success response:
   - Return 200 with JSON:
     { "serverFingerprint": "<newVersionAsString>" }

Add E2E tests in tests/delete.e2e.test.js:
A) Delete first item:
   - Seed 5 items (idx 0..4) in channel demo-news.
   - GET list -> capture serverFingerprint and itemId at idx 0.
   - DELETE with body { clientFingerprint }.
   - Assert 200, fingerprint changed.
   - Fetch all items and assert:
     - count is 4
     - indexes contiguous 0..3
     - no duplicates
     - original deleted itemId not present
B) Delete middle and last item similarly.
C) Delete non-existent item:
   - With matching fingerprint, DELETE an itemId that doesn’t exist.
   - Assert 404 with errorCode ITEM_NOT_FOUND.
D) Fingerprint mismatch:
   - Use stale clientFingerprint and assert 409 with errorCode and serverFingerprint.

Keep changes minimal, consistent error envelope format, and ensure `npm test` passes.

## 5. You are working in a Node.js (ESM) Express repo with:
- Express 5
- better-sqlite3
- SQLite schema:
  - channels(channelId TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 1)
  - playlist_items(itemId TEXT PRIMARY KEY, channelId TEXT NOT NULL, idx INTEGER NOT NULL, title TEXT NOT NULL, createdAt INTEGER NOT NULL)
  - UNIQUE(channelId, idx)
- DB helpers exist (or add if missing):
  - ensureChannel(db, channelId)
  - getChannelVersion(db, channelId)
  - bumpChannelVersion(db, channelId) -> increments version and returns new version
- Existing endpoints:
  - GET list returns serverFingerprint = String(version)
  - POST insert uses body clientFingerprint
  - DELETE uses body { clientFingerprint }
- Tests use Vitest + Supertest

Implement required endpoint:
POST /api/channels/:channelId/playlist/items/:itemId/move

Request body JSON:
{ "newIndex": 5, "clientFingerprint": "..." }

Behavior and rules:
1) Validate request:
   - newIndex must be an integer
   - clientFingerprint must be a non-empty string
   - if invalid -> 400 with errorCode INVALID_REQUEST
2) Out-of-range policy (choose and document):
   - If newIndex < 0 -> 400
   - If newIndex >= N (playlist length) -> 400
   (where N = COUNT(*) items for this channel)
   NOTE: moving within existing items means allowed indexes are 0..N-1.
3) Fingerprint check:
   - ensureChannel(db, channelId)
   - currentVersion = getChannelVersion(db, channelId)
   - if clientFingerprint !== String(currentVersion):
       return 409 with:
       { "errorCode": "PLAYLIST_FINGERPRINT_MISMATCH", "serverFingerprint": String(currentVersion) }

4) If match, perform move atomically in ONE sqlite transaction:
   a) Look up the item and its current idx and title:
      SELECT itemId, idx, title FROM playlist_items WHERE channelId=? AND itemId=?;
      If not found -> 404 with { "errorCode": "ITEM_NOT_FOUND" }
   b) Let oldIndex = row.idx.
      If newIndex === oldIndex:
        - no index changes needed (no-op). Decide policy:
          - still bump version and return success (recommended for simplicity), OR
          - do not bump version (also acceptable). Be consistent and test it.
   c) If oldIndex < newIndex (moving forward/down):
      - Shift items in (oldIndex, newIndex] left by 1:
        UPDATE playlist_items
        SET idx = idx - 1
        WHERE channelId=? AND idx > ? AND idx <= ?;
      - Set moved item idx = newIndex:
        UPDATE playlist_items SET idx = ? WHERE channelId=? AND itemId=?;
   d) If oldIndex > newIndex (moving backward/up):
      - Shift items in [newIndex, oldIndex) right by 1:
        UPDATE playlist_items
        SET idx = idx + 1
        WHERE channelId=? AND idx >= ? AND idx < ?;
      - Set moved item idx = newIndex:
        UPDATE playlist_items SET idx = ? WHERE channelId=? AND itemId=?;

   IMPORTANT: Because of UNIQUE(channelId, idx), avoid temporary collisions.
   Use the common safe technique:
     - First set moved item idx to a temporary out-of-range value (e.g., -1) inside the transaction:
       UPDATE playlist_items SET idx = -1 WHERE channelId=? AND itemId=?;
     - Then run the shifting UPDATE.
     - Then set moved item to newIndex.
   This prevents uniqueness conflicts during shifting.

   e) Increment channels.version by 1 inside the same transaction and capture newVersion.

5) Success response:
   - Return 200 with:
     {
       "item": { "itemId": "<itemId>", "index": <newIndex>, "title": "<title>" },
       "serverFingerprint": "<newVersionAsString>"
     }

Add E2E tests in tests/move.e2e.test.js:
A) Move forward (e.g., idx 1 -> 3):
   - Seed 6 items idx 0..5
   - GET list -> get fingerprint and capture itemId/title at idx 1
   - POST move with newIndex=3 and matching fingerprint
   - Assert 200, fingerprint changed, returned item index=3
   - Fetch all items across pages and assert:
     - count unchanged
     - indexes are contiguous 0..5
     - no duplicates
     - moved item appears exactly once at idx 3
B) Move backward (e.g., idx 4 -> 0) with same assertions
C) Move to same index:
   - Decide expected behavior (bump version or not) and assert it consistently
D) Out-of-range move:
   - newIndex < 0 -> 400
   - newIndex >= N -> 400
E) Move non-existent item:
   - 404 ITEM_NOT_FOUND
F) Fingerprint mismatch:
   - stale clientFingerprint -> 409 with errorCode and serverFingerprint

Keep code minimal, consistent error envelope format, and ensure `npm test` passes.

## 6. You are working in a Node.js (ESM) Express repo with:
- Express 5
- better-sqlite3
- Vitest + Supertest
- SQLite schema includes:
  - channels(channelId TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 1)
  - playlist_items(itemId TEXT PRIMARY KEY, channelId TEXT NOT NULL, idx INTEGER NOT NULL, title TEXT NOT NULL, createdAt INTEGER NOT NULL)
- DB helpers exist (or add if missing):
  - ensureChannel(db, channelId)
  - getChannelVersion(db, channelId)
- List endpoint already returns serverFingerprint = String(version)
- Insert/Delete/Move endpoints (or planned) use clientFingerprint and return 409 on mismatch.

Implement endpoint:
POST /api/channels/:channelId/playlist/sync-check

Request body JSON:
{ "clientFingerprint": "..." }

Behavior:
1) Validate request body:
   - clientFingerprint must be a non-empty string
   - else return 400 with { "errorCode": "INVALID_REQUEST" }
2) Ensure channel exists:
   - ensureChannel(db, channelId)
3) Get current server fingerprint:
   - currentVersion = getChannelVersion(db, channelId)
   - serverFingerprint = String(currentVersion)
4) Compare:
   - If clientFingerprint === serverFingerprint:
       return 200 with { "serverFingerprint": serverFingerprint }
   - Else:
       return 409 with
       { "errorCode": "PLAYLIST_FINGERPRINT_MISMATCH", "serverFingerprint": serverFingerprint }

Implementation details:
- Use the same fingerprint scheme as other endpoints: per-channel version stored in DB.
- Ensure the router path matches exactly: /api/channels/:channelId/playlist/sync-check
- Keep error envelope consistent with other endpoints (PLAYLIST_FINGERPRINT_MISMATCH).

Add E2E tests in tests/sync-check.e2e.test.js using Vitest + Supertest:
A) Match case:
   - Seed channel row (ensureChannel) and optionally items
   - GET list to read serverFingerprint (or call getChannelVersion directly in setup if your test harness does)
   - POST sync-check with clientFingerprint equal to serverFingerprint
   - Expect 200 and response.serverFingerprint equals same value
B) Mismatch case:
   - POST sync-check with a different fingerprint (e.g., "0" or old value)
   - Expect 409 and response.errorCode is PLAYLIST_FINGERPRINT_MISMATCH
   - Response includes serverFingerprint (string) equal to current server version
C) Validation:
   - Missing/empty clientFingerprint -> 400 INVALID_REQUEST

Finally, update DESIGN.md section "Fingerprint algorithm" to document:
- Inputs included: channel’s playlist revision version (channels.version).
- How computed: serverFingerprint is String(version); version is incremented atomically in the same DB transaction as any successful insert/delete/move.
- Tradeoffs:
  - Performance: O(1) check, no need to hash all items; great for large playlists.
  - Collision risk: none in the hashing sense; correctness relies on bumping version exactly once per successful mutation inside the transaction.
  - Limitation: fingerprint identifies playlist state revision, not a hash of content; still sufficient to detect stale clients and prevent applying edits against stale order.
Ensure `npm test` passes after changes.
