import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { findPostBySlug, listPostSummaries } from "./posts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.SERVER_PORT ?? 5172);
const corsOrigin = process.env.CORS_ALLOW_ORIGIN ?? "*";

app.use(express.json());
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", corsOrigin);
  res.header("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Accept");
  next();
});

app.get("/healthz", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

app.get("/api/posts", (_req, res) => {
  res.json(listPostSummaries());
});

app.get("/api/posts/:slug", (req, res) => {
  const post = findPostBySlug(req.params.slug);

  if (!post) {
    res.status(404).json({ message: "Post not found" });
    return;
  }

  res.json(post);
});

// Fallback helpful when running in production mode and serving static assets
app.use(express.static(path.join(__dirname, "../dist")));

app.use((req, res) => {
  res.status(404).json({ message: `No route for ${req.method} ${req.path}` });
});

app.listen(port, "0.0.0.0", () => {
  // eslint-disable-next-line no-console
  console.log(`API server listening on http://localhost:${port}`);
});
