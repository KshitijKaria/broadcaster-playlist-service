import express from "express";
import { openDb, migrate } from "./db/db.js";
import { healthRouter } from "./routes/health.js";

export function createApp({ db } = {}) {
  const app = express();
  app.use(express.json());

  let ownsDb = false;
  if (!db) {
    db = openDb({ filename: "./data/playlist.db" });
    migrate(db);
    ownsDb = true;
  }

  app.locals.db = db;
  app.locals.ownsDb = ownsDb;

  app.use(healthRouter);

  return app;
}
