import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { ensureChannel } from "../src/db/db.js";
import { createTestDb } from "./helpers/db.js";
import {
  assertHealthyPlaylist,
  fetchAllItemsViaPaging,
  listPage,
} from "./helpers/playlistTestUtils.js";

function seedItems(db, channelId, count) {
  ensureChannel(db, channelId);
  const insertItem = db.prepare(
    `INSERT INTO playlist_items(itemId, channelId, idx, title, createdAt)
     VALUES (?, ?, ?, ?, ?)`,
  );
  for (let i = 0; i < count; i += 1) {
    insertItem.run(`seed-${i}`, channelId, i, `Title ${i}`, 1_000 + i);
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

describe("Insert extra scenarios", () => {
  let current;

  afterEach(() => {
    if (current) {
      current.close();
      current = undefined;
    }
  });

  it("rejects missing clientFingerprint with 400 and leaves playlist unchanged", async () => {
    current = createTestDb();
    const app = createApp({ db: current.db });
    const channelId = "demo-news";

    seedItems(current.db, channelId, 3);

    const res = await request(app)
      .post(`/api/channels/${channelId}/playlist/items`)
      .send({ title: "X", index: 0 });
    expectInvalid(res);

    const list = await fetchAllItemsViaPaging(app, channelId);
    expect(list.totalCount).toBe(3);
    assertHealthyPlaylist(list.items);
  });

  it("rejects whitespace and non-string titles", async () => {
    current = createTestDb();
    const app = createApp({ db: current.db });
    const channelId = "demo-news";

    seedItems(current.db, channelId, 2);
    const fp = await fetchFingerprint(app, channelId);

    const resWhitespace = await request(app)
      .post(`/api/channels/${channelId}/playlist/items`)
      .send({ title: "   ", index: 0, clientFingerprint: fp });
    expectInvalid(resWhitespace);

    let list = await fetchAllItemsViaPaging(app, channelId);
    expect(list.totalCount).toBe(2);
    assertHealthyPlaylist(list.items);

    const resNonString = await request(app)
      .post(`/api/channels/${channelId}/playlist/items`)
      .send({ title: 123, index: 0, clientFingerprint: fp });
    expectInvalid(resNonString);

    list = await fetchAllItemsViaPaging(app, channelId);
    expect(list.totalCount).toBe(2);
    assertHealthyPlaylist(list.items);
  });

  it("simulates two clients with stale fingerprint", async () => {
    current = createTestDb();
    const app = createApp({ db: current.db });
    const channelId = "demo-news";

    seedItems(current.db, channelId, 5);

    const fpA = await fetchFingerprint(app, channelId);
    const fpB = await fetchFingerprint(app, channelId);
    expect(fpB).toBe(fpA);

    const resA = await request(app)
      .post(`/api/channels/${channelId}/playlist/items`)
      .send({ title: "Client A", index: 0, clientFingerprint: fpA });
    expect(resA.status).toBe(201);
    const fpNew = resA.body.serverFingerprint;
    expect(fpNew).not.toBe(fpA);

    const resB = await request(app)
      .post(`/api/channels/${channelId}/playlist/items`)
      .send({ title: "Client B", index: 1, clientFingerprint: fpB });
    expect(resB.status).toBe(409);
    expect(resB.body.errorCode).toBe("PLAYLIST_FINGERPRINT_MISMATCH");
    expect(resB.body.serverFingerprint).toBe(fpNew);

    const list = await fetchAllItemsViaPaging(app, channelId);
    expect(list.totalCount).toBe(6);
    assertHealthyPlaylist(list.items);
    const titles = list.items.map((item) => item.title);
    expect(titles).toContain("Client A");
    expect(titles).not.toContain("Client B");
  });

  it("handles large-ish insert with pagination", async () => {
    current = createTestDb();
    const app = createApp({ db: current.db });
    const channelId = "demo-news";

    seedItems(current.db, channelId, 300);
    const fp = await fetchFingerprint(app, channelId);

    const res = await request(app)
      .post(`/api/channels/${channelId}/playlist/items`)
      .send({ title: "Inserted Mid", index: 150, clientFingerprint: fp });
    expect(res.status).toBe(201);
    const insertedId = res.body.item.itemId;

    const list = await fetchAllItemsViaPaging(app, channelId, 50);
    expect(list.totalCount).toBe(301);
    assertHealthyPlaylist(list.items);
    expect(list.items[150].itemId).toBe(insertedId);
  });
});
