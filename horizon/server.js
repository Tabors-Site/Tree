import { fileURLToPath } from "url";
import { dirname, join } from "path";
import express from "express";
import mongoose from "mongoose";
import rateLimit from "express-rate-limit";
import horizonRoutes from "./routes/horizon.js";
import extensionRoutes from "./routes/extensions.js";
import { startHealthCheckJob } from "./jobs/healthCheck.js";
import { renderDashboard } from "./views/dashboard.js";
import { renderLandsPage } from "./views/landsPage.js";
import { renderExtensionsBrowsePage } from "./views/extensionsBrowsePage.js";
import { renderOsPage } from "./views/osPage.js";
import { renderBundlePage } from "./views/bundlePage.js";
import { renderExtensionPage } from "./views/extensionPage.js";
import Land from "./db/models/land.js";
import PublicTree from "./db/models/publicTree.js";
import Extension from "./db/models/extension.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4000;
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/canopy-horizon";

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "5mb" }));

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

app.use("/horizon/register", registrationLimiter);
app.use("/horizon/lands", searchLimiter);
app.use("/horizon/land", searchLimiter);
app.use("/horizon/search", searchLimiter);

// Serve static files
app.get("/sitemap.xml", (req, res) => res.sendFile(join(__dirname, "sitemap.xml")));
app.get("/llms.txt", (req, res) => res.type("text/plain").sendFile(join(__dirname, "llms.txt")));
app.get("/humans.txt", (req, res) => res.type("text/plain").sendFile(join(__dirname, "humans.txt")));

// ---------------------------------------------------------------------------
// HTML Pages
// ---------------------------------------------------------------------------

// Dashboard: ecosystem-first landing page
app.get("/", async (req, res) => {
  try {
    const [lands, extensions, landCount, activeLands, extensionCount] = await Promise.all([
      Land.find({ status: { $ne: "dead" } })
        .sort({ lastSeenAt: -1 })
        .limit(6)
        .lean(),
      Extension.aggregate([
        { $sort: { name: 1, publishedAt: -1 } },
        { $group: { _id: "$name", latest: { $first: "$$ROOT" } } },
        { $replaceRoot: { newRoot: "$latest" } },
        { $sort: { downloads: -1, name: 1 } },
        { $limit: 50 },
        { $project: { name: 1, version: 1, description: 1, type: 1, builtFor: 1, authorDomain: 1, authorName: 1, tags: 1, downloads: 1, publishedAt: 1, npmDependencies: 1 } },
      ]),
      Land.countDocuments({ status: { $ne: "dead" } }),
      Land.countDocuments({ status: "active" }),
      Extension.distinct("name").then((r) => r.length),
    ]);

    const html = renderDashboard({
      lands,
      trees: [],
      extensions,
      stats: { landCount, treeCount: 0, activeLands, extensionCount },
    });

    res.setHeader("Content-Type", "text/html");
    res.send(html);
  } catch (err) {
    res.status(500).send("Horizon error: " + err.message);
  }
});

// Lands browse page
app.get("/lands", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const perPage = 25;
    const skip = (page - 1) * perPage;
    const sort = req.query.sort || "active";
    const q = req.query.q || "";

    const filter = { status: { $ne: "dead" } };
    if (q) {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { name: { $regex: escaped, $options: "i" } },
        { domain: { $regex: escaped, $options: "i" } },
      ];
    }

    const sortField = sort === "recent" ? { registeredAt: -1 } : { lastSeenAt: -1 };

    const [lands, total] = await Promise.all([
      Land.find(filter).sort(sortField).skip(skip).limit(perPage).lean(),
      Land.countDocuments(filter),
    ]);

    const html = renderLandsPage({ lands, total, page, sort, query: q });
    res.setHeader("Content-Type", "text/html");
    res.send(html);
  } catch (err) {
    res.status(500).send("Error: " + err.message);
  }
});

// Extensions browse page (MUST be before extensionRoutes mount to avoid :name collision)
app.get("/extensions/browse", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const perPage = 25;
    const offset = (page - 1) * perPage;
    const sort = req.query.sort || "downloaded";
    const type = req.query.type || "";
    const builtFor = req.query.builtFor || "";
    const q = req.query.q || "";

    const query = {};
    if (q) query.$text = { $search: q };
    if (type && ["extension", "bundle", "os"].includes(type)) query.type = type;
    if (builtFor) query.builtFor = builtFor;

    const sortStage = sort === "recent"
      ? { publishedAt: -1, name: 1 }
      : { downloads: -1, name: 1 };

    const pipeline = [
      { $match: query },
      { $sort: { name: 1, publishedAt: -1 } },
      { $group: { _id: "$name", latest: { $first: "$$ROOT" } } },
      { $replaceRoot: { newRoot: "$latest" } },
      { $sort: sortStage },
      { $skip: offset },
      { $limit: perPage },
      { $project: { name: 1, version: 1, description: 1, type: 1, builtFor: 1, authorDomain: 1, authorName: 1, tags: 1, downloads: 1, publishedAt: 1, npmDependencies: 1, includes: 1, bundles: 1, standalone: 1 } },
    ];

    const [extensions, total] = await Promise.all([
      Extension.aggregate(pipeline),
      Extension.distinct("name", query).then((r) => r.length),
    ]);

    const html = renderExtensionsBrowsePage({ extensions, total, page, sort, type, builtFor, query: q });
    res.setHeader("Content-Type", "text/html");
    res.send(html);
  } catch (err) {
    res.status(500).send("Error: " + err.message);
  }
});

// OS detail page
app.get("/os/:name", async (req, res) => {
  try {
    const { name } = req.params;
    const pkg = await Extension.findOne({ name, type: "os" }).sort({ publishedAt: -1 }).lean();
    if (!pkg) return res.status(404).send("OS not found");

    // Fetch bundle docs
    const bundleNames = (pkg.bundles || []).map((b) => b.split("@")[0]);
    const bundleDocs = [];
    if (bundleNames.length > 0) {
      const raw = await Extension.aggregate([
        { $match: { name: { $in: bundleNames } } },
        { $sort: { name: 1, publishedAt: -1 } },
        { $group: { _id: "$name", latest: { $first: "$$ROOT" } } },
        { $replaceRoot: { newRoot: "$latest" } },
        { $project: { name: 1, version: 1, description: 1, type: 1, builtFor: 1, authorDomain: 1, authorName: 1, downloads: 1, tags: 1, includes: 1, publishedAt: 1, npmDependencies: 1 } },
      ]);
      bundleDocs.push(...raw);
    }

    // Fetch standalone docs
    const standaloneNames = (pkg.standalone || []).map((s) => s.split("@")[0]);
    const standaloneDocs = [];
    if (standaloneNames.length > 0) {
      const raw = await Extension.aggregate([
        { $match: { name: { $in: standaloneNames } } },
        { $sort: { name: 1, publishedAt: -1 } },
        { $group: { _id: "$name", latest: { $first: "$$ROOT" } } },
        { $replaceRoot: { newRoot: "$latest" } },
        { $project: { name: 1, version: 1, description: 1, type: 1, builtFor: 1, authorDomain: 1, authorName: 1, downloads: 1, tags: 1, publishedAt: 1, npmDependencies: 1 } },
      ]);
      standaloneDocs.push(...raw);
    }

    // Fetch all extensions builtFor this OS (the ecosystem)
    const allMembers = await Extension.aggregate([
      { $match: { builtFor: name, name: { $ne: name } } },
      { $sort: { name: 1, publishedAt: -1 } },
      { $group: { _id: "$name", latest: { $first: "$$ROOT" } } },
      { $replaceRoot: { newRoot: "$latest" } },
      { $sort: { downloads: -1 } },
      { $limit: 50 },
      { $project: { name: 1, version: 1, description: 1, type: 1, builtFor: 1, authorDomain: 1, authorName: 1, downloads: 1, tags: 1, publishedAt: 1, npmDependencies: 1 } },
    ]);

    // Compute ecosystem stats
    const allEcoDocs = [...bundleDocs, ...standaloneDocs, ...allMembers];
    const uniqueNames = new Set(allEcoDocs.map((d) => d.name));
    const totalDownloads = allEcoDocs.reduce((sum, d) => sum + (d.downloads || 0), 0);
    const contributors = new Set(allEcoDocs.map((d) => d.authorDomain).filter(Boolean));
    const latestUpdate = allEcoDocs.reduce((latest, d) => {
      const dt = d.publishedAt ? new Date(d.publishedAt).getTime() : 0;
      return dt > latest ? dt : latest;
    }, 0);

    const stats = {
      totalDownloads,
      contributorCount: contributors.size,
      extensionCount: uniqueNames.size,
      lastUpdated: latestUpdate ? new Date(latestUpdate) : null,
    };

    const html = renderOsPage({ pkg, bundleDocs, standaloneDocs, allMembers, stats });
    res.setHeader("Content-Type", "text/html");
    res.send(html);
  } catch (err) {
    res.status(500).send("Error: " + err.message);
  }
});

// Bundle detail page
app.get("/bundle/:name", async (req, res) => {
  try {
    const { name } = req.params;
    const pkg = await Extension.findOne({ name, type: "bundle" }).sort({ publishedAt: -1 }).lean();
    if (!pkg) return res.status(404).send("Bundle not found");

    // Fetch member extension docs
    const memberNames = (pkg.includes || []).map((i) => i.split("@")[0]);
    const memberDocs = [];
    if (memberNames.length > 0) {
      const raw = await Extension.aggregate([
        { $match: { name: { $in: memberNames } } },
        { $sort: { name: 1, publishedAt: -1 } },
        { $group: { _id: "$name", latest: { $first: "$$ROOT" } } },
        { $replaceRoot: { newRoot: "$latest" } },
        { $project: { name: 1, version: 1, description: 1, type: 1, builtFor: 1, authorDomain: 1, authorName: 1, downloads: 1, tags: 1, publishedAt: 1, npmDependencies: 1 } },
      ]);
      memberDocs.push(...raw);
    }

    // Find OS distributions that include this bundle
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const dependentOsDocs = await Extension.aggregate([
      { $match: { type: "os", bundles: { $regex: `^${escapedName}(@|$)` } } },
      { $sort: { name: 1, publishedAt: -1 } },
      { $group: { _id: "$name", latest: { $first: "$$ROOT" } } },
      { $replaceRoot: { newRoot: "$latest" } },
      { $project: { name: 1, version: 1, description: 1, type: 1, builtFor: 1, authorDomain: 1, authorName: 1, downloads: 1, tags: 1, publishedAt: 1 } },
    ]);

    // Compute stats
    const totalDownloads = memberDocs.reduce((sum, d) => sum + (d.downloads || 0), 0);
    const contributors = new Set(memberDocs.map((d) => d.authorDomain).filter(Boolean));
    const latestUpdate = memberDocs.reduce((latest, d) => {
      const dt = d.publishedAt ? new Date(d.publishedAt).getTime() : 0;
      return dt > latest ? dt : latest;
    }, 0);

    const stats = {
      totalDownloads,
      contributorCount: contributors.size,
      extensionCount: memberDocs.length,
      lastUpdated: latestUpdate ? new Date(latestUpdate) : null,
    };

    const html = renderBundlePage({ pkg, memberDocs, dependentOsDocs, stats });
    res.setHeader("Content-Type", "text/html");
    res.send(html);
  } catch (err) {
    res.status(500).send("Error: " + err.message);
  }
});

// Extension detail page (handles all types, falls through to type-specific pages)
app.get("/extensions/:name/page", async (req, res) => {
  try {
    const { name } = req.params;
    const version = req.query.v || null;

    let ext;
    if (version) {
      ext = await Extension.findOne({ name, version }).lean();
    } else {
      ext = await Extension.findOne({ name }).sort({ publishedAt: -1 }).lean();
    }

    if (!ext) {
      return res.status(404).send("Extension not found");
    }

    // If it's an OS or bundle, redirect to the dedicated page
    if (ext.type === "os" && !version) {
      return res.redirect(`/os/${encodeURIComponent(name)}`);
    }
    if (ext.type === "bundle" && !version) {
      return res.redirect(`/bundle/${encodeURIComponent(name)}`);
    }

    const versions = await Extension.find({ name })
      .sort({ publishedAt: -1 })
      .select("version publishedAt downloads")
      .lean();

    // Fetch dependents
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const depPipeline = [
      {
        $match: {
          name: { $ne: name },
          $or: [
            { "manifest.needs.extensions": { $regex: `^${escapedName}(@|$)` } },
            { includes: { $regex: `^${escapedName}(@|$)` } },
            { bundles: { $regex: `^${escapedName}(@|$)` } },
            { standalone: { $regex: `^${escapedName}(@|$)` } },
          ],
        },
      },
      { $sort: { name: 1, publishedAt: -1 } },
      { $group: { _id: "$name", latest: { $first: "$$ROOT" } } },
      { $replaceRoot: { newRoot: "$latest" } },
      { $project: { name: 1, version: 1, type: 1, includes: 1, bundles: 1, standalone: 1, "manifest.needs.extensions": 1 } },
    ];
    const depResults = await Extension.aggregate(depPipeline);
    const dependents = depResults.map((r) => {
      let relationship = "needs";
      if ((r.includes || []).some((i) => i.split("@")[0] === name)) relationship = "includes";
      else if ((r.bundles || []).some((b) => b.split("@")[0] === name)) relationship = "bundles";
      else if ((r.standalone || []).some((s) => s.split("@")[0] === name)) relationship = "standalone";
      return { name: r.name, version: r.version, type: r.type || "extension", relationship };
    });

    // Ecosystem stats for bundles/OS viewed with ?v= (specific version)
    let ecosystem = null;
    if (ext.type === "os" || ext.type === "bundle") {
      const memberNames = ext.type === "bundle"
        ? (ext.includes || []).map((i) => i.split("@")[0])
        : [...(ext.bundles || []).map((b) => b.split("@")[0]), ...(ext.standalone || []).map((s) => s.split("@")[0])];

      if (memberNames.length > 0) {
        const memberDocs = await Extension.aggregate([
          { $match: { name: { $in: memberNames } } },
          { $sort: { name: 1, publishedAt: -1 } },
          { $group: { _id: "$name", latest: { $first: "$$ROOT" } } },
          { $replaceRoot: { newRoot: "$latest" } },
          { $project: { downloads: 1, authorDomain: 1, publishedAt: 1 } },
        ]);
        const totalDownloads = memberDocs.reduce((sum, d) => sum + (d.downloads || 0), 0);
        const contributors = new Set(memberDocs.map((d) => d.authorDomain).filter(Boolean));
        const latestUpdate = memberDocs.reduce((latest, d) => {
          const dt = d.publishedAt ? new Date(d.publishedAt).getTime() : 0;
          return dt > latest ? dt : latest;
        }, 0);
        ecosystem = {
          totalDownloads,
          contributorCount: contributors.size,
          extensionCount: memberDocs.length,
          lastUpdated: latestUpdate ? new Date(latestUpdate) : null,
        };
      }
    }

    const html = renderExtensionPage({ ext, versions, dependents, ecosystem });
    res.setHeader("Content-Type", "text/html");
    res.send(html);
  } catch (err) {
    res.status(500).send("Error: " + err.message);
  }
});

// ---------------------------------------------------------------------------
// API Routes
// ---------------------------------------------------------------------------

app.use("/horizon", horizonRoutes);
app.use("/extensions", extensionRoutes);

async function start() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log("[Horizon] Connected to MongoDB");

    startHealthCheckJob();

    app.listen(PORT, () => {
      console.log(`[Horizon] Canopy Horizon running on port ${PORT}`);
    });
  } catch (err) {
    console.error("[Horizon] Failed to start:", err.message);
    process.exit(1);
  }
}

start();
