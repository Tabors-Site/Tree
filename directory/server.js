import { fileURLToPath } from "url";
import { dirname, join } from "path";
import express from "express";
import mongoose from "mongoose";
import rateLimit from "express-rate-limit";
import directoryRoutes from "./routes/directory.js";
import extensionRoutes from "./routes/extensions.js";
import { startHealthCheckJob } from "./jobs/healthCheck.js";
import { renderDashboard } from "./views/dashboard.js";
import Land from "./db/models/land.js";
import PublicTree from "./db/models/publicTree.js";
import Extension from "./db/models/extension.js";
import { renderExtensionPage } from "./views/extensionPage.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4000;
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/canopy-directory";

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));

// Rate limiting
const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 registrations per hour per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "Too many registration attempts. Try again later." },
});

const searchLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 searches per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "Too many requests. Slow down." },
});

app.use("/directory/register", registrationLimiter);
app.use("/directory/lands", searchLimiter);
app.use("/directory/land", searchLimiter);
app.use("/directory/search", searchLimiter);

// Serve static files
app.get("/sitemap.xml", (req, res) => res.sendFile(join(__dirname, "sitemap.xml")));
app.get("/llms.txt", (req, res) => res.type("text/plain").sendFile(join(__dirname, "llms.txt")));
app.get("/humans.txt", (req, res) => res.type("text/plain").sendFile(join(__dirname, "humans.txt")));

// Dashboard page at root
app.get("/", async (req, res) => {
  try {
    const [lands, rawTrees, landCount, treeCount, activeLands, extensions, extensionCount] = await Promise.all([
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
      Extension.aggregate([
        { $sort: { name: 1, publishedAt: -1 } },
        { $group: { _id: "$name", latest: { $first: "$$ROOT" } } },
        { $replaceRoot: { newRoot: "$latest" } },
        { $sort: { downloads: -1, name: 1 } },
        { $limit: 50 },
        { $project: { name: 1, version: 1, description: 1, authorDomain: 1, authorName: 1, tags: 1, downloads: 1, publishedAt: 1 } },
      ]),
      Extension.distinct("name").then((r) => r.length),
    ]);

    // Enrich trees with land baseUrl for building links
    const landMap = Object.fromEntries(lands.map((l) => [l.domain, l]));
    const trees = rawTrees.map((t) => {
      const land = landMap[t.landDomain] || {};
      return { ...t, landBaseUrl: land.siteUrl || land.baseUrl || null };
    });

    const html = renderDashboard({
      lands,
      trees,
      extensions,
      stats: { landCount, treeCount, activeLands, extensionCount },
    });

    res.setHeader("Content-Type", "text/html");
    res.send(html);
  } catch (err) {
    res.status(500).send("Directory error: " + err.message);
  }
});

// Extension detail page (HTML)
app.get("/extensions/:name/page", async (req, res) => {
  try {
    const { name } = req.params;
    const version = req.query.v || null;

    const query = version ? { name, version } : null;
    let ext;

    if (query) {
      ext = await Extension.findOne(query).lean();
    } else {
      ext = await Extension.findOne({ name }).sort({ publishedAt: -1 }).lean();
    }

    if (!ext) {
      return res.status(404).send("Extension not found");
    }

    const versions = await Extension.find({ name })
      .sort({ publishedAt: -1 })
      .select("version publishedAt downloads")
      .lean();

    const html = renderExtensionPage({ ext, versions });
    res.setHeader("Content-Type", "text/html");
    res.send(html);
  } catch (err) {
    res.status(500).send("Error: " + err.message);
  }
});

app.use("/directory", directoryRoutes);
app.use("/extensions", extensionRoutes);

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
