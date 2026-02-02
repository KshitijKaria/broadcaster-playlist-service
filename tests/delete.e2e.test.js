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
    assertHealthyPlaylist(items);
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
    const items = after.body.items;
    expect(items.map((item) => item.index)).toEqual([0, 1, 2, 3]);
    expect(items.map((item) => item.itemId)).toEqual([
      "item-0",
      "item-1",
      "item-3",
      "item-4",
    ]);
    expect(items.find((item) => item.itemId === middleItemId))
      .toBeUndefined();
    assertHealthyPlaylist(items);
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
    assertHealthyPlaylist(after.body.items);
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

    const delRes = await request(app)
      .delete(`/api/channels/${channelId}/playlist/items/${itemId}`)
      .send({ clientFingerprint: "0" });

    expect(delRes.status).toBe(409);
    expect(delRes.body.errorCode).toBe("PLAYLIST_FINGERPRINT_MISMATCH");
    expect(typeof delRes.body.serverFingerprint).toBe("string");

    const after = await fetchList(app, channelId);
    expect(after.body.totalCount).toBe(2);
    expect(after.body.items.find((item) => item.itemId === itemId))
      .toBeDefined();
    assertHealthyPlaylist(after.body.items);
  });

  it("rejects missing clientFingerprint and keeps playlist unchanged", async () => {
    current = createTestDb();
    const app = createApp({ db: current.db });
    const channelId = "demo-news";

    seedItems(current.db, channelId, 2);
    const listRes = await fetchList(app, channelId);
    const fingerprint = listRes.body.serverFingerprint;
    const itemId = listRes.body.items[0].itemId;

    const res = await request(app)
      .delete(`/api/channels/${channelId}/playlist/items/${itemId}`)
      .send({});
    expect(res.status).toBe(400);
    expect(["INVALID_REQUEST", "MISSING_FINGERPRINT", "INVALID_INDEX"])
      .toContain(res.body.errorCode);

    const after = await fetchList(app, channelId);
    expect(after.body.totalCount).toBe(2);
    expect(after.body.serverFingerprint).toBe(fingerprint);
    assertHealthyPlaylist(after.body.items);
  });

  it("supports delete with pagination-backed verification", async () => {
    current = createTestDb();
    const app = createApp({ db: current.db });
    const channelId = "demo-news";

    seedItems(current.db, channelId, 120);
    const listRes = await fetchList(app, channelId);
    const fingerprint = listRes.body.serverFingerprint;
    const target = listRes.body.items[60].itemId;

    const delRes = await request(app)
      .delete(`/api/channels/${channelId}/playlist/items/${target}`)
      .send({ clientFingerprint: fingerprint });
    expect(delRes.status).toBe(200);

    const list = await fetchAllItemsViaPaging(app, channelId, 50);
    expect(list.totalCount).toBe(119);
    expect(list.items.length).toBe(119);
    assertHealthyPlaylist(list.items);
    expect(new Set(list.items.map((item) => item.itemId)).size).toBe(119);
  });

  it("returns 404 when deleting the same item twice", async () => {
    current = createTestDb();
    const app = createApp({ db: current.db });
    const channelId = "demo-news";

    seedItems(current.db, channelId, 3);
    const listRes = await fetchList(app, channelId);
    const fingerprint = listRes.body.serverFingerprint;
    const itemId = listRes.body.items[1].itemId;

    const first = await request(app)
      .delete(`/api/channels/${channelId}/playlist/items/${itemId}`)
      .send({ clientFingerprint: fingerprint });
    expect(first.status).toBe(200);

    const second = await request(app)
      .delete(`/api/channels/${channelId}/playlist/items/${itemId}`)
      .send({ clientFingerprint: first.body.serverFingerprint });
    expect(second.status).toBe(404);
    expect(second.body.errorCode).toBe("ITEM_NOT_FOUND");

    const after = await fetchList(app, channelId);
    assertHealthyPlaylist(after.body.items);
  });
});
