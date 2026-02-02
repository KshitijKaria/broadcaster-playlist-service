import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { ensureChannel } from "../src/db/db.js";
import { createTestDb } from "./helpers/db.js";
import { assertHealthyPlaylist, fetchAllItemsViaPaging } from "./helpers/playlistTestUtils.js";

function seedItems(db, channelId, count) {
  ensureChannel(db, channelId);
  const insertItem = db.prepare(
    `INSERT INTO playlist_items(itemId, channelId, idx, title, createdAt)
     VALUES (?, ?, ?, ?, ?)`,
  );
  for (let i = 0; i < count; i += 1) {
    insertItem.run(`item-${i}`, channelId, i, `Title ${i}`, 1000 + i);
  }
}

async function fetchList(app, channelId) {
  return request(app)
    .get(`/api/channels/${channelId}/playlist/items?limit=200`);
}

describe("POST /api/channels/:channelId/playlist/items/:itemId/move", () => {
  let current;

  afterEach(() => {
    if (current) {
      current.close();
      current = undefined;
    }
  });

  it("moves an item forward", async () => {
    current = createTestDb();
    const app = createApp({ db: current.db });
    const channelId = "demo-news";

    seedItems(current.db, channelId, 6);
    const listRes = await fetchList(app, channelId);
    const fingerprint = listRes.body.serverFingerprint;
    const movedItem = listRes.body.items[1];

    const moveRes = await request(app)
      .post(`/api/channels/${channelId}/playlist/items/${movedItem.itemId}/move`)
      .send({ newIndex: 3, clientFingerprint: fingerprint });

    expect(moveRes.status).toBe(200);
    expect(moveRes.body.serverFingerprint).not.toBe(fingerprint);
    expect(moveRes.body.item.index).toBe(3);

    const after = await fetchList(app, channelId);
    expect(after.body.totalCount).toBe(6);
    expect(after.body.items.map((item) => item.itemId)).toEqual([
      "item-0",
      "item-2",
      "item-3",
      "item-1",
      "item-4",
      "item-5",
    ]);
    expect(after.body.items.map((item) => item.index))
      .toEqual([0, 1, 2, 3, 4, 5]);
    assertHealthyPlaylist(after.body.items);
  });

  it("moves an item backward", async () => {
    current = createTestDb();
    const app = createApp({ db: current.db });
    const channelId = "demo-news";

    seedItems(current.db, channelId, 6);
    const listRes = await fetchList(app, channelId);
    const fingerprint = listRes.body.serverFingerprint;
    const movedItem = listRes.body.items[4];

    const moveRes = await request(app)
      .post(`/api/channels/${channelId}/playlist/items/${movedItem.itemId}/move`)
      .send({ newIndex: 0, clientFingerprint: fingerprint });

    expect(moveRes.status).toBe(200);
    expect(moveRes.body.item.index).toBe(0);

    const after = await fetchList(app, channelId);
    expect(after.body.items.map((item) => item.itemId)).toEqual([
      "item-4",
      "item-0",
      "item-1",
      "item-2",
      "item-3",
      "item-5",
    ]);
    expect(after.body.items.map((item) => item.index))
      .toEqual([0, 1, 2, 3, 4, 5]);
    assertHealthyPlaylist(after.body.items);
  });

  it("moves to the same index and still bumps version", async () => {
    current = createTestDb();
    const app = createApp({ db: current.db });
    const channelId = "demo-news";

    seedItems(current.db, channelId, 3);
    const listRes = await fetchList(app, channelId);
    const fingerprint = listRes.body.serverFingerprint;
    const movedItem = listRes.body.items[1];

    const moveRes = await request(app)
      .post(`/api/channels/${channelId}/playlist/items/${movedItem.itemId}/move`)
      .send({ newIndex: 1, clientFingerprint: fingerprint });

    expect(moveRes.status).toBe(200);
    expect(moveRes.body.serverFingerprint).not.toBe(fingerprint);

    const after = await fetchList(app, channelId);
    assertHealthyPlaylist(after.body.items);
  });

  it("rejects out-of-range indices", async () => {
    current = createTestDb();
    const app = createApp({ db: current.db });
    const channelId = "demo-news";

    seedItems(current.db, channelId, 2);
    const listRes = await fetchList(app, channelId);
    const fingerprint = listRes.body.serverFingerprint;
    const itemId = listRes.body.items[0].itemId;

    const resLow = await request(app)
      .post(`/api/channels/${channelId}/playlist/items/${itemId}/move`)
      .send({ newIndex: -1, clientFingerprint: fingerprint });
    expect(resLow.status).toBe(400);
    expect(["INVALID_REQUEST", "INVALID_INDEX", "MISSING_FINGERPRINT"])
      .toContain(resLow.body.errorCode);

    let after = await fetchList(app, channelId);
    expect(after.body.totalCount).toBe(2);
    expect(after.body.items.map((item) => item.itemId)).toEqual(["item-0", "item-1"]);
    assertHealthyPlaylist(after.body.items);
    expect(after.body.serverFingerprint).toBe(fingerprint);

    const resHigh = await request(app)
      .post(`/api/channels/${channelId}/playlist/items/${itemId}/move`)
      .send({ newIndex: 2, clientFingerprint: fingerprint });
    expect(resHigh.status).toBe(400);
    expect(["INVALID_REQUEST", "INVALID_INDEX", "MISSING_FINGERPRINT"])
      .toContain(resHigh.body.errorCode);

    after = await fetchList(app, channelId);
    expect(after.body.totalCount).toBe(2);
    expect(after.body.items.map((item) => item.itemId)).toEqual(["item-0", "item-1"]);
    assertHealthyPlaylist(after.body.items);
    expect(after.body.serverFingerprint).toBe(fingerprint);
  });

  it("returns 404 for missing item", async () => {
    current = createTestDb();
    const app = createApp({ db: current.db });
    const channelId = "demo-news";

    seedItems(current.db, channelId, 2);
    const listRes = await fetchList(app, channelId);
    const fingerprint = listRes.body.serverFingerprint;

    const res = await request(app)
      .post(`/api/channels/${channelId}/playlist/items/missing-item/move`)
      .send({ newIndex: 1, clientFingerprint: fingerprint });

    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe("ITEM_NOT_FOUND");

    const after = await fetchList(app, channelId);
    expect(after.body.totalCount).toBe(2);
    assertHealthyPlaylist(after.body.items);
    expect(after.body.serverFingerprint).toBe(fingerprint);
  });

  it("returns 409 for fingerprint mismatch", async () => {
    current = createTestDb();
    const app = createApp({ db: current.db });
    const channelId = "demo-news";

    seedItems(current.db, channelId, 2);
    const listRes = await fetchList(app, channelId);
    const itemId = listRes.body.items[0].itemId;

    const res = await request(app)
      .post(`/api/channels/${channelId}/playlist/items/${itemId}/move`)
      .send({ newIndex: 1, clientFingerprint: "0" });

    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe("PLAYLIST_FINGERPRINT_MISMATCH");
    expect(typeof res.body.serverFingerprint).toBe("string");

    const after = await fetchList(app, channelId);
    expect(after.body.totalCount).toBe(2);
    assertHealthyPlaylist(after.body.items);
  });

  it("rejects invalid request bodies and keeps playlist unchanged", async () => {
    current = createTestDb();
    const app = createApp({ db: current.db });
    const channelId = "demo-news";

    seedItems(current.db, channelId, 2);
    const listRes = await fetchList(app, channelId);
    const fingerprint = listRes.body.serverFingerprint;
    const itemId = listRes.body.items[0].itemId;

    const cases = [
      { body: { clientFingerprint: fingerprint }, label: "missing newIndex" },
      { body: { newIndex: 2.5, clientFingerprint: fingerprint }, label: "float" },
      { body: { newIndex: "2", clientFingerprint: fingerprint }, label: "string" },
      { body: { newIndex: null, clientFingerprint: fingerprint }, label: "null" },
      { body: { newIndex: 1 }, label: "missing fingerprint" },
    ];

    for (const testCase of cases) {
      const res = await request(app)
        .post(`/api/channels/${channelId}/playlist/items/${itemId}/move`)
        .send(testCase.body);
      expect(res.status).toBe(400);
      expect(["INVALID_REQUEST", "INVALID_INDEX", "MISSING_FINGERPRINT"])
        .toContain(res.body.errorCode);

      const after = await fetchList(app, channelId);
      expect(after.body.totalCount).toBe(2);
      expect(after.body.items.map((item) => item.itemId)).toEqual(["item-0", "item-1"]);
      assertHealthyPlaylist(after.body.items);
      expect(after.body.serverFingerprint).toBe(fingerprint);
    }
  });

  it("verifies move with pagination-backed list", async () => {
    current = createTestDb();
    const app = createApp({ db: current.db });
    const channelId = "demo-news";

    seedItems(current.db, channelId, 120);
    const listRes = await fetchList(app, channelId);
    const fingerprint = listRes.body.serverFingerprint;
    const target = listRes.body.items[60].itemId;

    const moveRes = await request(app)
      .post(`/api/channels/${channelId}/playlist/items/${target}/move`)
      .send({ newIndex: 10, clientFingerprint: fingerprint });
    expect(moveRes.status).toBe(200);

    const list = await fetchAllItemsViaPaging(app, channelId, 50);
    expect(list.totalCount).toBe(120);
    expect(list.items.length).toBe(120);
    assertHealthyPlaylist(list.items);
    expect(list.items[10].itemId).toBe(target);
    expect(new Set(list.items.map((item) => item.itemId)).size).toBe(120);
  });
});
