import cors from "cors";
import express from "express";
import { openDb, migrate } from "./db/db.js";
import { healthRouter } from "./routes/health.js";
import { playlistRouter } from "./routes/playlist.js";

export function createApp({ db } = {}) {
  const app = express();
  const allowedOrigins = new Set([
    "http://localhost:5173",
    "http://localhost:3000",
    "https://broadcaster-playlist-service.lovable.app",
  ]);
  const corsOptions = {
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  };
  app.use(cors(corsOptions));
  app.options(/.*/, cors(corsOptions));
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
  app.use(playlistRouter);

  return app;
}
