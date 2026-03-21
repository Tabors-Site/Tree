import express from "express";
import mongoose from "mongoose";
import directoryRoutes from "./routes/directory.js";
import { startHealthCheckJob } from "./jobs/healthCheck.js";

const PORT = process.env.PORT || 4000;
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/canopy-directory";

const app = express();
app.use(express.json({ limit: "1mb" }));

app.use("/directory", directoryRoutes);

async function start() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log("[Directory] Connected to MongoDB");

    startHealthCheckJob();

    app.listen(PORT, () => {
      console.log(`[Directory] Canopy Directory Service running on port ${PORT}`);
    });
  } catch (err) {
    console.error("[Directory] Failed to start:", err.message);
    process.exit(1);
  }
}

start();
