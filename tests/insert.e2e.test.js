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

async function fetchFingerprint(app, channelId) {
  const res = await request(app)
    .get(`/api/channels/${channelId}/playlist/items?limit=200`);
  return res.body.serverFingerprint;
}

describe("POST /api/channels/:channelId/playlist/items", () => {
  let current;

  afterEach(() => {
    if (current) {
      current.close();
      current = undefined;
    }
  });

  it("inserts at start and shifts existing items", async () => {
    current = createTestDb();
    const app = createApp({ db: current.db });
    const channelId = "demo-news";

    seedItems(current.db, channelId, 5);
    const fingerprint = await fetchFingerprint(app, channelId);

    const res = await request(app)
      .post(`/api/channels/${channelId}/playlist/items`)
      .send({ title: "Breaking News", index: 0, clientFingerprint: fingerprint });

    expect(res.status).toBe(201);
    expect(res.body.item.index).toBe(0);
    expect(res.body.serverFingerprint).not.toBe(fingerprint);

    const listRes = await request(app)
      .get(`/api/channels/${channelId}/playlist/items?limit=200`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.totalCount).toBe(6);

    const items = listRes.body.items;
    const ids = new Set(items.map((item) => item.itemId));
    const indices = items.map((item) => item.index);
    expect(ids.size).toBe(6);
    expect(indices).toEqual([0, 1, 2, 3, 4, 5]);
    expect(items[0].itemId).toBe(res.body.item.itemId);
  });

  it("inserts in the middle", async () => {
    current = createTestDb();
    const app = createApp({ db: current.db });
    const channelId = "demo-news";

    seedItems(current.db, channelId, 5);
    const fingerprint = await fetchFingerprint(app, channelId);

    const res = await request(app)
      .post(`/api/channels/${channelId}/playlist/items`)
      .send({ title: "Mid Item", index: 2, clientFingerprint: fingerprint });

    expect(res.status).toBe(201);
    expect(res.body.item.index).toBe(2);

    const listRes = await request(app)
      .get(`/api/channels/${channelId}/playlist/items?limit=200`);
    expect(listRes.body.totalCount).toBe(6);
    expect(listRes.body.items.map((item) => item.index))
      .toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("inserts at the end", async () => {
    current = createTestDb();
    const app = createApp({ db: current.db });
    const channelId = "demo-news";

    seedItems(current.db, channelId, 5);
    const fingerprint = await fetchFingerprint(app, channelId);

    const res = await request(app)
      .post(`/api/channels/${channelId}/playlist/items`)
      .send({ title: "Last Item", index: 5, clientFingerprint: fingerprint });

    expect(res.status).toBe(201);
    expect(res.body.item.index).toBe(5);

    const listRes = await request(app)
      .get(`/api/channels/${channelId}/playlist/items?limit=200`);
    const items = listRes.body.items;
    expect(items[items.length - 1].itemId).toBe(res.body.item.itemId);
  });

  it("rejects out-of-range indices", async () => {
    current = createTestDb();
    const app = createApp({ db: current.db });
    const channelId = "demo-news";

    seedItems(current.db, channelId, 3);
    const fingerprint = await fetchFingerprint(app, channelId);

    const resLow = await request(app)
      .post(`/api/channels/${channelId}/playlist/items`)
      .send({ title: "Bad", index: -1, clientFingerprint: fingerprint });
    expect(resLow.status).toBe(400);
    expect(resLow.body.errorCode).toBe("INVALID_REQUEST");

    const resHigh = await request(app)
      .post(`/api/channels/${channelId}/playlist/items`)
      .send({ title: "Bad", index: 4, clientFingerprint: fingerprint });
    expect(resHigh.status).toBe(400);
    expect(resHigh.body.errorCode).toBe("INVALID_REQUEST");
  });

  it("rejects fingerprint mismatch", async () => {
    current = createTestDb();
    const app = createApp({ db: current.db });
    const channelId = "demo-news";

    seedItems(current.db, channelId, 2);

    const res = await request(app)
      .post(`/api/channels/${channelId}/playlist/items`)
      .send({ title: "Bad FP", index: 1, clientFingerprint: "0" });
    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe("PLAYLIST_FINGERPRINT_MISMATCH");
    expect(typeof res.body.serverFingerprint).toBe("string");
  });
});
