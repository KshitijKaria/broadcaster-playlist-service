import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { ensureChannel } from "../src/db/db.js";
import { createTestDb } from "./helpers/db.js";

function seedItems(db, channelId, count) {
  ensureChannel(db, channelId);
  const insertItem = db.prepare(
    `INSERT INTO playlist_items(itemId, channelId, idx, title, createdAt)
     VALUES (?, ?, ?, ?, ?)`,
  );
  for (let i = 0; i < count; i += 1) {
    insertItem.run(`item-${i}`, channelId, i, `Title ${i}`, Date.now());
  }
}

async function fetchList(app, channelId) {
  return request(app)
    .get(`/api/channels/${channelId}/playlist/items?limit=200`);
}

describe("DELETE /api/channels/:channelId/playlist/items/:itemId", () => {
  let current;

  afterEach(() => {
    if (current) {
      current.close();
      current = undefined;
    }
  });

  it("deletes the first item and shifts indices", async () => {
    current = createTestDb();
    const app = createApp({ db: current.db });
    const channelId = "demo-news";

    seedItems(current.db, channelId, 5);
    const listRes = await fetchList(app, channelId);
    const fingerprint = listRes.body.serverFingerprint;
    const firstItemId = listRes.body.items[0].itemId;

    const delRes = await request(app)
      .delete(`/api/channels/${channelId}/playlist/items/${firstItemId}`)
      .send({ clientFingerprint: fingerprint });

    expect(delRes.status).toBe(200);
    expect(delRes.body.serverFingerprint).not.toBe(fingerprint);

    const after = await fetchList(app, channelId);
    const items = after.body.items;
    expect(after.body.totalCount).toBe(4);
    expect(items.map((item) => item.index)).toEqual([0, 1, 2, 3]);
    expect(new Set(items.map((item) => item.itemId)).size).toBe(4);
    expect(items.find((item) => item.itemId === firstItemId)).toBeUndefined();
  });

  it("deletes a middle item", async () => {
    current = createTestDb();
    const app = createApp({ db: current.db });
    const channelId = "demo-news";

    seedItems(current.db, channelId, 5);
    const listRes = await fetchList(app, channelId);
    const fingerprint = listRes.body.serverFingerprint;
    const middleItemId = listRes.body.items[2].itemId;

    const delRes = await request(app)
      .delete(`/api/channels/${channelId}/playlist/items/${middleItemId}`)
      .send({ clientFingerprint: fingerprint });

    expect(delRes.status).toBe(200);

    const after = await fetchList(app, channelId);
    expect(after.body.totalCount).toBe(4);
    expect(after.body.items.map((item) => item.index)).toEqual([0, 1, 2, 3]);
    expect(after.body.items.find((item) => item.itemId === middleItemId))
      .toBeUndefined();
  });

  it("deletes the last item", async () => {
    current = createTestDb();
    const app = createApp({ db: current.db });
    const channelId = "demo-news";

    seedItems(current.db, channelId, 5);
    const listRes = await fetchList(app, channelId);
    const fingerprint = listRes.body.serverFingerprint;
    const lastItemId = listRes.body.items[4].itemId;

    const delRes = await request(app)
      .delete(`/api/channels/${channelId}/playlist/items/${lastItemId}`)
      .send({ clientFingerprint: fingerprint });

    expect(delRes.status).toBe(200);

    const after = await fetchList(app, channelId);
    expect(after.body.totalCount).toBe(4);
    expect(after.body.items[after.body.items.length - 1].itemId)
      .not.toBe(lastItemId);
  });

  it("returns 404 for missing item", async () => {
    current = createTestDb();
    const app = createApp({ db: current.db });
    const channelId = "demo-news";

    seedItems(current.db, channelId, 2);
    const listRes = await fetchList(app, channelId);
    const fingerprint = listRes.body.serverFingerprint;

    const delRes = await request(app)
      .delete(`/api/channels/${channelId}/playlist/items/missing-item`)
      .send({ clientFingerprint: fingerprint });

    expect(delRes.status).toBe(404);
    expect(delRes.body.errorCode).toBe("ITEM_NOT_FOUND");
  });

  it("returns 409 for fingerprint mismatch", async () => {
    current = createTestDb();
    const app = createApp({ db: current.db });
    const channelId = "demo-news";

    seedItems(current.db, channelId, 2);
    const listRes = await fetchList(app, channelId);
    const itemId = listRes.body.items[0].itemId;

    const delRes = await request(app)
      .delete(`/api/channels/${channelId}/playlist/items/${itemId}`)
      .send({ clientFingerprint: "0" });

    expect(delRes.status).toBe(409);
    expect(delRes.body.errorCode).toBe("PLAYLIST_FINGERPRINT_MISMATCH");
    expect(typeof delRes.body.serverFingerprint).toBe("string");
  });
});
