import request from "supertest";
import { expect } from "vitest";

export async function listPage(app, channelId, { limit = 50, cursor } = {}) {
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor !== undefined) {
    query.set("cursor", String(cursor));
  }

  const res = await request(app)
    .get(`/api/channels/${channelId}/playlist/items?${query.toString()}`);

  expect(res.status).toBe(200);
  return res.body;
}

export async function fetchAllItemsViaPaging(app, channelId, limit = 50) {
  const items = [];
  let cursor;
  let hasMore = true;
  let totalCount;
  let serverFingerprint;

  while (hasMore) {
    const body = await listPage(app, channelId, { limit, cursor });
    const pageItems = body.items ?? [];
    for (let i = 1; i < pageItems.length; i += 1) {
      expect(pageItems[i].index).toBeGreaterThan(pageItems[i - 1].index);
    }

    if (totalCount === undefined) {
      totalCount = body.totalCount;
    } else {
      expect(body.totalCount).toBe(totalCount);
    }

    items.push(...pageItems);
    hasMore = body.page?.hasMore;
    cursor = body.page?.nextCursor;
    serverFingerprint = body.serverFingerprint ?? serverFingerprint;
    if (!hasMore) {
      expect(body.page?.nextCursor).toBe(null);
    }
  }

  return { items, totalCount, serverFingerprint };
}

export function assertHealthyPlaylist(items) {
  const count = items.length;
  const indexes = items.map((item) => item.index);
  const expected = Array.from({ length: count }, (_, i) => i);

  expect(indexes).toEqual(expected);
  expect(new Set(indexes).size).toBe(count);
  expect(new Set(items.map((item) => item.itemId)).size).toBe(count);
}
