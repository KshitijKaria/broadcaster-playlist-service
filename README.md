Broadcaster Playlist Service

Quickstart
- Install deps: `npm ci`
- Run tests: `npm test`
- Start server: `npm start`

Base URL
- http://localhost:3000
- Override port with `PORT=4000 npm start`

SQLite persistence
- Default DB file: `./data/playlist.db`
- Reset local data: stop the server and delete `./data/playlist.db`

API overview
- `GET /health` -> `{ "status": "ok" }`
- `GET /api/channels/:channelId/playlist/items?limit=&cursor=` -> paginated items + `totalCount` + `serverFingerprint`
- `POST /api/channels/:channelId/playlist/items` -> insert at index (requires `clientFingerprint`)
- `DELETE /api/channels/:channelId/playlist/items/:itemId` -> delete item (requires `clientFingerprint` in JSON body)
- `POST /api/channels/:channelId/playlist/items/:itemId/move` -> move item (requires `clientFingerprint`)
- `POST /api/channels/:channelId/playlist/sync-check` -> fingerprint match/mismatch

Notes on CORS
- CORS is enabled globally for `http://localhost:5173`, `http://localhost:3000`, and `https://broadcaster-playlist-service.lovable.app`.
- Allowed methods: GET, POST, DELETE, OPTIONS.
- Allowed headers: Content-Type.

Notes on pagination
- `limit` defaults to 50 (min 1, max 200).
- `cursor` is the last returned index; the next page returns items with `index > cursor`.

curl examples

List first page (limit 50)
```sh
curl "http://localhost:3000/api/channels/demo-news/playlist/items?limit=50"
```

List next page using cursor (example cursor 49)
```sh
curl "http://localhost:3000/api/channels/demo-news/playlist/items?limit=50&cursor=49"
```

Insert at index 0 (use `serverFingerprint` from list)
```sh
curl -X POST "http://localhost:3000/api/channels/demo-news/playlist/items" \
  -H "Content-Type: application/json" \
  -d '{"title":"Breaking News","index":0,"clientFingerprint":"1"}'
```

Move an item
```sh
curl -X POST "http://localhost:3000/api/channels/demo-news/playlist/items/ITEM_ID/move" \
  -H "Content-Type: application/json" \
  -d '{"newIndex":5,"clientFingerprint":"2"}'
```

Delete an item (clientFingerprint in JSON body)
```sh
curl -X DELETE "http://localhost:3000/api/channels/demo-news/playlist/items/ITEM_ID" \
  -H "Content-Type: application/json" \
  -d '{"clientFingerprint":"3"}'
```

Sync-check
```sh
curl -X POST "http://localhost:3000/api/channels/demo-news/playlist/sync-check" \
  -H "Content-Type: application/json" \
  -d '{"clientFingerprint":"3"}'
```
