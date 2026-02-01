import express from "express";

function createApp() {
  const app = express();
  app.use(express.json());

  app.get("/health", (req, res) => {
    res.status(200).json({ status: "ok" });
  });

  return app;
}

export { createApp };
