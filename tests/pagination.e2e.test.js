import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createTestDb } from "./helpers/db.js";
import { ensureChannel } from "../src/db/db.js";
import { fetchAllItemsViaPaging } from "./helpers/playlistTestUtils.js";

describe("GET /api/channels/:channelId/playlist/items pagination", () => {
  let current;

  afterEach(() => {
    if (current) {
      current.close();
      current = undefined;
    }
  });

  it("paginates through all items with stable ordering", async () => {
    const testDb = createTestDb();
    current = testDb;
    const channelId = "demo-news";
    const app = createApp({ db: testDb.db });

    ensureChannel(testDb.db, channelId);
    const insertItem = testDb.db.prepare(
      `INSERT INTO playlist_items(itemId, channelId, idx, title, createdAt)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (let i = 0; i < 120; i += 1) {
      insertItem.run(`item-${i}`, channelId, i, `Title ${i}`, Date.now());
    }

    const list = await fetchAllItemsViaPaging(app, channelId, 50);
    expect(list.totalCount).toBe(120);
    expect(typeof list.serverFingerprint).toBe("string");
    expect(new Set(list.items.map((item) => item.itemId)).size).toBe(120);
  });
});
