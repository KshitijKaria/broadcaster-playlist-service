import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { ensureChannel } from "../src/db/db.js";
import { createTestDb } from "./helpers/db.js";
import {
  assertHealthyPlaylist,
  fetchAllItemsViaPaging,
} from "./helpers/playlistTestUtils.js";

const SEED_TITLES = ["A", "B", "C", "D", "E"];

function seedTitles(db, channelId) {
  ensureChannel(db, channelId);
  const insertItem = db.prepare(
    `INSERT INTO playlist_items(itemId, channelId, idx, title, createdAt)
     VALUES (?, ?, ?, ?, ?)`,
  );
  SEED_TITLES.forEach((title, idx) => {
    insertItem.run(`seed-${idx}`, channelId, idx, title, 1_000 + idx);
  });
}

async function fetchFingerprint(app, channelId) {
  const res = await request(app).get(
    `/api/channels/${channelId}/playlist/items?limit=1`,
  );
  expect(res.status).toBe(200);
  expect(typeof res.body.serverFingerprint).toBe("string");
  return res.body.serverFingerprint;
}

function expectInvalidRequest(res) {
  expect(res.status).toBe(400);
  expect(["INVALID_REQUEST", "INVALID_INDEX"]).toContain(res.body.errorCode);
}

describe("Insert scenarios via API", () => {
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

    seedTitles(current.db, channelId);
    const fp = await fetchFingerprint(app, channelId);

    const res = await request(app)
      .post(`/api/channels/${channelId}/playlist/items`)
      .send({ title: "X", index: 0, clientFingerprint: fp });

    expect(res.status).toBe(201);
    expect(res.body.item.index).toBe(0);
    expect(res.body.item.title).toBe("X");
    expect(typeof res.body.serverFingerprint).toBe("string");
    expect(res.body.serverFingerprint).not.toBe(fp);

    const list = await fetchAllItemsViaPaging(app, channelId);
    expect(list.items.length).toBe(6);
    expect(list.items.map((i) => i.title)).toEqual(["X", "A", "B", "C", "D", "E"]);
    assertHealthyPlaylist(list.items);
  });

  it("inserts in the middle and shifts subsequent items", async () => {
    current = createTestDb();
    const app = createApp({ db: current.db });
    const channelId = "demo-news";

    seedTitles(current.db, channelId);
    const fp = await fetchFingerprint(app, channelId);

    const res = await request(app)
      .post(`/api/channels/${channelId}/playlist/items`)
      .send({ title: "X", index: 2, clientFingerprint: fp });

    expect(res.status).toBe(201);
    expect(typeof res.body.serverFingerprint).toBe("string");
    expect(res.body.serverFingerprint).not.toBe(fp);

    const list = await fetchAllItemsViaPaging(app, channelId);
    expect(list.items.length).toBe(6);
    expect(list.items.map((i) => i.title)).toEqual(["A", "B", "X", "C", "D", "E"]);
    assertHealthyPlaylist(list.items);
  });

  it("inserts at the end without shifting existing items (index == N)", async () => {
    current = createTestDb();
    const app = createApp({ db: current.db });
    const channelId = "demo-news";

    seedTitles(current.db, channelId);
    const fp = await fetchFingerprint(app, channelId);

    // With 5 seeded items (N=5), inserting at index 5 appends to end.
    const res = await request(app)
      .post(`/api/channels/${channelId}/playlist/items`)
      .send({ title: "X", index: 5, clientFingerprint: fp });

    expect(res.status).toBe(201);
    expect(typeof res.body.serverFingerprint).toBe("string");
    expect(res.body.serverFingerprint).not.toBe(fp);

    const list = await fetchAllItemsViaPaging(app, channelId);
    expect(list.items.length).toBe(6);
    expect(list.items.map((i) => i.title)).toEqual(["A", "B", "C", "D", "E", "X"]);
    assertHealthyPlaylist(list.items);
  });

  it("rejects out-of-range indices and keeps playlist unchanged", async () => {
    current = createTestDb();
    const app = createApp({ db: current.db });
    const channelId = "demo-news";

    seedTitles(current.db, channelId);
    const fp = await fetchFingerprint(app, channelId);

    const resLow = await request(app)
      .post(`/api/channels/${channelId}/playlist/items`)
      .send({ title: "X", index: -1, clientFingerprint: fp });
    expectInvalidRequest(resLow);

    let list = await fetchAllItemsViaPaging(app, channelId);
    expect(list.items.length).toBe(5);
    expect(list.items.map((i) => i.title)).toEqual(["A", "B", "C", "D", "E"]);
    assertHealthyPlaylist(list.items);

    const resHigh = await request(app)
      .post(`/api/channels/${channelId}/playlist/items`)
      .send({ title: "X", index: 6, clientFingerprint: fp });
    expectInvalidRequest(resHigh);

    list = await fetchAllItemsViaPaging(app, channelId);
    expect(list.items.length).toBe(5);
    expect(list.items.map((i) => i.title)).toEqual(["A", "B", "C", "D", "E"]);
    assertHealthyPlaylist(list.items);
  });

  it("rejects insert on fingerprint mismatch and returns current serverFingerprint", async () => {
    current = createTestDb();
    const app = createApp({ db: current.db });
    const channelId = "demo-news";

    seedTitles(current.db, channelId);
    const fp = await fetchFingerprint(app, channelId);

    const first = await request(app)
      .post(`/api/channels/${channelId}/playlist/items`)
      .send({ title: "X", index: 0, clientFingerprint: fp });
    expect(first.status).toBe(201);
    const fp2 = first.body.serverFingerprint;
    expect(fp2).not.toBe(fp);

    const res = await request(app)
      .post(`/api/channels/${channelId}/playlist/items`)
      .send({ title: "Y", index: 1, clientFingerprint: fp });

    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe("PLAYLIST_FINGERPRINT_MISMATCH");
    expect(res.body.serverFingerprint).toBe(fp2);

    const list = await fetchAllItemsViaPaging(app, channelId);
    assertHealthyPlaylist(list.items);
  });
});
