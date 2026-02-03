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
      channelId TEXT PRIMARY KEY,
      version INTEGER NOT NULL DEFAULT 1
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
  `);

  const cols = db.prepare("PRAGMA table_info(channels)").all().map((c) => c.name);
  if (!cols.includes("version")) {
    db.exec(`ALTER TABLE channels ADD COLUMN version INTEGER NOT NULL DEFAULT 1;`);
  }
}

export function ensureChannel(db, channelId) {
  db.prepare(
    `INSERT INTO channels(channelId, version)
     VALUES (?, 1)
     ON CONFLICT(channelId) DO NOTHING`,
  ).run(channelId);
}

export function getChannelVersion(db, channelId) {
  ensureChannel(db, channelId);
  return db.prepare("SELECT version FROM channels WHERE channelId = ?")
    .get(channelId).version;
}

export function bumpChannelVersion(db, channelId) {
  ensureChannel(db, channelId);
  db.prepare("UPDATE channels SET version = version + 1 WHERE channelId = ?")
    .run(channelId);
  return db.prepare("SELECT version FROM channels WHERE channelId = ?")
    .get(channelId).version;
}

export function closeDb(db) {
  if (db) db.close();
}
