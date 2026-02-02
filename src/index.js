import { createApp } from "./app.js";
import { closeDb } from "./db/db.js";

const port = process.env.PORT || 3000;
const app = createApp();
const { db, ownsDb } = app.locals;

app.listen(port, () => {
  console.log(`listening on http://localhost:${port}`);
});

function handleShutdown(signal) {
  if (ownsDb) {
    closeDb(db);
  }
  process.exit(0);
}

process.on("SIGINT", handleShutdown);
process.on("SIGTERM", handleShutdown);
