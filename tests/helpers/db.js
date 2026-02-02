import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeDb, migrate, openDb } from "../../src/db/db.js";

export function createTestDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "playlist-db-"));
  const filename = path.join(dir, "test.db");
  const db = openDb({ filename });
  migrate(db);

  return {
    db,
    filename,
    close: () => {
      closeDb(db);
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
