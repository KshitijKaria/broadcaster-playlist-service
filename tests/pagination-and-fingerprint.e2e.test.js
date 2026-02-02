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

describe("Pagination and fingerprint behavior", () => {
  let current;

  afterEach(() => {
    if (current) {
      current.close();
      current = undefined;
    }
  });

  it("pagination returns all items exactly once across pages", async () => {
    current = createTestDb();
    const app = createApp({ db: current.db });
    const channelId = "demo-news";

    seedItems(current.db, channelId, 123);

    const firstPage = await listPage(app, channelId, { limit: 50 });
    expect(firstPage.totalCount).toBe(123);
    expect(typeof firstPage.serverFingerprint).toBe("string");
    expect(firstPage.page.hasMore).toBe(true);
    expect(firstPage.page.nextCursor).toBe(49);

    let cursor = firstPage.page.nextCursor;
    let hasMore = firstPage.page.hasMore;
    let lastIndex = firstPage.items[firstPage.items.length - 1].index;
    const allItems = [...firstPage.items];
    const fp = firstPage.serverFingerprint;

    while (hasMore) {
      const page = await listPage(app, channelId, { limit: 50, cursor });
      expect(page.totalCount).toBe(123);
      expect(page.serverFingerprint).toBe(fp);
      if (!page.page.hasMore) {
        expect(page.page.nextCursor).toBe(null);
      }
      if (page.items.length > 0) {
        expect(page.items[0].index).toBeGreaterThan(lastIndex);
        lastIndex = page.items[page.items.length - 1].index;
      }
      allItems.push(...page.items);
      hasMore = page.page.hasMore;
      cursor = page.page.nextCursor;
    }

    expect(allItems.length).toBe(123);
    expect(new Set(allItems.map((item) => item.itemId)).size).toBe(123);
    assertHealthyPlaylist(allItems);

    const firstPageAgain = await listPage(app, channelId, { limit: 50 });
    expect(firstPageAgain.items).toEqual(firstPage.items);
  });

  it("nextCursor behaves correctly", async () => {
    current = createTestDb();
    const app = createApp({ db: current.db });
    const channelId = "demo-news";

    seedItems(current.db, channelId, 123);

    const page1 = await listPage(app, channelId, { limit: 10 });
    expect(page1.page.hasMore).toBe(true);
    expect(page1.page.nextCursor).toBe(9);

    const page2 = await listPage(app, channelId, { limit: 10, cursor: page1.page.nextCursor });
    expect(page2.items[0].index).toBe(10);
    const ids1 = new Set(page1.items.map((item) => item.itemId));
    const overlap = page2.items.find((item) => ids1.has(item.itemId));
    expect(overlap).toBeUndefined();
  });

  it("sync-check returns 409 on stale fingerprint", async () => {
    current = createTestDb();
    const app = createApp({ db: current.db });
    const channelId = "demo-news";

    seedItems(current.db, channelId, 5);
    const fp1 = await fetchFingerprint(app, channelId);

    const insertRes = await request(app)
      .post(`/api/channels/${channelId}/playlist/items`)
      .send({ title: "X", index: 5, clientFingerprint: fp1 });
    expect(insertRes.status).toBe(201);
    const fp2 = insertRes.body.serverFingerprint;
    expect(fp2).not.toBe(fp1);

    const stale = await request(app)
      .post(`/api/channels/${channelId}/playlist/sync-check`)
      .send({ clientFingerprint: fp1 });
    expect(stale.status).toBe(409);
    expect(stale.body.errorCode).toBe("PLAYLIST_FINGERPRINT_MISMATCH");
    expect(stale.body.serverFingerprint).toBe(fp2);

    const ok = await request(app)
      .post(`/api/channels/${channelId}/playlist/sync-check`)
      .send({ clientFingerprint: fp2 });
    expect(ok.status).toBe(200);
    expect(ok.body.serverFingerprint).toBe(fp2);
  });

  it("insert returns 409 on stale fingerprint", async () => {
    current = createTestDb();
    const app = createApp({ db: current.db });
    const channelId = "demo-news";

    seedItems(current.db, channelId, 5);
    const fp1 = await fetchFingerprint(app, channelId);

    const first = await request(app)
      .post(`/api/channels/${channelId}/playlist/items`)
      .send({ title: "X", index: 5, clientFingerprint: fp1 });
    expect(first.status).toBe(201);
    const fp2 = first.body.serverFingerprint;

    const stale = await request(app)
      .post(`/api/channels/${channelId}/playlist/items`)
      .send({ title: "Y", index: 6, clientFingerprint: fp1 });
    expect(stale.status).toBe(409);
    expect(stale.body.errorCode).toBe("PLAYLIST_FINGERPRINT_MISMATCH");
    expect(stale.body.serverFingerprint).toBe(fp2);
  });

  it("delete returns 409 on stale fingerprint", async () => {
    current = createTestDb();
    const app = createApp({ db: current.db });
    const channelId = "demo-news";

    seedItems(current.db, channelId, 5);
    const list = await fetchAllItemsViaPaging(app, channelId, 50);
    const fp1 = list.serverFingerprint;
    const itemId = list.items[0].itemId;

    const bump = await request(app)
      .post(`/api/channels/${channelId}/playlist/items`)
      .send({ title: "X", index: 5, clientFingerprint: fp1 });
    expect(bump.status).toBe(201);
    const fp2 = bump.body.serverFingerprint;

    const stale = await request(app)
      .delete(`/api/channels/${channelId}/playlist/items/${itemId}`)
      .send({ clientFingerprint: fp1 });
    expect(stale.status).toBe(409);
    expect(stale.body.errorCode).toBe("PLAYLIST_FINGERPRINT_MISMATCH");
    expect(typeof stale.body.serverFingerprint).toBe("string");

    const ok = await request(app)
      .delete(`/api/channels/${channelId}/playlist/items/${itemId}`)
      .send({ clientFingerprint: fp2 });
    expect(ok.status).toBe(200);
  });

  it("move returns 409 on stale fingerprint", async () => {
    current = createTestDb();
    const app = createApp({ db: current.db });
    const channelId = "demo-news";

    seedItems(current.db, channelId, 5);
    const list = await fetchAllItemsViaPaging(app, channelId, 50);
    const fp1 = list.serverFingerprint;
    const itemId = list.items[1].itemId;

    const bump = await request(app)
      .post(`/api/channels/${channelId}/playlist/items`)
      .send({ title: "X", index: 5, clientFingerprint: fp1 });
    expect(bump.status).toBe(201);
    const fp2 = bump.body.serverFingerprint;

    const stale = await request(app)
      .post(`/api/channels/${channelId}/playlist/items/${itemId}/move`)
      .send({ newIndex: 3, clientFingerprint: fp1 });
    expect(stale.status).toBe(409);
    expect(stale.body.errorCode).toBe("PLAYLIST_FINGERPRINT_MISMATCH");
    expect(typeof stale.body.serverFingerprint).toBe("string");

    const ok = await request(app)
      .post(`/api/channels/${channelId}/playlist/items/${itemId}/move`)
      .send({ newIndex: 3, clientFingerprint: fp2 });
    expect(ok.status).toBe(200);
  });
});
