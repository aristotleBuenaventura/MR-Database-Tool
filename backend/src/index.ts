import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { healthRouter } from "./routes/health.js";
import { authRouter } from "./routes/auth.js";
import { reportsRouter } from "./routes/reports.js";

// Always load backend/.env even when PM2 cwd is not the backend folder
dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env"),
});

const app = express();
const port = Number(process.env.PORT ?? 4000);
const corsOrigin = process.env.CORS_ORIGIN ?? "http://localhost:5173";

app.use(
  cors({
    origin: corsOrigin,
  }),
);
app.use(express.json({ limit: "50mb" }));

app.use("/api/health", healthRouter);
app.use("/api/auth", authRouter);
app.use("/api/reports", reportsRouter);

app.get("/", (_req, res) => {
  res.json({ message: "MR Database Tool API" });
});

app.listen(port, () => {
  console.log(`API running at http://localhost:${port}`);
});
