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
    const beforeInsert = fingerprint;
    const insertRes = await request(app)
      .post(`/api/channels/${channelId}/playlist/items`)
      .send({ title: "Inserted", index: 0, clientFingerprint: fingerprint });
    expect(insertRes.status).toBe(201);
    expect(typeof insertRes.body.serverFingerprint).toBe("string");
    expect(insertRes.body.serverFingerprint).not.toBe(beforeInsert);
    fingerprint = insertRes.body.serverFingerprint;

    list = await fetchAllItemsViaPaging(app, channelId);
    expect(list.totalCount).toBe(11);
    expect(list.items.length).toBe(11);
    assertHealthyPlaylist(list.items);

    // Boundary move: move last item to index 0
    const lastItem = list.items[list.items.length - 1];
    const beforeBoundary = fingerprint;
    const boundaryRes = await request(app)
      .post(
        `/api/channels/${channelId}/playlist/items/${lastItem.itemId}/move`,
      )
      .send({ newIndex: 0, clientFingerprint: fingerprint });
    expect(boundaryRes.status).toBe(200);
    expect(typeof boundaryRes.body.serverFingerprint).toBe("string");
    expect(boundaryRes.body.serverFingerprint).not.toBe(beforeBoundary);
    fingerprint = boundaryRes.body.serverFingerprint;

    list = await fetchAllItemsViaPaging(app, channelId);
    expect(list.totalCount).toBe(11);
    expect(list.items.length).toBe(11);
    assertHealthyPlaylist(list.items);
    expect(list.items[0].itemId).toBe(lastItem.itemId);

    // Move forward (index 1 -> 7)
    const moveForwardItem = list.items.find((item) => item.index === 1);
    expect(moveForwardItem).toBeTruthy();

    const beforeMoveForward = fingerprint;
    const moveForwardRes = await request(app)
      .post(
        `/api/channels/${channelId}/playlist/items/${moveForwardItem.itemId}/move`,
      )
      .send({ newIndex: 7, clientFingerprint: fingerprint });
    expect(moveForwardRes.status).toBe(200);
    expect(typeof moveForwardRes.body.serverFingerprint).toBe("string");
    expect(moveForwardRes.body.serverFingerprint).not.toBe(beforeMoveForward);
    fingerprint = moveForwardRes.body.serverFingerprint;

    list = await fetchAllItemsViaPaging(app, channelId);
    expect(list.totalCount).toBe(11);
    expect(list.items.length).toBe(11);
    assertHealthyPlaylist(list.items);

    // Move backward (index 8 -> 2)
    const moveBackwardItem = list.items.find((item) => item.index === 8);
    expect(moveBackwardItem).toBeTruthy();

    const beforeMoveBackward = fingerprint;
    const moveBackwardRes = await request(app)
      .post(
        `/api/channels/${channelId}/playlist/items/${moveBackwardItem.itemId}/move`,
      )
      .send({ newIndex: 2, clientFingerprint: fingerprint });
    expect(moveBackwardRes.status).toBe(200);
    expect(typeof moveBackwardRes.body.serverFingerprint).toBe("string");
    expect(moveBackwardRes.body.serverFingerprint).not.toBe(beforeMoveBackward);
    fingerprint = moveBackwardRes.body.serverFingerprint;

    list = await fetchAllItemsViaPaging(app, channelId);
    expect(list.totalCount).toBe(11);
    expect(list.items.length).toBe(11);
    assertHealthyPlaylist(list.items);

    // Delete first
    const firstItemId = list.items[0].itemId;
    const beforeDelFirst = fingerprint;
    const delFirst = await request(app)
      .delete(`/api/channels/${channelId}/playlist/items/${firstItemId}`)
      .send({ clientFingerprint: fingerprint });
    expect(delFirst.status).toBe(200);
    expect(typeof delFirst.body.serverFingerprint).toBe("string");
    expect(delFirst.body.serverFingerprint).not.toBe(beforeDelFirst);
    fingerprint = delFirst.body.serverFingerprint;

    list = await fetchAllItemsViaPaging(app, channelId);
    expect(list.totalCount).toBe(10);
    expect(list.items.length).toBe(10);
    assertHealthyPlaylist(list.items);

    // Delete middle
    const middleItemId = list.items[Math.floor(list.items.length / 2)].itemId;
    const beforeDelMiddle = fingerprint;
    const delMiddle = await request(app)
      .delete(`/api/channels/${channelId}/playlist/items/${middleItemId}`)
      .send({ clientFingerprint: fingerprint });
    expect(delMiddle.status).toBe(200);
    expect(typeof delMiddle.body.serverFingerprint).toBe("string");
    expect(delMiddle.body.serverFingerprint).not.toBe(beforeDelMiddle);
    fingerprint = delMiddle.body.serverFingerprint;

    list = await fetchAllItemsViaPaging(app, channelId);
    expect(list.totalCount).toBe(9);
    expect(list.items.length).toBe(9);
    assertHealthyPlaylist(list.items);

    // Delete last
    const lastItemId = list.items[list.items.length - 1].itemId;
    const beforeDelLast = fingerprint;
    const delLast = await request(app)
      .delete(`/api/channels/${channelId}/playlist/items/${lastItemId}`)
      .send({ clientFingerprint: fingerprint });
    expect(delLast.status).toBe(200);
    expect(typeof delLast.body.serverFingerprint).toBe("string");
    expect(delLast.body.serverFingerprint).not.toBe(beforeDelLast);
    fingerprint = delLast.body.serverFingerprint;

    list = await fetchAllItemsViaPaging(app, channelId);
    expect(list.totalCount).toBe(8);
    expect(list.items.length).toBe(8);
    assertHealthyPlaylist(list.items);
  });

  it("rejects stale fingerprint and keeps playlist unchanged", async () => {
    current = createTestDb();
    const app = createApp({ db: current.db });
    const channelId = "demo-news";

    seedItems(current.db, channelId, 10);
    const fp1 = await fetchFingerprint(app, channelId);

    const insertRes = await request(app)
      .post(`/api/channels/${channelId}/playlist/items`)
      .send({ title: "Inserted", index: 0, clientFingerprint: fp1 });
    expect(insertRes.status).toBe(201);
    const fp2 = insertRes.body.serverFingerprint;
    expect(fp2).not.toBe(fp1);

    const before = await fetchAllItemsViaPaging(app, channelId);
    const totalBefore = before.totalCount;

    const staleMove = await request(app)
      .post(`/api/channels/${channelId}/playlist/items/${before.items[0].itemId}/move`)
      .send({ newIndex: 3, clientFingerprint: fp1 });
    expect(staleMove.status).toBe(409);
    expect(staleMove.body.errorCode).toBe("PLAYLIST_FINGERPRINT_MISMATCH");
    expect(staleMove.body.serverFingerprint).toBe(fp2);

    const after = await fetchAllItemsViaPaging(app, channelId);
    expect(after.totalCount).toBe(totalBefore);
    assertHealthyPlaylist(after.items);
  });

  it("handles pagination stress with mutations", async () => {
    current = createTestDb();
    const app = createApp({ db: current.db });
    const channelId = "demo-news";

    seedItems(current.db, channelId, 220);
    let fp = await fetchFingerprint(app, channelId);

    const ins = await request(app)
      .post(`/api/channels/${channelId}/playlist/items`)
      .send({ title: "Inserted", index: 100, clientFingerprint: fp });
    expect(ins.status).toBe(201);
    fp = ins.body.serverFingerprint;
    const insertedId = ins.body.item.itemId;

    const moveRes = await request(app)
      .post(`/api/channels/${channelId}/playlist/items/${ins.body.item.itemId}/move`)
      .send({ newIndex: 10, clientFingerprint: fp });
    expect(moveRes.status).toBe(200);
    fp = moveRes.body.serverFingerprint;

    const page = await request(app)
      .get(`/api/channels/${channelId}/playlist/items?limit=50&cursor=10`);
    expect(page.status).toBe(200);
    const deleteCandidate = page.body.items.find(
      (item) => item.itemId !== insertedId,
    );
    expect(deleteCandidate).toBeTruthy();

    const delRes = await request(app)
      .delete(`/api/channels/${channelId}/playlist/items/${deleteCandidate.itemId}`)
      .send({ clientFingerprint: fp });
    expect(delRes.status).toBe(200);
    fp = delRes.body.serverFingerprint;

    const list = await fetchAllItemsViaPaging(app, channelId, 50);
    expect(list.totalCount).toBe(220);
    expect(list.items.length).toBe(220);
    assertHealthyPlaylist(list.items);
    expect(new Set(list.items.map((item) => item.itemId)).size).toBe(220);
    expect(list.items.find((item) => item.itemId === deleteCandidate.itemId))
      .toBeUndefined();
    expect(list.items[10].itemId).toBe(insertedId);
  });
});
