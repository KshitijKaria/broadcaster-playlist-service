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
    expect(after.body.items.map((item) => item.index))
      .toEqual([0, 1, 2, 3, 4, 5]);
    const moved = after.body.items.find((item) => item.itemId === movedItem.itemId);
    expect(moved.index).toBe(3);
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
    expect(after.body.items.map((item) => item.index))
      .toEqual([0, 1, 2, 3, 4, 5]);
    expect(after.body.items[0].itemId).toBe(movedItem.itemId);
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
    expect(resLow.body.errorCode).toBe("INVALID_REQUEST");

    const resHigh = await request(app)
      .post(`/api/channels/${channelId}/playlist/items/${itemId}/move`)
      .send({ newIndex: 2, clientFingerprint: fingerprint });
    expect(resHigh.status).toBe(400);
    expect(resHigh.body.errorCode).toBe("INVALID_REQUEST");
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
  });
});
