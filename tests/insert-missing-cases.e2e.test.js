import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { ensureChannel } from "../src/db/db.js";
import { createTestDb } from "./helpers/db.js";
import { assertHealthyPlaylist, fetchAllItemsViaPaging, listPage } from "./helpers/playlistTestUtils.js";

const SEED = [
  { itemId: "item-0", idx: 0, title: "Title 0", createdAt: 1000 },
  { itemId: "item-1", idx: 1, title: "Title 1", createdAt: 1001 },
  { itemId: "item-2", idx: 2, title: "Title 2", createdAt: 1002 },
  { itemId: "item-3", idx: 3, title: "Title 3", createdAt: 1003 },
  { itemId: "item-4", idx: 4, title: "Title 4", createdAt: 1004 },
];

function seedItems(db, channelId, items = SEED) {
  ensureChannel(db, channelId);
  const insertItem = db.prepare(
    `INSERT INTO playlist_items(itemId, channelId, idx, title, createdAt)
     VALUES (?, ?, ?, ?, ?)`,
  );
  for (const item of items) {
    insertItem.run(item.itemId, channelId, item.idx, item.title, item.createdAt);
  }
}

async function fetchFingerprint(app, channelId) {
  const body = await listPage(app, channelId, { limit: 1 });
  return body.serverFingerprint;
}

function expectInvalid(res) {
  expect(res.status).toBe(400);
  expect(["INVALID_REQUEST", "INVALID_INDEX"]).toContain(res.body.errorCode);
}

describe("Insert edge cases and validation", () => {
  let current;

  afterEach(() => {
    if (current) {
      current.close();
      current = undefined;
    }
  });

  it("verifies shifting correctness for middle insert", async () => {
    current = createTestDb();
    const app = createApp({ db: current.db });
    const channelId = "demo-news";

    seedItems(current.db, channelId);
    const fp = await fetchFingerprint(app, channelId);

    const res = await request(app)
      .post(`/api/channels/${channelId}/playlist/items`)
      .send({ title: "Inserted", index: 2, clientFingerprint: fp });
    expect(res.status).toBe(201);

    const list = await fetchAllItemsViaPaging(app, channelId);
    expect(list.items.length).toBe(6);
    assertHealthyPlaylist(list.items);

    expect(list.items[0].itemId).toBe("item-0");
    expect(list.items[1].itemId).toBe("item-1");
    expect(list.items[2].title).toBe("Inserted");
    expect(list.items[3].itemId).toBe("item-2");
    expect(list.items[4].itemId).toBe("item-3");
    expect(list.items[5].itemId).toBe("item-4");
  });

  it("inserts at start and shifts existing items", async () => {
    current = createTestDb();
    const app = createApp({ db: current.db });
    const channelId = "demo-news";

    seedItems(current.db, channelId);
    const fp = await fetchFingerprint(app, channelId);

    const res = await request(app)
      .post(`/api/channels/${channelId}/playlist/items`)
      .send({ title: "Inserted Start", index: 0, clientFingerprint: fp });
    expect(res.status).toBe(201);

    const list = await fetchAllItemsViaPaging(app, channelId);
    expect(list.items.length).toBe(6);
    assertHealthyPlaylist(list.items);
    expect(list.items[0].title).toBe("Inserted Start");
    expect(list.items[1].itemId).toBe("item-0");
    expect(list.items[5].itemId).toBe("item-4");
  });

  it("inserts at end without shifting existing items", async () => {
    current = createTestDb();
    const app = createApp({ db: current.db });
    const channelId = "demo-news";

    seedItems(current.db, channelId);
    const fp = await fetchFingerprint(app, channelId);

    const res = await request(app)
      .post(`/api/channels/${channelId}/playlist/items`)
      .send({ title: "Inserted End", index: 5, clientFingerprint: fp });
    expect(res.status).toBe(201);

    const list = await fetchAllItemsViaPaging(app, channelId);
    expect(list.items.length).toBe(6);
    assertHealthyPlaylist(list.items);
    expect(list.items[4].itemId).toBe("item-4");
    expect(list.items[5].title).toBe("Inserted End");
  });

  it("rejects invalid request shapes and keeps playlist unchanged", async () => {
    current = createTestDb();
    const app = createApp({ db: current.db });
    const channelId = "demo-news";

    seedItems(current.db, channelId);
    const fp = await fetchFingerprint(app, channelId);

    const cases = [
      { body: { index: 0, clientFingerprint: fp }, name: "missing title" },
      { body: { title: "", index: 0, clientFingerprint: fp }, name: "empty title" },
      { body: { title: "X", clientFingerprint: fp }, name: "missing index" },
      { body: { title: "X", index: 2.5, clientFingerprint: fp }, name: "non-integer index" },
      { body: { title: "X", index: "2", clientFingerprint: fp }, name: "string index" },
      { body: { title: "X", index: null, clientFingerprint: fp }, name: "null index" },
      { body: { title: "X", index: 0 }, name: "missing fingerprint" },
    ];

    for (const testCase of cases) {
      const res = await request(app)
        .post(`/api/channels/${channelId}/playlist/items`)
        .send(testCase.body);
      expectInvalid(res);

      const list = await fetchAllItemsViaPaging(app, channelId);
      expect(list.items.length).toBe(5);
      expect(list.items.map((i) => i.itemId)).toEqual([
        "item-0",
        "item-1",
        "item-2",
        "item-3",
        "item-4",
      ]);
      assertHealthyPlaylist(list.items);
    }
  });

  it("inserts into an empty playlist", async () => {
    current = createTestDb();
    const app = createApp({ db: current.db });
    const channelId = "demo-news";

    ensureChannel(current.db, channelId);
    const fp = await fetchFingerprint(app, channelId);

    const res = await request(app)
      .post(`/api/channels/${channelId}/playlist/items`)
      .send({ title: "First", index: 0, clientFingerprint: fp });
    expect(res.status).toBe(201);

    const list = await fetchAllItemsViaPaging(app, channelId);
    expect(list.totalCount).toBe(1);
    expect(list.items[0].index).toBe(0);
    expect(list.items[0].title).toBe("First");
    assertHealthyPlaylist(list.items);
  });

  it("keeps playlist unchanged after out-of-range inserts", async () => {
    current = createTestDb();
    const app = createApp({ db: current.db });
    const channelId = "demo-news";

    seedItems(current.db, channelId);
    const fp = await fetchFingerprint(app, channelId);
    const baseline = await fetchAllItemsViaPaging(app, channelId);

    const resLow = await request(app)
      .post(`/api/channels/${channelId}/playlist/items`)
      .send({ title: "Bad", index: -1, clientFingerprint: fp });
    expectInvalid(resLow);

    let list = await fetchAllItemsViaPaging(app, channelId);
    expect(list.totalCount).toBe(baseline.totalCount);
    expect(list.serverFingerprint).toBe(fp);
    assertHealthyPlaylist(list.items);
    expect(new Set(list.items.map((item) => item.itemId)))
      .toEqual(new Set(baseline.items.map((item) => item.itemId)));

    const resHigh = await request(app)
      .post(`/api/channels/${channelId}/playlist/items`)
      .send({ title: "Bad", index: 6, clientFingerprint: fp });
    expectInvalid(resHigh);

    list = await fetchAllItemsViaPaging(app, channelId);
    expect(list.totalCount).toBe(baseline.totalCount);
    expect(list.serverFingerprint).toBe(fp);
    assertHealthyPlaylist(list.items);
    expect(new Set(list.items.map((item) => item.itemId)))
      .toEqual(new Set(baseline.items.map((item) => item.itemId)));
  });

  it("returns mismatch on stale fingerprint and keeps playlist healthy", async () => {
    current = createTestDb();
    const app = createApp({ db: current.db });
    const channelId = "demo-news";

    seedItems(current.db, channelId, SEED.slice(0, 2));
    const fp1 = await fetchFingerprint(app, channelId);

    const first = await request(app)
      .post(`/api/channels/${channelId}/playlist/items`)
      .send({ title: "X", index: 2, clientFingerprint: fp1 });
    expect(first.status).toBe(201);
    const fp2 = first.body.serverFingerprint;

    const stale = await request(app)
      .post(`/api/channels/${channelId}/playlist/items`)
      .send({ title: "Y", index: 1, clientFingerprint: fp1 });
    expect(stale.status).toBe(409);
    expect(stale.body.errorCode).toBe("PLAYLIST_FINGERPRINT_MISMATCH");
    expect(stale.body.serverFingerprint).toBe(fp2);

    const list = await fetchAllItemsViaPaging(app, channelId);
    assertHealthyPlaylist(list.items);
  });
});
