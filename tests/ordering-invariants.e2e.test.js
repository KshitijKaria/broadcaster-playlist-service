import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { ensureChannel } from "../src/db/db.js";
import { createTestDb } from "./helpers/db.js";
import {
  assertHealthyPlaylist,
  fetchAllItemsViaPaging,
} from "./helpers/playlistTestUtils.js";

function seedItems(db, channelId, count) {
  ensureChannel(db, channelId);
  const insertItem = db.prepare(
    `INSERT INTO playlist_items(itemId, channelId, idx, title, createdAt)
     VALUES (?, ?, ?, ?, ?)`,
  );
  for (let i = 0; i < count; i += 1) {
    insertItem.run(`seed-${i}`, channelId, i, `Seed ${i}`, 1_000 + i);
  }
}

async function fetchFingerprint(app, channelId) {
  const res = await request(app).get(
    `/api/channels/${channelId}/playlist/items?limit=1`,
  );
  expect(res.status).toBe(200);
  expect(typeof res.body.serverFingerprint).toBe("string");
  return res.body.serverFingerprint;
}

describe("Ordering invariants via API", () => {
  let current;

  afterEach(() => {
    if (current) {
      current.close();
      current = undefined;
    }
  });

  it("maintains contiguous ordering through insert/move/delete operations", async () => {
    current = createTestDb();
    const app = createApp({ db: current.db });
    const channelId = "demo-news";

    seedItems(current.db, channelId, 10);
    let fingerprint = await fetchFingerprint(app, channelId);

    let list = await fetchAllItemsViaPaging(app, channelId);
    expect(list.totalCount).toBe(10);
    expect(list.items.length).toBe(10);
    assertHealthyPlaylist(list.items);

    // Insert at start
    const insertRes = await request(app)
      .post(`/api/channels/${channelId}/playlist/items`)
      .send({ title: "Inserted", index: 0, clientFingerprint: fingerprint });
    expect(insertRes.status).toBe(201);
    expect(typeof insertRes.body.serverFingerprint).toBe("string");
    fingerprint = insertRes.body.serverFingerprint;

    list = await fetchAllItemsViaPaging(app, channelId);
    expect(list.totalCount).toBe(11);
    expect(list.items.length).toBe(11);
    assertHealthyPlaylist(list.items);

    // Move forward (index 1 -> 7)
    const moveForwardItem = list.items.find((item) => item.index === 1);
    expect(moveForwardItem).toBeTruthy();

    const moveForwardRes = await request(app)
      .post(
        `/api/channels/${channelId}/playlist/items/${moveForwardItem.itemId}/move`,
      )
      .send({ newIndex: 7, clientFingerprint: fingerprint });
    expect(moveForwardRes.status).toBe(200);
    expect(typeof moveForwardRes.body.serverFingerprint).toBe("string");
    fingerprint = moveForwardRes.body.serverFingerprint;

    list = await fetchAllItemsViaPaging(app, channelId);
    expect(list.totalCount).toBe(11);
    expect(list.items.length).toBe(11);
    assertHealthyPlaylist(list.items);

    // Move backward (index 8 -> 2)
    const moveBackwardItem = list.items.find((item) => item.index === 8);
    expect(moveBackwardItem).toBeTruthy();

    const moveBackwardRes = await request(app)
      .post(
        `/api/channels/${channelId}/playlist/items/${moveBackwardItem.itemId}/move`,
      )
      .send({ newIndex: 2, clientFingerprint: fingerprint });
    expect(moveBackwardRes.status).toBe(200);
    expect(typeof moveBackwardRes.body.serverFingerprint).toBe("string");
    fingerprint = moveBackwardRes.body.serverFingerprint;

    list = await fetchAllItemsViaPaging(app, channelId);
    expect(list.totalCount).toBe(11);
    expect(list.items.length).toBe(11);
    assertHealthyPlaylist(list.items);

    // Delete first
    const firstItemId = list.items[0].itemId;
    const delFirst = await request(app)
      .delete(`/api/channels/${channelId}/playlist/items/${firstItemId}`)
      .send({ clientFingerprint: fingerprint });
    expect(delFirst.status).toBe(200);
    expect(typeof delFirst.body.serverFingerprint).toBe("string");
    fingerprint = delFirst.body.serverFingerprint;

    list = await fetchAllItemsViaPaging(app, channelId);
    expect(list.totalCount).toBe(10);
    expect(list.items.length).toBe(10);
    assertHealthyPlaylist(list.items);

    // Delete middle
    const middleItemId = list.items[Math.floor(list.items.length / 2)].itemId;
    const delMiddle = await request(app)
      .delete(`/api/channels/${channelId}/playlist/items/${middleItemId}`)
      .send({ clientFingerprint: fingerprint });
    expect(delMiddle.status).toBe(200);
    expect(typeof delMiddle.body.serverFingerprint).toBe("string");
    fingerprint = delMiddle.body.serverFingerprint;

    list = await fetchAllItemsViaPaging(app, channelId);
    expect(list.totalCount).toBe(9);
    expect(list.items.length).toBe(9);
    assertHealthyPlaylist(list.items);

    // Delete last
    const lastItemId = list.items[list.items.length - 1].itemId;
    const delLast = await request(app)
      .delete(`/api/channels/${channelId}/playlist/items/${lastItemId}`)
      .send({ clientFingerprint: fingerprint });
    expect(delLast.status).toBe(200);
    expect(typeof delLast.body.serverFingerprint).toBe("string");
    fingerprint = delLast.body.serverFingerprint;

    list = await fetchAllItemsViaPaging(app, channelId);
    expect(list.totalCount).toBe(8);
    expect(list.items.length).toBe(8);
    assertHealthyPlaylist(list.items);
  });
});