import { Router } from "express";
import crypto from "crypto";
import Extension from "../db/models/extension.js";
import ExtensionTombstone from "../db/models/extensionTombstone.js";
import Land from "../db/models/land.js";
import { verifyHorizonAuth } from "../auth.js";

// ---------------------------------------------------------------------------
// Semver utilities (mirrored from land/extensions/loader.js)
// ---------------------------------------------------------------------------

function parseDepString(dep) {
  const atIdx = dep.indexOf("@");
  if (atIdx <= 0) return { name: dep, constraint: null };
  return { name: dep.slice(0, atIdx), constraint: dep.slice(atIdx + 1) };
}

function parseSemver(v) {
  const match = String(v).match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function semverSatisfies(version, constraint) {
  const v = parseSemver(version);
  if (!v) return true;

  if (constraint.includes("x")) {
    const parts = constraint.split(".");
    if (parts[0] !== "x" && Number(parts[0]) !== v[0]) return false;
    if (parts[1] && parts[1] !== "x" && Number(parts[1]) !== v[1]) return false;
    return true;
  }

  if (constraint.startsWith(">=")) {
    const c = parseSemver(constraint.slice(2));
    if (!c) return true;
    if (v[0] !== c[0]) return v[0] > c[0];
    if (v[1] !== c[1]) return v[1] > c[1];
    return v[2] >= c[2];
  }

  if (constraint.startsWith(">") && !constraint.startsWith(">=")) {
    const c = parseSemver(constraint.slice(1));
    if (!c) return true;
    if (v[0] !== c[0]) return v[0] > c[0];
    if (v[1] !== c[1]) return v[1] > c[1];
    return v[2] > c[2];
  }

  if (constraint.startsWith("^")) {
    const c = parseSemver(constraint.slice(1));
    if (!c) return true;
    if (v[0] !== c[0]) return false;
    if (v[1] !== c[1]) return v[1] > c[1];
    return v[2] >= c[2];
  }

  const exact = constraint.startsWith("=") ? constraint.slice(1) : constraint;
  const c = parseSemver(exact);
  if (!c) return true;
  return v[0] === c[0] && v[1] === c[1] && v[2] === c[2];
}

/**
 * Validate that all required extension dependencies (manifest.needs.extensions)
 * exist in the directory. Optional dependencies are skipped.
 *
 * Returns { valid: true } or { valid: false, missing: [...] }
 */
async function validateRequiredDeps(manifest) {
  const requiredDeps = manifest?.needs?.extensions;
  if (!Array.isArray(requiredDeps) || requiredDeps.length === 0) {
    return { valid: true };
  }

  const missing = [];

  for (const dep of requiredDeps) {
    const { name, constraint } = parseDepString(dep);

    // Find all published versions of this dependency
    const versions = await Extension.find({ name }).select("version").lean();

    if (versions.length === 0) {
      missing.push({ dep, reason: `dependency "${name}" not found in directory` });
      continue;
    }

    // If a version constraint is specified, check that at least one version satisfies it
    if (constraint) {
      const satisfied = versions.some((v) => semverSatisfies(v.version, constraint));
      if (!satisfied) {
        const available = versions.map((v) => v.version).join(", ");
        missing.push({ dep, reason: `no published version of "${name}" satisfies "${constraint}" (available: ${available})` });
      }
    }
  }

  if (missing.length > 0) {
    return { valid: false, missing };
  }
  return { valid: true };
}

// ---------------------------------------------------------------------------
// Name and version validation
// ---------------------------------------------------------------------------

// Lowercase alphanumeric + hyphens, 2-50 chars, starts with letter, no double hyphens, no trailing hyphen
const NAME_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const NAME_MIN = 2;
const NAME_MAX = 50;

function validateName(name) {
  if (typeof name !== "string") return "name must be a string";
  if (name.length < NAME_MIN) return `name must be at least ${NAME_MIN} characters`;
  if (name.length > NAME_MAX) return `name must be at most ${NAME_MAX} characters`;
  if (!NAME_RE.test(name)) return "name must be lowercase alphanumeric with hyphens, start with a letter, no consecutive or trailing hyphens";
  return null;
}

function validateVersion(version) {
  if (typeof version !== "string") return "version must be a string";
  if (!parseSemver(version)) return `version "${version}" is not valid semver (expected X.Y.Z)`;
  return null;
}

// ---------------------------------------------------------------------------
// Reserved names: kernel components and built-in extensions that ship with
// every land. Prevents confusion and impersonation on the public registry.
// ---------------------------------------------------------------------------

const RESERVED_NAMES = new Set([
  // Kernel / core terms
  "seed", "kernel", "treeos", "treeos-base", "canopy", "horizon", "core", "land", "tree",
  // Built-in extensions that ship with the reference implementation
  "tree-orchestrator", "land-manager",
  // Loader internals
  "loader", "_template",
]);

// ---------------------------------------------------------------------------
// Typosquatting detection (Levenshtein distance)
// ---------------------------------------------------------------------------

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/**
 * Check if a new extension name is suspiciously similar to existing names.
 * Only runs for brand new names (first publish). Threshold: distance 1 for
 * short names (<8 chars), distance 2 for longer names.
 */
async function checkTyposquatting(name) {
  // Get all distinct published extension names
  const existingNames = await Extension.distinct("name");

  const threshold = name.length < 8 ? 1 : 2;
  const suspicious = [];

  for (const existing of existingNames) {
    // Skip exact match (same name is fine, ownership check handles it)
    if (existing === name) continue;
    const dist = levenshtein(name, existing);
    if (dist <= threshold) {
      suspicious.push(existing);
    }
  }

  // Also check against reserved names
  for (const reserved of RESERVED_NAMES) {
    if (reserved === name) continue;
    const dist = levenshtein(name, reserved);
    if (dist <= threshold) {
      suspicious.push(`${reserved} (reserved)`);
    }
  }

  return suspicious;
}

// ---------------------------------------------------------------------------
// File path sanitization
// ---------------------------------------------------------------------------

function validateFilePaths(files) {
  const errors = [];
  for (const file of files) {
    const p = file.path;
    if (typeof p !== "string" || p.length === 0) {
      errors.push("empty file path");
      continue;
    }
    // No absolute paths
    if (p.startsWith("/") || p.startsWith("\\")) {
      errors.push(`absolute path not allowed: "${p}"`);
    }
    // No traversal
    if (p.includes("..")) {
      errors.push(`path traversal not allowed: "${p}"`);
    }
    // No null bytes
    if (p.includes("\0")) {
      errors.push(`null byte in path: "${p}"`);
    }
    // Reasonable length
    if (p.length > 256) {
      errors.push(`path too long (${p.length} chars): "${p.slice(0, 40)}..."`);
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Name ownership: the first land to publish a name owns it
// ---------------------------------------------------------------------------

async function checkNameOwnership(name, landId, landDomain) {
  const existing = await Extension.findOne({ name }).select("authorLandId maintainers").lean();
  if (!existing) return null; // New name, no conflict
  const isAuthor = existing.authorLandId === landId;
  const isMaintainer = landDomain && (existing.maintainers || []).includes(landDomain);
  if (!isAuthor && !isMaintainer) {
    return `extension "${name}" is owned by another land. Only the author or maintainers can publish new versions.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Content limits
// ---------------------------------------------------------------------------

const MAX_DESCRIPTION_LENGTH = 10000;
const MAX_README_LENGTH = 100000; // 100KB
const MAX_TAG_LENGTH = 30;
const MAX_TAGS = 20;
const MAX_FILES = 200;
const MAX_MANIFEST_BYTES = 50000; // 50KB serialized manifest
const MAX_VERSIONS_PER_NAME = 100; // Prevent version flooding
const MAX_PACKAGES_PER_LAND = 200; // Prevent spam publishing

function validateContentLimits(manifest, files, readme, tags) {
  const errors = [];
  // Manifest is stored as Mixed. Cap the serialized size.
  const manifestSize = JSON.stringify(manifest).length;
  if (manifestSize > MAX_MANIFEST_BYTES) {
    errors.push(`manifest exceeds ${MAX_MANIFEST_BYTES} bytes when serialized (got ${manifestSize})`);
  }
  if (manifest.description && manifest.description.length > MAX_DESCRIPTION_LENGTH) {
    errors.push(`description exceeds ${MAX_DESCRIPTION_LENGTH} characters`);
  }
  if (readme && readme.length > MAX_README_LENGTH) {
    errors.push(`readme exceeds ${MAX_README_LENGTH} characters`);
  }
  if (tags) {
    if (!Array.isArray(tags)) {
      errors.push("tags must be an array");
    } else {
      if (tags.length > MAX_TAGS) errors.push(`maximum ${MAX_TAGS} tags allowed`);
      for (const tag of tags) {
        if (typeof tag !== "string") errors.push("each tag must be a string");
        else if (tag.length > MAX_TAG_LENGTH) errors.push(`tag "${tag.slice(0, 10)}..." exceeds ${MAX_TAG_LENGTH} characters`);
        else if (!NAME_RE.test(tag)) errors.push(`tag "${tag}" must be lowercase alphanumeric with hyphens`);
      }
    }
  }
  if (files.length > MAX_FILES) {
    errors.push(`maximum ${MAX_FILES} files allowed (got ${files.length})`);
  }
  return errors;
}

// ---------------------------------------------------------------------------

function computeChecksum(files) {
  const hash = crypto.createHash("sha256");
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(file.path);
    hash.update(file.content);
  }
  return hash.digest("hex");
}

/**
 * Middleware to extract land identity from verified canopy auth payload
 * and attach req.landId, req.landDomain, req.landName for route handlers.
 */
function attachLandIdentity() {
  return async (req, res, next) => {
    const payload = req.canopyAuth?.payload;
    if (!payload) {
      return res.status(401).json({ error: "No auth payload" });
    }
    req.landId = payload.landId;
    req.landDomain = payload.iss || "";

    // Look up the land name from the registry
    if (req.landDomain) {
      const land = await Land.findOne({ domain: req.landDomain }).select("name").lean();
      req.landName = land?.name || "";
    } else {
      req.landName = "";
    }
    next();
  };
}

const router = Router();

/**
 * GET /extensions
 * List available packages. Supports search, type filter, builtFor filter, sort, ecosystem.
 *
 * Query params:
 *   q         - text search
 *   tag       - filter by tag
 *   author    - filter by author domain
 *   type      - "extension", "bundle", "os"
 *   builtFor  - "kernel" or a specific OS/bundle name
 *   sort      - "downloaded" (default), "recent"
 *   ecosystem - OS name: returns everything with builtFor matching this OS
 *   limit     - max results (default 50, max 100)
 *   offset    - skip N results
 */
router.get("/", async (req, res) => {
  try {
    const { q, tag, author, type, builtFor, sort, ecosystem, limit = 50, offset = 0 } = req.query;

    let query = {};

    if (q) {
      query.$text = { $search: q };
    }

    if (tag) {
      query.tags = tag;
    }

    if (author) {
      query.authorDomain = author;
    }

    if (type && ["extension", "bundle", "os"].includes(type)) {
      query.type = type;
    }

    if (builtFor) {
      query.builtFor = builtFor;
    }

    // Ecosystem shortcut: all packages built for this OS
    if (ecosystem) {
      query.builtFor = ecosystem;
    }

    // Sort stage
    const sortStage = sort === "recent"
      ? { publishedAt: -1, name: 1 }
      : { downloads: -1, name: 1 };

    // Get latest version of each package
    const pipeline = [
      { $match: query },
      { $sort: { name: 1, publishedAt: -1 } },
      {
        $group: {
          _id: "$name",
          latest: { $first: "$$ROOT" },
        },
      },
      { $replaceRoot: { newRoot: "$latest" } },
      { $sort: sortStage },
      { $skip: Number(offset) },
      { $limit: Math.min(Number(limit), 100) },
      {
        $project: {
          name: 1,
          version: 1,
          description: 1,
          type: 1,
          builtFor: 1,
          includes: 1,
          bundles: 1,
          standalone: 1,
          authorDomain: 1,
          authorName: 1,
          tags: 1,
          downloads: 1,
          publishedAt: 1,
          npmDependencies: 1,
          "manifest.needs": 1,
          "manifest.optional": 1,
          "manifest.provides": 1,
        },
      },
    ];

    const extensions = await Extension.aggregate(pipeline);
    const total = await Extension.distinct("name", query).then((r) => r.length);

    res.json({ extensions, total });
  } catch (err) {
    console.error("Extension list error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /extensions/routes/check?path=/root/:rootId/calendar
 * Check if a route path is claimed by any published extension.
 * Returns the extension name if claimed, null if available.
 */
router.get("/routes/check", async (req, res) => {
  try {
    const { path: routePath } = req.query;
    if (!routePath) {
      return res.status(400).json({ error: "path query parameter required" });
    }

    // Search all extensions for this route in their manifest cli declarations or provides.routes
    const extensions = await Extension.find({}).lean();

    const claims = [];
    for (const ext of extensions) {
      const cliRoutes = ext.manifest?.provides?.cli || [];
      for (const cmd of cliRoutes) {
        if (cmd.endpoint === routePath) {
          claims.push({ extension: ext.name, version: ext.version, command: cmd.command });
        }
        // Check subcommand endpoints too
        if (cmd.subcommands) {
          for (const [action, sub] of Object.entries(cmd.subcommands)) {
            if (sub.endpoint === routePath) {
              claims.push({ extension: ext.name, version: ext.version, command: `${cmd.command.split(" ")[0]} ${action}` });
            }
          }
        }
      }
    }

    res.json({
      path: routePath,
      available: claims.length === 0,
      claims,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /extensions/:name
 * Get all versions of an extension.
 */
router.get("/:name", async (req, res) => {
  try {
    const { name } = req.params;

    const versions = await Extension.find({ name })
      .sort({ publishedAt: -1 })
      .select("name version description authorDomain authorName tags downloads publishedAt manifest readme")
      .lean();

    if (!versions.length) {
      return res.status(404).json({ error: "Extension not found" });
    }

    res.json({
      name,
      latest: versions[0],
      versions: versions.map((v) => ({
        version: v.version,
        publishedAt: v.publishedAt,
        downloads: v.downloads,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /extensions/:name/dependents
 * Returns all packages that depend on :name via needs.extensions, includes, bundles, or standalone.
 */
router.get("/:name/dependents", async (req, res) => {
  try {
    const { name } = req.params;
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Find latest version of each package that references this name
    const pipeline = [
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

    const results = await Extension.aggregate(pipeline);

    const dependents = results.map((r) => {
      let relationship = "needs";
      const includesMatch = (r.includes || []).some((i) => i.split("@")[0] === name);
      const bundlesMatch = (r.bundles || []).some((b) => b.split("@")[0] === name);
      const standaloneMatch = (r.standalone || []).some((s) => s.split("@")[0] === name);
      if (includesMatch) relationship = "includes";
      else if (bundlesMatch) relationship = "bundles";
      else if (standaloneMatch) relationship = "standalone";
      return { name: r.name, version: r.version, type: r.type || "extension", relationship };
    });

    res.json({ name, dependents, total: dependents.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /extensions/:name/ecosystem
 * For OS or bundle: returns member packages and aggregate stats.
 */
router.get("/:name/ecosystem", async (req, res) => {
  try {
    const { name } = req.params;

    // Get latest version
    const pkg = await Extension.findOne({ name }).sort({ publishedAt: -1 }).lean();
    if (!pkg) {
      return res.status(404).json({ error: "Package not found" });
    }

    const type = pkg.type || "extension";
    if (type !== "os" && type !== "bundle") {
      return res.status(400).json({ error: "Ecosystem stats are only available for OS and bundle packages" });
    }

    // Collect member names
    let memberNames = [];
    if (type === "bundle") {
      memberNames = (pkg.includes || []).map((i) => i.split("@")[0]);
    } else {
      // OS: collect from bundles (resolve each bundle's includes) and standalone
      const bundleNames = (pkg.bundles || []).map((b) => b.split("@")[0]);
      const standaloneNames = (pkg.standalone || []).map((s) => s.split("@")[0]);

      // Fetch bundle manifests to get their includes
      const bundleDocs = await Extension.find({ name: { $in: bundleNames }, type: "bundle" })
        .sort({ publishedAt: -1 })
        .lean();

      // Dedupe by name (take latest of each)
      const seen = new Set();
      for (const b of bundleDocs) {
        if (!seen.has(b.name)) {
          seen.add(b.name);
          const inc = (b.includes || []).map((i) => i.split("@")[0]);
          memberNames.push(...inc);
        }
      }
      memberNames.push(...bundleNames, ...standaloneNames);
    }

    // Also include anything with builtFor = this name
    const builtForQuery = { builtFor: name, name: { $ne: name } };
    const builtForDocs = await Extension.find(builtForQuery)
      .sort({ name: 1, publishedAt: -1 })
      .lean();

    const builtForNames = [];
    const builtForSeen = new Set();
    for (const d of builtForDocs) {
      if (!builtForSeen.has(d.name)) {
        builtForSeen.add(d.name);
        builtForNames.push(d.name);
      }
    }

    const allNames = [...new Set([...memberNames, ...builtForNames])];

    // Aggregate stats across all members
    const memberDocs = await Extension.aggregate([
      { $match: { name: { $in: allNames } } },
      { $sort: { name: 1, publishedAt: -1 } },
      { $group: { _id: "$name", latest: { $first: "$$ROOT" } } },
      { $replaceRoot: { newRoot: "$latest" } },
      { $project: { name: 1, version: 1, type: 1, builtFor: 1, downloads: 1, authorDomain: 1, publishedAt: 1, description: 1, tags: 1 } },
    ]);

    const totalDownloads = memberDocs.reduce((sum, d) => sum + (d.downloads || 0), 0);
    const contributors = new Set(memberDocs.map((d) => d.authorDomain).filter(Boolean));
    const latestUpdate = memberDocs.reduce((latest, d) => {
      const dt = d.publishedAt ? new Date(d.publishedAt).getTime() : 0;
      return dt > latest ? dt : latest;
    }, 0);

    res.json({
      name,
      type,
      stats: {
        totalDownloads,
        contributorCount: contributors.size,
        extensionCount: memberDocs.length,
        lastUpdated: latestUpdate ? new Date(latestUpdate) : null,
      },
      members: memberDocs,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /extensions/:name/:version
 * Get a specific version with full file contents for installation.
 * Download count is deduplicated per IP per extension per hour to prevent inflation.
 */
const downloadSeen = new Map(); // key -> timestamp. Pruned lazily.
const DOWNLOAD_WINDOW_MS = 60 * 60 * 1000; // 1 hour

router.get("/:name/:version(\\d+\\.\\d+\\.\\d+.*)", async (req, res) => {
  try {
    const { name, version } = req.params;

    const ext = await Extension.findOne({ name, version }).lean();
    if (!ext) {
      return res.status(404).json({ error: "Extension version not found" });
    }

    // Deduplicate download count: same IP + same extension = one count per hour
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    const dedupKey = `${ip}:${name}:${version}`;
    const now = Date.now();
    const lastSeen = downloadSeen.get(dedupKey);

    if (!lastSeen || now - lastSeen > DOWNLOAD_WINDOW_MS) {
      downloadSeen.set(dedupKey, now);
      await Extension.updateOne({ _id: ext._id }, { $inc: { downloads: 1 } });

      // Lazy prune: clear old entries when map gets large
      if (downloadSeen.size > 10000) {
        for (const [key, ts] of downloadSeen) {
          if (now - ts > DOWNLOAD_WINDOW_MS) downloadSeen.delete(key);
        }
      }
    }

    res.json({
      name: ext.name,
      version: ext.version,
      description: ext.description,
      manifest: ext.manifest,
      files: ext.files,
      checksum: ext.checksum || null,
      repoUrl: ext.repoUrl,
      tarballUrl: ext.tarballUrl,
      readme: ext.readme,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /extensions
 * Publish an extension. Requires land authentication.
 * Body: { manifest, files, readme, tags, repoUrl }
 *
 * Validation order:
 *   1. Structural  (manifest exists, files exist)
 *   2. Format      (name regex, semver, paths, content limits)
 *   3. Policy      (reserved names, ownership, typosquatting, deps)
 *   4. Persistence (upsert)
 */
router.post("/", verifyHorizonAuth(), attachLandIdentity(), async (req, res) => {
  try {
    const { manifest, files, readme, tags, repoUrl, maintainers } = req.body;

    // -----------------------------------------------------------------------
    // 1. Structural checks
    // -----------------------------------------------------------------------

    if (!manifest || !manifest.name || !manifest.version) {
      return res.status(400).json({ error: "manifest with name and version is required" });
    }

    const pkgType = ["extension", "bundle", "os"].includes(manifest.type) ? manifest.type : "extension";

    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: "files array is required (at least manifest.js)" });
    }

    const filePaths = new Set(files.map((f) => f.path));
    if (!filePaths.has("manifest.js")) {
      return res.status(400).json({ error: "manifest.js is required in files" });
    }

    // Extensions must have index.js. Bundles and OS are dependency groups with no code.
    if (pkgType === "extension" && !filePaths.has("index.js")) {
      return res.status(400).json({ error: "index.js is required in files for extensions" });
    }

    // Bundle must have includes with at least 2 entries
    if (pkgType === "bundle") {
      const includes = manifest.includes;
      if (!Array.isArray(includes) || includes.length < 2) {
        return res.status(400).json({ error: "bundles must have an 'includes' array with at least 2 extensions" });
      }
    }

    // OS must have at least one of bundles or standalone
    if (pkgType === "os") {
      const hasBundles = Array.isArray(manifest.bundles) && manifest.bundles.length > 0;
      const hasStandalone = Array.isArray(manifest.standalone) && manifest.standalone.length > 0;
      if (!hasBundles && !hasStandalone) {
        return res.status(400).json({ error: "OS manifests must have at least one of 'bundles' or 'standalone'" });
      }
    }

    // -----------------------------------------------------------------------
    // 2. Format validation
    // -----------------------------------------------------------------------

    const nameErr = validateName(manifest.name);
    if (nameErr) {
      return res.status(400).json({ error: nameErr });
    }

    const versionErr = validateVersion(manifest.version);
    if (versionErr) {
      return res.status(400).json({ error: versionErr });
    }

    const pathErrors = validateFilePaths(files);
    if (pathErrors.length > 0) {
      return res.status(400).json({ error: "Invalid file paths", details: pathErrors });
    }

    const contentErrors = validateContentLimits(manifest, files, readme, tags);
    if (contentErrors.length > 0) {
      return res.status(400).json({ error: "Content validation failed", details: contentErrors });
    }

    // Size limit: 3MB total (large extensions like html-rendering have big template files)
    const totalSize = files.reduce((sum, f) => sum + (f.content?.length || 0), 0);
    if (totalSize > 3000000) {
      return res.status(400).json({ error: "Total file size exceeds 3MB limit" });
    }

    // -----------------------------------------------------------------------
    // 3. Policy checks
    // -----------------------------------------------------------------------

    // Reserved names: kernel, core, and built-in extensions
    if (RESERVED_NAMES.has(manifest.name)) {
      return res.status(403).json({ error: `"${manifest.name}" is a reserved name and cannot be published` });
    }

    // Name ownership: first publisher owns the name
    const ownershipErr = await checkNameOwnership(manifest.name, req.landId, req.landDomain);
    if (ownershipErr) {
      return res.status(403).json({ error: ownershipErr });
    }

    // Typosquatting: only for brand new names (no existing versions)
    const existingAny = await Extension.findOne({ name: manifest.name }).select("_id").lean();
    if (!existingAny) {
      const suspicious = await checkTyposquatting(manifest.name);
      if (suspicious.length > 0) {
        return res.status(409).json({
          error: `Name "${manifest.name}" is suspiciously similar to existing extensions: ${suspicious.join(", ")}. If this is intentional, contact the directory maintainers.`,
        });
      }
    }

    // Required extension dependencies must exist in the directory
    const depCheck = await validateRequiredDeps(manifest);
    if (!depCheck.valid) {
      const reasons = depCheck.missing.map((m) => m.reason);
      return res.status(400).json({
        error: "Required extension dependencies not found in directory",
        missing: reasons,
      });
    }

    // Maintainer validation: all listed domains must be registered lands
    if (maintainers && Array.isArray(maintainers) && maintainers.length > 0) {
      const registeredLands = await Land.find({ domain: { $in: maintainers } }).select("domain").lean();
      const registeredDomains = new Set(registeredLands.map((l) => l.domain));
      const unregistered = maintainers.filter((m) => !registeredDomains.has(m));
      if (unregistered.length > 0) {
        return res.status(400).json({
          error: `Maintainer domains not found in directory: ${unregistered.join(", ")}. Only registered lands can be maintainers.`,
        });
      }
    }

    // Per-land package cap: prevent one land from flooding the directory
    const landPackageCount = await Extension.distinct("name", { authorLandId: req.landId });
    if (!existingAny && landPackageCount.length >= MAX_PACKAGES_PER_LAND) {
      return res.status(429).json({
        error: `Your land has reached the maximum of ${MAX_PACKAGES_PER_LAND} unique packages. Unpublish unused packages before publishing new ones.`,
      });
    }

    // -----------------------------------------------------------------------
    // 4. Persist (versions are immutable once published)
    // -----------------------------------------------------------------------

    // Immutable versions: once published, code cannot be replaced.
    // Publish a new version instead. This prevents silent supply chain injection.
    const existing = await Extension.findOne({
      name: manifest.name,
      version: manifest.version,
    });

    if (existing) {
      return res.status(409).json({
        error: `Version ${manifest.version} of "${manifest.name}" is already published. Versions are immutable. Publish a new version instead.`,
      });
    }

    // Burned version check: version numbers are append-only. Once a version
    // has been published and then unpublished, the version number is burned
    // forever. This closes the unpublish-republish loophole where an attacker
    // unpublishes, then republishes the same version with different code.
    const tombstone = await ExtensionTombstone.findOne({
      name: manifest.name,
      version: manifest.version,
    });

    if (tombstone) {
      return res.status(409).json({
        error: `Version ${manifest.version} of "${manifest.name}" was previously published and unpublished. Version numbers cannot be reused. Publish a new version instead.`,
      });
    }

    // Version flood protection: cap total versions per extension name
    const versionCount = await Extension.countDocuments({ name: manifest.name });
    if (versionCount >= MAX_VERSIONS_PER_NAME) {
      return res.status(400).json({
        error: `Extension "${manifest.name}" has reached the maximum of ${MAX_VERSIONS_PER_NAME} versions. Unpublish old versions before publishing new ones.`,
      });
    }

    const checksum = computeChecksum(files);
    const ext = new Extension({
      name: manifest.name,
      version: manifest.version,
      description: manifest.description || "",
      type: pkgType,
      builtFor: manifest.builtFor || "kernel",
      includes: pkgType === "bundle" ? (manifest.includes || []) : [],
      bundles: pkgType === "os" ? (manifest.bundles || []) : [],
      standalone: pkgType === "os" ? (manifest.standalone || []) : [],
      osConfig: pkgType === "os" ? (manifest.config || null) : null,
      osOrchestrators: pkgType === "os" ? (manifest.orchestrators || null) : null,
      authorLandId: req.landId,
      authorDomain: req.landDomain || "",
      authorName: req.landName || "",
      manifest,
      files,
      checksum,
      fileCount: files.length,
      totalBytes: files.reduce((sum, f) => sum + (f.content?.length || 0), 0),
      totalLines: files.reduce((sum, f) => sum + (f.content?.split("\n").length || 0), 0),
      readme: readme || "",
      tags: tags || [],
      repoUrl: repoUrl || null,
      maintainers: maintainers || [],
      npmDependencies: manifest.needs?.npm || [],
    });

    await ext.save();

    // Auto-create release note comment if releaseNotes provided
    const releaseNotes = req.body.releaseNotes;
    if (releaseNotes && typeof releaseNotes === "string" && releaseNotes.trim()) {
      try {
        await Comment.create({
          extensionName: manifest.name,
          extensionVersion: manifest.version,
          authorLandId: req.landId,
          authorDomain: req.landDomain || "",
          authorUsername: "",
          text: releaseNotes.trim().slice(0, 2000),
          type: "release",
        });
      } catch {}
    }

    res.status(201).json({
      published: true,
      name: manifest.name,
      version: manifest.version,
      checksum,
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: "This version already exists" });
    }
    console.error("Extension publish error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /extensions/:name/:version
 * Unpublish a version. Requires land authentication (author only).
 * Blocked if other published extensions have a hard dependency on this
 * extension and no other version would satisfy the constraint.
 */
router.delete("/:name/:version(\\d+\\.\\d+\\.\\d+.*)", verifyHorizonAuth(), attachLandIdentity(), async (req, res) => {
  try {
    const { name, version } = req.params;

    const ext = await Extension.findOne({ name, version });
    if (!ext) {
      return res.status(404).json({ error: "Extension version not found" });
    }

    const isAuthor = ext.authorLandId === req.landId;
    const isMaintainer = (ext.maintainers || []).includes(req.landDomain);
    if (!isAuthor && !isMaintainer) {
      return res.status(403).json({ error: "Only the author or maintainers can unpublish" });
    }

    // Check if removing this version would break any published extension's
    // required dependency. Only block if this is the LAST version that
    // satisfies the constraint (other versions of the same name may cover it).
    const otherVersions = await Extension.find({ name, version: { $ne: version } }).select("version").lean();

    // Find all extensions that depend on this name.
    // Escape name for regex safety (names are validated on publish, but
    // this param comes from the URL path, not a validated manifest).
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const dependents = await Extension.find({
      "manifest.needs.extensions": { $regex: `^${escapedName}(@|$)` },
      name: { $ne: name }, // skip self-deps
    }).select("name version manifest.needs.extensions").lean();

    const blocked = [];
    for (const dep of dependents) {
      const depEntries = dep.manifest?.needs?.extensions || [];
      for (const entry of depEntries) {
        const parsed = parseDepString(entry);
        if (parsed.name !== name) continue;

        if (!parsed.constraint) {
          // Bare dependency (no version constraint). Blocked only if this is the last version.
          if (otherVersions.length === 0) {
            blocked.push(`${dep.name}@${dep.version} requires "${name}"`);
          }
        } else {
          // Check if any remaining version satisfies the constraint
          const stillSatisfied = otherVersions.some((v) => semverSatisfies(v.version, parsed.constraint));
          if (!stillSatisfied) {
            blocked.push(`${dep.name}@${dep.version} requires "${entry}"`);
          }
        }
      }
    }

    if (blocked.length > 0) {
      return res.status(409).json({
        error: "Cannot unpublish: other extensions depend on this version",
        dependents: blocked,
      });
    }

    // Burn the version number. This tombstone is permanent: the same
    // name+version can never be republished, even by the original author.
    await ExtensionTombstone.findOneAndUpdate(
      { name, version },
      { name, version, checksum: ext.checksum, authorLandId: ext.authorLandId, unpublishedAt: new Date() },
      { upsert: true },
    );

    await ext.deleteOne();
    res.json({ unpublished: true, name, version });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =========================================================================
// COMMENTS & REACTIONS (land-verified via CanopyToken)
// =========================================================================

import Comment, { Reaction } from "../db/models/comment.js";

const MAX_COMMENTS_PER_LAND_PER_EXT = 3;  // per version. Prevents spam.
const MAX_COMMENTS_PER_LAND_PER_DAY = 20; // across all extensions. Global rate limit.

/**
 * GET /extensions/:name/comments
 * List comments and reaction counts. Public. No auth required.
 */
router.get("/:name/comments", async (req, res) => {
  try {
    const { name } = req.params;
    const version = req.query.version || null;

    const query = { extensionName: name };
    if (version) query.extensionVersion = version;

    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const [comments, total, stars, flags] = await Promise.all([
      Comment.find(query).sort({ createdAt: -1 }).skip(offset).limit(limit).lean(),
      Comment.countDocuments(query),
      Reaction.countDocuments({ extensionName: name, type: "star" }),
      Reaction.countDocuments({ extensionName: name, type: "flag" }),
    ]);

    res.json({ comments, total, limit, offset, stars, flags });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /extensions/:name/comments
 * Add a comment. Requires CanopyToken.
 * Rate limited: max 3 comments per land per extension version.
 * Max 20 comments per land per day across all extensions.
 */
router.post("/:name/comments", verifyHorizonAuth(), async (req, res) => {
  try {
    const { name } = req.params;
    const { text, version, username } = req.body;
    const { payload } = req.canopyAuth;

    if (!text || typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ error: "Comment text is required" });
    }
    if (text.length > 2000) {
      return res.status(400).json({ error: "Comment must be 2000 characters or fewer" });
    }

    // Verify extension exists
    const ext = await Extension.findOne({ name }).lean();
    if (!ext) return res.status(404).json({ error: `Extension "${name}" not found` });

    // Verify land is registered
    const land = await Land.findById(payload.landId);
    if (!land) return res.status(403).json({ error: "Your land must be registered on Horizon to comment" });

    // Rate limit: per extension version
    const perExtCount = await Comment.countDocuments({
      extensionName: name,
      extensionVersion: version || null,
      authorLandId: payload.landId,
      type: "comment",
    });
    if (perExtCount >= MAX_COMMENTS_PER_LAND_PER_EXT) {
      return res.status(429).json({ error: `Maximum ${MAX_COMMENTS_PER_LAND_PER_EXT} comments per land per extension version` });
    }

    // Rate limit: per day globally
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const dailyCount = await Comment.countDocuments({
      authorLandId: payload.landId,
      type: "comment",
      createdAt: { $gte: dayAgo },
    });
    if (dailyCount >= MAX_COMMENTS_PER_LAND_PER_DAY) {
      return res.status(429).json({ error: `Maximum ${MAX_COMMENTS_PER_LAND_PER_DAY} comments per land per day` });
    }

    const comment = await Comment.create({
      extensionName: name,
      extensionVersion: version || null,
      authorLandId: payload.landId,
      authorDomain: payload.iss || land.domain,
      authorUsername: username || "",
      text: text.trim(),
      type: "comment",
    });

    res.status(201).json({ created: true, comment });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /extensions/:name/comments/:commentId
 * Remove your own comment. Requires CanopyToken from the same land.
 */
router.delete("/:name/comments/:commentId", verifyHorizonAuth(), async (req, res) => {
  try {
    const { commentId } = req.params;
    const { payload } = req.canopyAuth;

    const comment = await Comment.findById(commentId);
    if (!comment) return res.status(404).json({ error: "Comment not found" });

    if (comment.authorLandId !== payload.landId) {
      return res.status(403).json({ error: "You can only delete your own comments" });
    }

    await comment.deleteOne();
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =========================================================================
// REACTIONS (star / flag, one per user per land per extension)
// =========================================================================

/**
 * GET /extensions/:name/reactions
 * Get reaction counts and whether the requesting land has reacted.
 * Public counts. Land-specific status requires CanopyToken.
 */
router.get("/:name/reactions", async (req, res) => {
  try {
    const { name } = req.params;
    const [stars, flags] = await Promise.all([
      Reaction.countDocuments({ extensionName: name, type: "star" }),
      Reaction.countDocuments({ extensionName: name, type: "flag" }),
    ]);
    res.json({ stars, flags });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /extensions/:name/react
 * Star or flag an extension. One per type per user per land.
 * Toggle: if already reacted, removes it.
 * Body: { type: "star"|"flag", username: "optional" }
 */
router.post("/:name/react", verifyHorizonAuth(), async (req, res) => {
  try {
    const { name } = req.params;
    const { type, username } = req.body;
    const { payload } = req.canopyAuth;

    if (!["star", "flag"].includes(type)) {
      return res.status(400).json({ error: "type must be 'star' or 'flag'" });
    }

    // Verify extension exists
    const ext = await Extension.findOne({ name }).lean();
    if (!ext) return res.status(404).json({ error: `Extension "${name}" not found` });

    // Verify land is registered (_id is the landId)
    const land = await Land.findById(payload.landId);
    if (!land) return res.status(403).json({ error: "Your land must be registered on Horizon" });

    // Can't star or flag your own extensions
    if (ext.authorLandId === payload.landId) {
      return res.status(403).json({ error: "Cannot star or flag your own extension" });
    }

    // Toggle: check if reaction exists
    const existing = await Reaction.findOne({
      extensionName: name,
      authorLandId: payload.landId,
      authorUsername: username || "",
      type,
    });

    if (existing) {
      await existing.deleteOne();
      return res.json({ toggled: "removed", type });
    }

    // Star and flag are mutually exclusive. Remove the other if it exists.
    const opposite = type === "star" ? "flag" : "star";
    await Reaction.deleteOne({
      extensionName: name,
      authorLandId: payload.landId,
      authorUsername: username || "",
      type: opposite,
    });

    await Reaction.create({
      extensionName: name,
      authorLandId: payload.landId,
      authorDomain: payload.iss || land.domain,
      authorUsername: username || "",
      type,
    });

    res.status(201).json({ toggled: "added", type });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: "Already reacted" });
    }
    res.status(500).json({ error: err.message });
  }
});

export default router;
