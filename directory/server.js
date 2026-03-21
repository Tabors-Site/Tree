import express from "express";
import mongoose from "mongoose";
import directoryRoutes from "./routes/directory.js";
import { startHealthCheckJob } from "./jobs/healthCheck.js";
import { renderDashboard } from "./views/dashboard.js";
import Land from "./db/models/land.js";
import PublicTree from "./db/models/publicTree.js";

const PORT = process.env.PORT || 4000;
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/canopy-directory";

const app = express();
app.use(express.json({ limit: "1mb" }));

// Dashboard page at root
app.get("/", async (req, res) => {
  try {
    const [lands, trees, landCount, treeCount, activeLands] = await Promise.all([
      Land.find({ status: { $ne: "dead" } })
        .sort({ lastSeenAt: -1 })
        .limit(50)
        .lean(),
      PublicTree.find()
        .sort({ lastUpdated: -1 })
        .limit(50)
        .lean(),
      Land.countDocuments({ status: { $ne: "dead" } }),
      PublicTree.countDocuments(),
      Land.countDocuments({ status: "active" }),
    ]);

    const html = renderDashboard({
      lands,
      trees,
      stats: { landCount, treeCount, activeLands },
    });

    res.setHeader("Content-Type", "text/html");
    res.send(html);
  } catch (err) {
    res.status(500).send("Directory error: " + err.message);
  }
});

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
