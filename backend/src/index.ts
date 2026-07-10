import "dotenv/config";
import express from "express";
import cors from "cors";
import { healthRouter } from "./routes/health.js";
import { authRouter } from "./routes/auth.js";
import { reportsRouter } from "./routes/reports.js";

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
