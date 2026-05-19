// TreeOS Seed . AGPL-3.0 . https://treeos.ai
import Being from "./models/being.js";
import Node from "./models/node.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import { escapeRegex } from "./utils.js";
import { getLandConfigValue } from "./landConfig.js";
import { getLandRootId } from "./landRoot.js";
import { ERR, ProtocolError } from "./protocol.js";
import log from "./log.js";

import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required. Run the setup wizard or add it to .env");
const JWT_SECRET = process.env.JWT_SECRET;

// ─────────────────────────────────────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────────────────────────────────────

const USERNAME_RE = /^[a-zA-Z0-9_-]{1,32}$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;

function validateUsername(username) {
  if (!username || typeof username !== "string") throw new ProtocolError(400, ERR.INVALID_INPUT, "Username is required");
  const trimmed = username.trim();
  if (!USERNAME_RE.test(trimmed)) {
    throw new ProtocolError(400, ERR.INVALID_INPUT, "Username may only contain letters, numbers, hyphens, and underscores (1-32 chars)");
  }
  return trimmed;
}

function validatePassword(password) {
  if (!password || typeof password !== "string") throw new ProtocolError(400, ERR.INVALID_INPUT, "Password is required");
  if (password.length < MIN_PASSWORD) throw new ProtocolError(400, ERR.INVALID_INPUT, `Password must be at least ${MIN_PASSWORD} characters`);
  if (password.length > MAX_PASSWORD) throw new ProtocolError(400, ERR.INVALID_INPUT, `Password must be ${MAX_PASSWORD} characters or fewer`);
}

// ─────────────────────────────────────────────────────────────────────────
// BEING CREATION
// ─────────────────────────────────────────────────────────────────────────

/**
 * Check if this is the first human being on the land.
 */
export async function isFirstBeing() {
  return (await Being.countDocuments({ operatingMode: "human" })) === 0;
}

/**
 * Predicate: does this being carry admin permissions? Admin is a role,
 * not a flag (see `project_admin_is_a_role`). A being is admin iff
 * `"admin"` is in `being.roles`.
 *
 * @param {object} being - Being doc OR lean object with a roles[] field
 * @returns {boolean}
 */
export function isAdmin(being) {
  return Array.isArray(being?.roles) && being.roles.includes("admin");
}

/**
 * Create the first being (admin) on a fresh land. Race-resilient: if
 * two concurrent registrations both pass the isFirstBeing() check,
 * only the earliest insertion keeps the admin role.
 */
export async function createFirstBeing(username, password) {
  const being = await createBeing(username, password, { roles: ["admin"] });

  const adminCount = await Being.countDocuments({ roles: "admin", operatingMode: "human" });
  if (adminCount > 1) {
    const earliest = await Being.findOne({ roles: "admin", operatingMode: "human" }).sort({ _id: 1 }).select("_id").lean();
    if (earliest && earliest._id.toString() !== being._id.toString()) {
      await Being.updateOne({ _id: being._id }, { $pull: { roles: "admin" } });
      being.roles = (being.roles || []).filter((r) => r !== "admin");
    }
  }

  return being;
}

/**
 * Create a being. Defaults to operatingMode="human" with a chosen
 * password. AI being creation calls this with opts.operatingMode="ai"
 * (typically with an auto-generated password) and opts.role/homePositionId.
 *
 * Password is hashed via Being schema's pre-save hook.
 */
export async function createBeing(username, password, opts = {}) {
  username = validateUsername(username);
  validatePassword(password);

  // Case-insensitive uniqueness check. Regex needed because Mongo
  // collation support varies across deployments. The unique index on
  // username is the safety net; this check produces a friendly error.
  const existing = await Being.findOne({
    username: { $regex: `^${escapeRegex(username)}$`, $options: "i" },
  });
  if (existing) throw new ProtocolError(409, ERR.RESOURCE_CONFLICT, "Username already taken");

  // Roles + defaultRole replace the legacy static `role` field.
  // - `opts.role` (singular) is the canonical input today: AI beings
  //   declare one role at creation; that becomes the default and the
  //   only entry in roles[]. Future composite beings may pass
  //   `opts.roles` and `opts.defaultRole` directly.
  // - Humans have empty roles[] at registration; they acquire roles
  //   later as they're granted (creator, ruler, etc.).
  let rolesList = [];
  let defaultRole = null;
  if (Array.isArray(opts.roles) && opts.roles.length > 0) {
    rolesList = opts.roles.slice();
    defaultRole = opts.defaultRole || rolesList[0];
  } else if (opts.role) {
    rolesList = [opts.role];
    defaultRole = opts.role;
  }

  const being = new Being({
    username,
    password,
    operatingMode: opts.operatingMode || "human",
    roles:       rolesList,
    defaultRole,
    // Being-tree parent. null is reserved for the land's single root
    // being (the first human who registers during setup). Every other
    // being chains back to that root through parentBeingId: auth and
    // land-manager are root's children, subsequent humans register
    // under the auth-being, Rulers are children of the being that
    // promoted them, and inner beings (Planner/Contractor/Foreman)
    // are children of their Ruler.
    //
    // The caller is responsible for $addToSet on parent.children
    // (atomic) right after this insert; createBeingWithHome does this
    // automatically for its callers, the routes/users register flow
    // does it inline for human registrations, and governing's
    // promoteToRuler does it for Ruler / inner-being spawns.
    parentBeingId: opts.parentBeingId || null,
    homePositionId: opts.homePositionId || null,
    // Every being starts "at home" — current position defaults to their
    // home unless the caller explicitly overrides. Navigation events
    // update this field via the position accessors in conversation.js.
    currentPositionId: opts.currentPositionId || opts.homePositionId || null,
    llmDefault: opts.llmDefault || null,
    isRemote: opts.isRemote || false,
    homeLand: opts.homeLand || null,
  });
  try {
    await being.save();
  } catch (err) {
    if (err.code === 11000) throw new ProtocolError(409, ERR.RESOURCE_CONFLICT, "Username already taken");
    throw err;
  }
  return being;
}

/**
 * Generate a unique username for a new AI being. Pattern:
 * <role><suffix>, retrying with a longer suffix on collision. Used by
 * extensions that scaffold AI beings (governing → ruler/planner/...).
 */
export async function generateUniqueName(role, opts = {}) {
  const base = String(role || "being").replace(/[^a-z0-9-]/gi, "").slice(0, 24);
  const attempts = opts.attempts || 8;
  for (let i = 0; i < attempts; i++) {
    const bits = 4 + i;
    const suffix = crypto.randomBytes(bits).toString("hex").slice(0, 6);
    const candidate = `${base}${suffix}`;
    const clash = await Being.findOne({
      username: { $regex: `^${escapeRegex(candidate)}$`, $options: "i" },
    }).select("_id").lean();
    if (!clash) return candidate;
  }
  // Last resort: full UUID slice
  return `${base}${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

// ─────────────────────────────────────────────────────────────────────────
// PASSWORD VERIFICATION
// ─────────────────────────────────────────────────────────────────────────

/**
 * Verify a password against a being's stored hash.
 * bcrypt is intentionally slow. Timeout prevents extreme cost factors
 * from blocking the event loop for extended periods.
 */
const BCRYPT_TIMEOUT_MS = 5000;

export async function verifyPassword(being, password) {
  if (!being?.password || !password) return false;
  let timer;
  try {
    return await Promise.race([
      bcrypt.compare(password, being.password),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Password verification timed out")), BCRYPT_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// TOKEN GENERATION
// ─────────────────────────────────────────────────────────────────────────

/**
 * Generate a JWT for a being.
 * Includes a unique jti for per-token revocation if needed.
 * Expiry is configurable via land config (default 30 days).
 */
export function generateToken(being) {
  const expiresIn = getLandConfigValue("jwtExpiryDays")
    ? `${Math.max(1, Math.min(Number(getLandConfigValue("jwtExpiryDays")), 365))}d`
    : "30d";

  return jwt.sign(
    {
      beingId: being._id,
      username: being.username,
      jti: crypto.randomUUID(),
    },
    JWT_SECRET,
    { expiresIn },
  );
}

// ─────────────────────────────────────────────────────────────────────────
// BEING LOOKUP
// ─────────────────────────────────────────────────────────────────────────

/**
 * Find a being by username (case-insensitive).
 */
export async function findBeingByUsername(username) {
  if (!username || typeof username !== "string") return null;
  return Being.findOne({
    username: { $regex: `^${escapeRegex(username.trim())}$`, $options: "i" },
  }).select("+password");
}

// ─────────────────────────────────────────────────────────────────────────
// UNIFIED BEING + HOME CREATION
//
// `createBeingWithHome` is the single kernel-level primitive for placing
// a being in the world with a home. Same operation handles every case:
//
//   - Human registration: operatingMode="human", homeParent=land root.
//     Creates the human's tree-root home territory.
//   - System beings (auth, land-manager, citizen): homeNodeId=land root.
//     No new node — the being just lives at the land root.
//   - Ruler promotion: homeNodeId=the ruler-scope node. Existing node,
//     no rootOwner change. beings.ruler.beingId stamped on it.
//   - Trio members (Planner, Contractor, Foreman): homeParent=ruler scope,
//     homeName/Type=role-specific. Fresh child node created; the role
//     template runs from the registry; the being lives at the new node.
//   - Worker leaf positions: same pattern as trio members.
//
// Atomic: rolls back the home node if being creation fails. The home
// node's rootOwner is set when the being is a human (the home is a
// real tree root); for AI beings it stays inherited (the home is a
// structural sub-node within someone else's tree).
// ─────────────────────────────────────────────────────────────────────────

/**
 * Create a being and place it in the world at a home Node.
 *
 * @param {object} opts
 * @param {"human"|"ai"} opts.operatingMode   required
 * @param {string} [opts.username]            required for human; auto-generated for ai if missing
 * @param {string} [opts.password]            required for human; auto-generated for ai if missing
 * @param {string} [opts.role]                required for ai
 * @param {string} [opts.llmDefault]
 * @param {string} [opts.homeNodeId]          use this existing Node as the home
 * @param {string} [opts.homeParent]          OR create a new child under this Node
 * @param {string} [opts.homeName]            name for the new home (defaults derived)
 * @param {string} [opts.homeType]            type for the new home (defaults derived)
 * @param {object} [opts.homeMetadata]        initial metadata for the new home Node
 * @param {function} [opts.scaffolding]       async ({being, home}) => {} for extra structure
 * @param {boolean} [opts.isRemote=false]
 * @param {string} [opts.homeLand=null]
 * @returns {Promise<{being: object, home: object}>}
 */
export async function createBeingWithHome(opts) {
  const {
    operatingMode,
    role         = null,
    llmDefault   = null,
    homeNodeId   = null,
    homeParent   = null,
    homeName     = null,
    homeType     = null,
    homeMetadata = null,
    scaffolding  = null,
    isRemote     = false,
    homeLand     = null,
    // Being-tree parent ([[project_substrate_as_universal_workspace]]).
    // When set, the new being is placed as a being-tree child of this
    // parent. Atomic update of parent.children handled by the caller
    // (the core.do dispatcher or direct caller).
    parentBeingId = null,
  } = opts || {};
  let { username, password } = opts || {};

  // ── Validate mode + required fields ──
  if (operatingMode !== "human" && operatingMode !== "ai") {
    throw new Error("createBeingWithHome requires operatingMode='human' or 'ai'");
  }
  if (operatingMode === "ai" && !role) {
    throw new Error("createBeingWithHome: AI beings require a role");
  }
  if (!homeNodeId && !homeParent) {
    throw new Error("createBeingWithHome requires either homeNodeId or homeParent");
  }

  // ── Resolve identity (auto-fill for AI) ──
  if (!username) {
    if (operatingMode === "ai") username = await generateUniqueName(role);
    else throw new ProtocolError(400, ERR.INVALID_INPUT, "Username is required");
  }
  if (!password) {
    if (operatingMode === "ai") password = crypto.randomBytes(32).toString("hex");
    else throw new ProtocolError(400, ERR.INVALID_INPUT, "Password is required");
  }

  // ── Resolve the home Node ──
  // Two paths:
  //   A. homeNodeId: use an existing Node as the home. No structural
  //      change to the tree.
  //   B. homeParent: create a new child Node under the given parent.
  //      Defaults for name/type come from the operating mode + role.
  let homeNode = null;
  let createdNewHome = false;

  if (homeNodeId) {
    homeNode = await Node.findById(homeNodeId);
    if (!homeNode) throw new Error(`createBeingWithHome: home node ${homeNodeId} not found`);
  } else {
    const parent = await Node.findById(homeParent).select("_id").lean();
    if (!parent) throw new Error(`createBeingWithHome: home parent ${homeParent} not found`);

    const resolvedName = homeName
      || (operatingMode === "human" ? `~${username}` : `${role}-home`);
    const resolvedType = homeType
      || (operatingMode === "human" ? "home-territory" : `${role}-home`);

    homeNode = await Node.create({
      _id:          uuidv4(),
      name:         resolvedName,
      type:         resolvedType,
      parent:       homeParent,
      rootOwner:    null,                  // set below for humans only
      contributors: [],
      ...(homeMetadata ? { metadata: homeMetadata } : {}),
    });
    await Node.updateOne(
      { _id: homeParent },
      { $addToSet: { children: homeNode._id } },
    );
    createdNewHome = true;
  }

  // ── Create the being, rolling back the home on failure ──
  let being;
  try {
    being = await createBeing(username, password, {
      operatingMode,
      role,
      homePositionId: String(homeNode._id),
      llmDefault,
      isRemote,
      homeLand,
      parentBeingId,
    });
  } catch (err) {
    if (createdNewHome) {
      try {
        await Node.deleteOne({ _id: homeNode._id });
        await Node.updateOne(
          { _id: homeParent },
          { $pull: { children: homeNode._id } },
        );
      } catch (rollbackErr) {
        log.warn("auth", `createBeingWithHome rollback failed: ${rollbackErr.message}`);
      }
    }
    throw err;
  }

  // ── Wire ownership on newly-created home nodes ──
  // Human home territories are tree roots (rootOwner = the being).
  // AI being homes are structural sub-nodes within someone else's tree;
  // they inherit access from the parent and leave rootOwner null.
  if (createdNewHome && operatingMode === "human") {
    await Node.updateOne(
      { _id: homeNode._id },
      { $set: { rootOwner: being._id } },
    );
    homeNode.rootOwner = being._id;
  }

  // ── Link into the being-tree parent's children list ──
  // The being itself carries parentBeingId; the parent also needs its
  // `children` array updated for fast downward walks. Atomic, idempotent.
  if (parentBeingId) {
    await Being.updateOne(
      { _id: parentBeingId },
      { $addToSet: { children: String(being._id) } },
    );
  }

  // ── Register the being home on the home Node ──
  // Skipped for humans — humans aren't surfaced as beings at their
  // own home. AI beings register under their role so the descriptor /
  // authorize / SUMMON can resolve the specific being instance.
  if (operatingMode === "ai" && role) {
    try {
      const { mergeExtMeta } = await import("./tree/extensionMetadata.js");
      await mergeExtMeta(homeNode, "beings", {
        [role]: {
          beingId:     String(being._id),
          installedAt: new Date().toISOString(),
          installedBy: "createBeingWithHome",
        },
      });
    } catch (err) {
      log.warn("auth", `createBeingWithHome: failed to register ${role} home: ${err.message}`);
    }
  }

  // ── Optional scaffolding (caller-supplied initial structure) ──
  if (typeof scaffolding === "function") {
    try {
      await scaffolding({ being, home: homeNode });
    } catch (err) {
      log.warn("auth", `createBeingWithHome scaffolding callback failed: ${err.message}`);
    }
  }

  return { being, home: homeNode };
}

// ─────────────────────────────────────────────────────────────────────────
// LEGACY HOME-TERRITORY HELPER
//
// Kept for the migration path; new callers should use
// createBeingWithHome instead. Creates a home Node for an already-
// existing being.
// ─────────────────────────────────────────────────────────────────────────

export async function createHomeTerritory(being, opts = {}) {
  if (!being?._id) throw new Error("createHomeTerritory requires a being");

  // Idempotent: if the being already has a real home Node, return it.
  if (being.homePositionId) {
    const existing = await Node.findById(being.homePositionId).lean();
    if (existing) return existing;
  }

  const landRootId = getLandRootId();
  if (!landRootId) {
    throw new Error("createHomeTerritory: land root not ready");
  }

  const parentId = opts.parentId || landRootId;
  const name = opts.name || `~${being.username}`;
  const type = opts.type || "home-territory";

  const home = await Node.create({
    _id: uuidv4(),
    name,
    type,
    parent: parentId,
    rootOwner: being._id,
    contributors: [],
    status: "active",
  });

  // Link parent's children list (mirrors createNode's behavior).
  await Node.updateOne({ _id: parentId }, { $addToSet: { children: home._id } });

  // Wire the home Node back onto the being.
  await Being.updateOne(
    { _id: being._id },
    { $set: { homePositionId: String(home._id) } },
  );
  being.homePositionId = String(home._id);

  return home;
}
