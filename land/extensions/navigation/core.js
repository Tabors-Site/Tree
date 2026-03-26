import { getUserMeta, setUserMeta } from "../../seed/tree/userMetadata.js";
import log from "../../seed/log.js";

let User, Node;

export function setModels(models) {
  User = models.User;
  Node = models.Node;
}

const MAX_RECENT = 5;

// ── Navigation roots (metadata.nav.roots) ──

/**
 * Get all root IDs for a user from metadata.nav.roots.
 * Returns array of root ID strings.
 */
export async function getUserRoots(userId) {
  if (!userId) return [];
  const user = await User.findById(userId).select("metadata").lean();
  if (!user) return [];
  const nav = getUserMeta(user, "nav");
  return Array.isArray(nav.roots) ? nav.roots : [];
}

/**
 * Get roots with resolved names for API/rendering.
 * Returns array of { _id, name, visibility }.
 */
export async function getUserRootsWithNames(userId) {
  const rootIds = await getUserRoots(userId);
  if (rootIds.length === 0) return [];

  const nodes = await Node.find({ _id: { $in: rootIds } })
    .select("_id name visibility")
    .lean();

  const nodeMap = new Map(nodes.map(n => [n._id.toString(), n]));

  // Preserve order, filter out deleted/missing nodes
  return rootIds
    .map(id => nodeMap.get(id))
    .filter(Boolean)
    .map(n => ({ _id: n._id.toString(), name: n.name, visibility: n.visibility }));
}

/**
 * Add a root to a user's navigation list.
 */
export async function addRoot(userId, rootId) {
  if (!userId || !rootId) return;
  const user = await User.findById(userId);
  if (!user) return;

  const nav = getUserMeta(user, "nav");
  let roots = Array.isArray(nav.roots) ? nav.roots : [];

  const id = rootId.toString();
  if (!roots.includes(id)) {
    roots.push(id);
    nav.roots = roots;
    setUserMeta(user, "nav", nav);
    await user.save();
  }
}

/**
 * Remove a root from a user's navigation list.
 */
export async function removeRoot(userId, rootId) {
  if (!userId || !rootId) return;
  const user = await User.findById(userId);
  if (!user) return;

  const nav = getUserMeta(user, "nav");
  let roots = Array.isArray(nav.roots) ? nav.roots : [];

  const id = rootId.toString();
  const filtered = roots.filter(r => r !== id);
  if (filtered.length !== roots.length) {
    nav.roots = filtered;
    setUserMeta(user, "nav", nav);
    await user.save();
  }
}

// ── Recent roots (metadata.nav.recentRoots) ──

/**
 * Update recent roots in metadata.nav.recentRoots.
 * Pushes to front, deduplicates, keeps MAX_RECENT entries.
 */
export async function updateRecentRoots(userId, rootId) {
  if (!userId || !rootId) return;

  const node = await Node.findById(rootId).select("name").lean();
  if (!node) return;

  const user = await User.findById(userId);
  if (!user) return;

  const nav = getUserMeta(user, "nav");
  let recents = Array.isArray(nav.recentRoots) ? nav.recentRoots : [];

  // Remove existing entry for this root
  recents = recents.filter((r) => r.rootId !== rootId);

  // Add to front
  recents.unshift({
    rootId,
    rootName: node.name,
    lastVisitedAt: new Date(),
  });

  // Trim
  if (recents.length > MAX_RECENT) {
    recents = recents.slice(0, MAX_RECENT);
  }

  nav.recentRoots = recents;
  setUserMeta(user, "nav", nav);
  await user.save();
}

/**
 * Get recent roots for a user. Returns array of { rootId, rootName, lastVisitedAt }.
 */
export async function getRecentRootsByUserId(userId) {
  if (!userId) return [];
  const user = await User.findById(userId).select("metadata").lean();
  if (!user) return [];
  const nav = getUserMeta(user, "nav");
  return nav.recentRoots || [];
}

/**
 * Get recent roots with resolved names (names may have changed since stored).
 */
export async function getRecentRootsWithNames(userId) {
  const recents = await getRecentRootsByUserId(userId);
  return Promise.all(
    recents.map(async (r) => {
      let name = r.rootName;
      try {
        const node = await Node.findById(r.rootId).select("name").lean();
        if (node) name = node.name;
      } catch (err) { log.debug("Navigation", "recent root name lookup failed:", err.message); }
      return {
        rootId: r.rootId,
        name: name || r.rootId.slice(0, 8) + "...",
        lastVisitedAt: r.lastVisitedAt,
      };
    }),
  );
}

// ── Boot migration ──

/**
 * One-time migration: copy User.roots (old schema field) to metadata.nav.roots.
 * Uses lean() which returns raw MongoDB fields even if not in Mongoose schema.
 * Runs once at extension init. Idempotent.
 */
export async function migrateRootsToMetadata() {
  // Find users that have the old roots[] field populated but no metadata.nav.roots
  const users = await User.find({}).select("_id metadata").lean();
  let migrated = 0;

  for (const u of users) {
    const nav = getUserMeta(u, "nav");

    // If nav.roots already exists, skip (already migrated)
    if (Array.isArray(nav.roots) && nav.roots.length > 0) continue;

    // Read the raw roots field from MongoDB (may not be in schema anymore)
    // lean() returns raw document, so old fields are still visible
    const raw = await User.collection.findOne(
      { _id: u._id },
      { projection: { roots: 1 } },
    );

    if (!raw?.roots || !Array.isArray(raw.roots) || raw.roots.length === 0) continue;

    // Copy to metadata.nav.roots
    const user = await User.findById(u._id);
    if (!user) continue;

    const freshNav = getUserMeta(user, "nav");
    freshNav.roots = raw.roots.map(String);
    setUserMeta(user, "nav", freshNav);
    await user.save();
    migrated++;
  }

  return migrated;
}
