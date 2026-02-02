import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export function openDb({ filename } = {}) {
  const resolved = filename ?? "./data/playlist.db";
  const dir = path.dirname(resolved);

  if (dir && dir !== ".") {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(resolved);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

export function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS channels (
      channelId TEXT PRIMARY KEY
    );

    CREATE TABLE IF NOT EXISTS playlist_items (
      itemId TEXT PRIMARY KEY,
      channelId TEXT NOT NULL,
      idx INTEGER NOT NULL,
      title TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      FOREIGN KEY(channelId) REFERENCES channels(channelId)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS playlist_items_channel_idx_unique
      ON playlist_items(channelId, idx);

    CREATE INDEX IF NOT EXISTS playlist_items_channel_idx
      ON playlist_items(channelId, idx);
  `);
}

export function closeDb(db) {
  if (db) db.close();
}
