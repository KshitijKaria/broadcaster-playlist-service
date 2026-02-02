import crypto from "node:crypto";
import { Router } from "express";
import { bumpChannelVersion, ensureChannel, getChannelVersion } from "../db/db.js";

export const playlistRouter = Router();

playlistRouter.get("/api/channels/:channelId/playlist/items", (req, res) => {
  const { channelId } = req.params;
  const db = req.app.locals.db;

  const rawLimit = Number.parseInt(req.query.limit, 10);
  let limit = Number.isFinite(rawLimit) ? rawLimit : 50;
  if (limit < 1) limit = 1;
  if (limit > 200) limit = 200;

  const rawCursor = Number.parseInt(req.query.cursor, 10);
  const hasCursor = Number.isFinite(rawCursor);

  ensureChannel(db, channelId);
  const totalCount = db.prepare(
    "SELECT COUNT(*) AS count FROM playlist_items WHERE channelId = ?",
  ).get(channelId).count;

  const params = hasCursor
    ? [channelId, rawCursor, limit + 1]
    : [channelId, limit + 1];
  const rows = db.prepare(
    hasCursor
      ? `SELECT itemId, idx, title
         FROM playlist_items
         WHERE channelId = ? AND idx > ?
         ORDER BY idx ASC
         LIMIT ?`
      : `SELECT itemId, idx, title
         FROM playlist_items
         WHERE channelId = ?
         ORDER BY idx ASC
         LIMIT ?`,
  ).all(...params);

  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  const items = slice.map((row) => ({
    itemId: row.itemId,
    index: row.idx,
    title: row.title,
  }));
  const nextCursor = hasMore ? items[items.length - 1].index : null;
  const serverFingerprint = String(getChannelVersion(db, channelId));

  res.json({
    items,
    page: { limit, nextCursor, hasMore },
    totalCount,
    serverFingerprint,
  });
});

playlistRouter.post("/api/channels/:channelId/playlist/items", (req, res) => {
  const { channelId } = req.params;
  const { title, index, clientFingerprint } = req.body ?? {};
  const db = req.app.locals.db;

  const validTitle = typeof title === "string" && title.trim().length > 0;
  const validIndex = Number.isInteger(index);
  const validFingerprint =
    typeof clientFingerprint === "string" && clientFingerprint.length > 0;

  if (!validTitle || !validIndex || !validFingerprint) {
    return res.status(400).json({ errorCode: "INVALID_REQUEST" });
  }

  if (index < 0) {
    return res.status(400).json({ errorCode: "INVALID_REQUEST" });
  }

  ensureChannel(db, channelId);
  const totalCount = db.prepare(
    "SELECT COUNT(*) AS count FROM playlist_items WHERE channelId = ?",
  ).get(channelId).count;

  if (index > totalCount) {
    return res.status(400).json({ errorCode: "INVALID_REQUEST" });
  }

  const currentVersion = getChannelVersion(db, channelId);
  if (clientFingerprint !== String(currentVersion)) {
    return res.status(409).json({
      errorCode: "PLAYLIST_FINGERPRINT_MISMATCH",
      serverFingerprint: String(currentVersion),
    });
  }

  const itemId = crypto.randomUUID();
  const createdAt = Date.now();
  let newVersion;

  try {
    const insertTx = db.transaction(() => {
      const rows = db.prepare(
        `SELECT itemId, idx
         FROM playlist_items
         WHERE channelId = ? AND idx >= ?
         ORDER BY idx DESC`,
      ).all(channelId, index);
      const bumpStmt = db.prepare(
        "UPDATE playlist_items SET idx = ? WHERE channelId = ? AND itemId = ?",
      );
      for (const row of rows) {
        bumpStmt.run(row.idx + 1, channelId, row.itemId);
      }

      db.prepare(
        `INSERT INTO playlist_items(itemId, channelId, idx, title, createdAt)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(itemId, channelId, index, title, createdAt);

      newVersion = bumpChannelVersion(db, channelId);
    });

    insertTx();
  } catch (err) {
    return res.status(500).json({ errorCode: "INSERT_FAILED" });
  }

  return res.status(201).json({
    item: { itemId, index, title },
    serverFingerprint: String(newVersion),
  });
});

playlistRouter.delete("/api/channels/:channelId/playlist/items/:itemId", (req, res) => {
  const { channelId, itemId } = req.params;
  const { clientFingerprint } = req.body ?? {};
  const db = req.app.locals.db;

  const validFingerprint =
    typeof clientFingerprint === "string" && clientFingerprint.length > 0;
  if (!validFingerprint) {
    return res.status(400).json({ errorCode: "INVALID_REQUEST" });
  }

  ensureChannel(db, channelId);
  const currentVersion = getChannelVersion(db, channelId);
  if (clientFingerprint !== String(currentVersion)) {
    return res.status(409).json({
      errorCode: "PLAYLIST_FINGERPRINT_MISMATCH",
      serverFingerprint: String(currentVersion),
    });
  }

  let newVersion;
  let notFound = false;

  try {
    const deleteTx = db.transaction(() => {
      const row = db.prepare(
        "SELECT idx FROM playlist_items WHERE channelId = ? AND itemId = ?",
      ).get(channelId, itemId);
      if (!row) {
        notFound = true;
        return;
      }

      db.prepare(
        "DELETE FROM playlist_items WHERE channelId = ? AND itemId = ?",
      ).run(channelId, itemId);

      const rows = db.prepare(
        `SELECT itemId, idx
         FROM playlist_items
         WHERE channelId = ? AND idx > ?
         ORDER BY idx ASC`,
      ).all(channelId, row.idx);
      const shiftStmt = db.prepare(
        "UPDATE playlist_items SET idx = ? WHERE channelId = ? AND itemId = ?",
      );
      for (const shifted of rows) {
        shiftStmt.run(shifted.idx - 1, channelId, shifted.itemId);
      }

      newVersion = bumpChannelVersion(db, channelId);
    });

    deleteTx();
  } catch (err) {
    return res.status(500).json({ errorCode: "DELETE_FAILED" });
  }

  if (notFound) {
    return res.status(404).json({ errorCode: "ITEM_NOT_FOUND" });
  }

  return res.status(200).json({
    serverFingerprint: String(newVersion),
  });
});

playlistRouter.post(
  "/api/channels/:channelId/playlist/items/:itemId/move",
  (req, res) => {
    const { channelId, itemId } = req.params;
    const { newIndex, clientFingerprint } = req.body ?? {};
    const db = req.app.locals.db;

    const validIndex = Number.isInteger(newIndex);
    const validFingerprint =
      typeof clientFingerprint === "string" && clientFingerprint.length > 0;
    if (!validIndex || !validFingerprint) {
      return res.status(400).json({ errorCode: "INVALID_REQUEST" });
    }

    if (newIndex < 0) {
      return res.status(400).json({ errorCode: "INVALID_REQUEST" });
    }

    ensureChannel(db, channelId);
    const totalCount = db.prepare(
      "SELECT COUNT(*) AS count FROM playlist_items WHERE channelId = ?",
    ).get(channelId).count;

    if (newIndex >= totalCount) {
      return res.status(400).json({ errorCode: "INVALID_REQUEST" });
    }

    const currentVersion = getChannelVersion(db, channelId);
    if (clientFingerprint !== String(currentVersion)) {
      return res.status(409).json({
        errorCode: "PLAYLIST_FINGERPRINT_MISMATCH",
        serverFingerprint: String(currentVersion),
      });
    }

    let movedTitle;
    let oldIndex;
    let newVersion;
    let notFound = false;

    try {
      const moveTx = db.transaction(() => {
        const row = db.prepare(
          "SELECT idx, title FROM playlist_items WHERE channelId = ? AND itemId = ?",
        ).get(channelId, itemId);
        if (!row) {
          notFound = true;
          return;
        }

        oldIndex = row.idx;
        movedTitle = row.title;

        db.prepare(
          "UPDATE playlist_items SET idx = -1 WHERE channelId = ? AND itemId = ?",
        ).run(channelId, itemId);

        if (oldIndex < newIndex) {
          const rows = db.prepare(
            `SELECT itemId, idx
             FROM playlist_items
             WHERE channelId = ? AND idx > ? AND idx <= ?
             ORDER BY idx ASC`,
          ).all(channelId, oldIndex, newIndex);
          const shiftStmt = db.prepare(
            "UPDATE playlist_items SET idx = ? WHERE channelId = ? AND itemId = ?",
          );
          for (const row of rows) {
            shiftStmt.run(row.idx - 1, channelId, row.itemId);
          }
        } else if (oldIndex > newIndex) {
          const rows = db.prepare(
            `SELECT itemId, idx
             FROM playlist_items
             WHERE channelId = ? AND idx >= ? AND idx < ?
             ORDER BY idx DESC`,
          ).all(channelId, newIndex, oldIndex);
          const shiftStmt = db.prepare(
            "UPDATE playlist_items SET idx = ? WHERE channelId = ? AND itemId = ?",
          );
          for (const row of rows) {
            shiftStmt.run(row.idx + 1, channelId, row.itemId);
          }
        }

        db.prepare(
          "UPDATE playlist_items SET idx = ? WHERE channelId = ? AND itemId = ?",
        ).run(newIndex, channelId, itemId);

        newVersion = bumpChannelVersion(db, channelId);
      });

      moveTx();
    } catch (err) {
      return res.status(500).json({ errorCode: "MOVE_FAILED" });
    }

    if (notFound) {
      return res.status(404).json({ errorCode: "ITEM_NOT_FOUND" });
    }

    return res.status(200).json({
      item: { itemId, index: newIndex, title: movedTitle },
      serverFingerprint: String(newVersion),
    });
  },
);

playlistRouter.post("/api/channels/:channelId/playlist/sync-check", (req, res) => {
  const { channelId } = req.params;
  const { clientFingerprint } = req.body ?? {};
  const db = req.app.locals.db;

  const validFingerprint =
    typeof clientFingerprint === "string" && clientFingerprint.length > 0;
  if (!validFingerprint) {
    return res.status(400).json({ errorCode: "INVALID_REQUEST" });
  }

  ensureChannel(db, channelId);
  const currentVersion = getChannelVersion(db, channelId);
  if (clientFingerprint !== String(currentVersion)) {
    return res.status(409).json({
      errorCode: "PLAYLIST_FINGERPRINT_MISMATCH",
      serverFingerprint: String(currentVersion),
    });
  }

  return res.status(200).json({ serverFingerprint: String(currentVersion) });
});
