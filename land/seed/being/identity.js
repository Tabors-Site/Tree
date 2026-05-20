// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
import Being from "../models/being.js";
import Space from "../models/space.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import { escapeRegex } from "../system/utils.js";
import { getLandConfigValue } from "../landConfig.js";
import { getLandRootId } from "../landRoot.js";
import { ERR, ProtocolError } from "../ibp/protocol.js";
import log from "../system/log.js";

import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required. Run the setup wizard or add it to .env");
const JWT_SECRET = process.env.JWT_SECRET;

// ─────────────────────────────────────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────────────────────────────────────

const BEING_NAME_RE = /^[a-zA-Z0-9_-]{1,32}$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;

function validateName(name) {
  if (!name || typeof name !== "string") throw new ProtocolError(400, ERR.INVALID_INPUT, "Name is required");
  const trimmed = name.trim();
  if (!BEING_NAME_RE.test(trimmed)) {
    throw new ProtocolError(400, ERR.INVALID_INPUT, "Name may only contain letters, numbers, hyphens, and underscores (1-32 chars)");
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
 * Create the first human being on a fresh land. The seed-being already
 * exists by this point (planted by ensureLandRoot); callers pass its
 * id as opts.parentBeingId so the first human's being-tree parent is
 * the seed-being. Race-resilient: two concurrent first-run
 * registrations both pass isFirstBeing(); the earliest insertion wins.
 */
export async function createFirstBeing(username, password, opts = {}) {
  return createBeing(username, password, opts);
}

/**
 * Create a being. Defaults to operatingMode="human" with a chosen
 * password. LLM-driven being creation calls this with opts.operatingMode="llm"
 * (typically with an auto-generated password) and opts.role/homeSpace.
 *
 * Password is hashed via Being schema's pre-save hook.
 */
export async function createBeing(name, password, opts = {}) {
  name = validateName(name);
  validatePassword(password);

  // Case-insensitive uniqueness check. Regex needed because Mongo
  // collation support varies across deployments. The unique index on
  // `name` is the safety net; this check produces a friendly error.
  const existing = await Being.findOne({
    name: { $regex: `^${escapeRegex(name)}$`, $options: "i" },
  });
  if (existing) throw new ProtocolError(409, ERR.RESOURCE_CONFLICT, "Name already taken");

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
    name,
    password,
    operatingMode: opts.operatingMode || "human",
    roles:       rolesList,
    defaultRole,
    // Being-tree parent. parentBeingId: null is reserved for the
    // seed-being (the substrate's first identity, created during
    // ensureLandRoot). Every other being chains back to it: the four
    // land-system beings (auth, llm-assigner, land-manager, citizen)
    // and the first human all parent under the seed-being. Subsequent
    // humans register under @auth. Rulers are children of the being
    // that promoted them; inner beings (Planner/Contractor/Foreman)
    // are children of their Ruler.
    //
    // The caller is responsible for $addToSet on parent.children
    // (atomic) right after this insert; createBeingWithHome does this
    // automatically for its callers, the routes/users register flow
    // does it inline for human registrations, and governing's
    // promoteToRuler does it for Ruler / inner-being spawns.
    parentBeingId: opts.parentBeingId || null,
    homeSpace: opts.homeSpace || null,
    // Every being starts "at home" — current position defaults to their
    // home unless the caller explicitly overrides. Navigation events
    // update this field via the position accessors in conversation.js.
    currentSpace: opts.currentSpace || opts.homeSpace || null,
    llmDefault: opts.llmDefault || null,
    isRemote: opts.isRemote || false,
    homeLand: opts.homeLand || null,
  });
  try {
    await being.save();
  } catch (err) {
    if (err.code === 11000) throw new ProtocolError(409, ERR.RESOURCE_CONFLICT, "Name already taken");
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
      name: { $regex: `^${escapeRegex(candidate)}$`, $options: "i" },
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
 * Generate a session JWT for a being. Issued when the being claims an
 * identity (login / register / token re-claim); shipped to the client
 * as the session token (cookie or bearer header).
 *
 * Carries a unique `jti` so individual tokens can be revoked. Expiry
 * is configurable via land config (default 30 days).
 */
export function generateToken(being) {
  const expiresIn = getLandConfigValue("jwtExpiryDays")
    ? `${Math.max(1, Math.min(Number(getLandConfigValue("jwtExpiryDays")), 365))}d`
    : "30d";

  return jwt.sign(
    {
      beingId: being._id,
      name:    being.name,
      jti:     crypto.randomUUID(),
    },
    JWT_SECRET,
    { expiresIn },
  );
}

/**
 * Sign an internal server-to-server JWT. Used by the conversation
 * runtime to authorize tool calls against the local MCP server — the
 * token forwards the originating being's identity so the MCP layer
 * knows who the call is for.
 *
 * Distinct from `generateToken` (which issues session credentials to
 * clients): internal tokens are short-lived (24h default), have no
 * `jti`, and never leave the server. The MCP middleware
 * ([transports/http/middleware/authenticateMCP.js]) decodes them with
 * `decodeToken` and reads beingId + name.
 *
 * @param {object} args
 * @param {string} args.beingId
 * @param {string} args.name
 * @param {string} [args.clientSessionId]  optional correlation tag
 * @param {string} [args.expiresIn]        default "24h"
 */
export function signInternalToken({ beingId, name, clientSessionId, expiresIn = "24h" }) {
  if (!beingId) throw new Error("signInternalToken: `beingId` is required");
  const payload = {
    beingId: String(beingId),
    name:    name || null,
  };
  if (clientSessionId) payload.clientSessionId = clientSessionId;
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

/**
 * Cheap JWT decode. Returns `{ beingId, name, iat, jti }` on success,
 * `null` for missing or invalid tokens. Never throws.
 *
 * Use this when you only need to extract identity from a token (WS
 * connect, IBP HTTP adapter, MCP middleware). It does NOT verify the
 * being still exists or check token revocation — those are concerns
 * of `verifyTokenStrict` and the HTTP auth pipeline.
 */
export function decodeToken(token) {
  if (typeof token !== "string" || !token) return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return {
      beingId: decoded.beingId,
      name:    decoded.name,
      iat:     decoded.iat,
      jti:     decoded.jti,
    };
  } catch {
    return null;
  }
}

/**
 * Strict JWT verification. Decodes the token, looks up the Being to
 * confirm it still exists, and checks `metadata.auth.tokensInvalidBefore`
 * to reject tokens issued before the being's last revoke (e.g. after a
 * password change).
 *
 * Returns `{ beingId, name, jwt, being }` on success or `null` on any
 * failure (missing/invalid token, being deleted, token revoked). The
 * returned `being` is a lean Mongoose doc for callers that need it
 * (avoids a second lookup); pass `{ loadBeing: false }` to skip the
 * extra fetch (only the existence/revocation check still happens).
 */
export async function verifyTokenStrict(token, { loadBeing = true } = {}) {
  const decoded = decodeToken(token);
  if (!decoded) return null;

  const being = await Being.findById(decoded.beingId)
    .select(loadBeing ? undefined : "_id metadata")
    .lean();
  if (!being) return null;

  const authMeta = being.metadata instanceof Map
    ? being.metadata.get("auth")
    : being.metadata?.auth;
  if (authMeta?.tokensInvalidBefore) {
    const invalidBefore = new Date(authMeta.tokensInvalidBefore).getTime() / 1000;
    if (decoded.iat && decoded.iat < invalidBefore) return null;
  }

  return {
    beingId: decoded.beingId,
    name:    decoded.name,
    jwt:     token,
    being:   loadBeing ? being : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// BEING LOOKUP
// ─────────────────────────────────────────────────────────────────────────

/**
 * Find a being by name (case-insensitive).
 */
export async function findBeingByName(name) {
  if (!name || typeof name !== "string") return null;
  return Being.findOne({
    name: { $regex: `^${escapeRegex(name.trim())}$`, $options: "i" },
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
//   - System beings (auth, land-manager, citizen): homeSpace=land root.
//     No new node — the being just lives at the land root.
//   - Ruler promotion: homeSpace=the ruler-scope space. Existing space,
//     no rootOwner change. beings.ruler.beingId stamped on it.
//   - Trio members (Planner, Contractor, Foreman): homeParent=ruler scope,
//     homeName/Type=role-specific. Fresh child node created; the role
//     template runs from the registry; the being lives at the new node.
//   - Worker leaf positions: same pattern as trio members.
//
// Atomic: rolls back the home node if being creation fails. The home
// node's rootOwner is set when the being is a human (the home is a
// real tree root); for non-human beings it stays inherited (the home
// is a structural sub-node within someone else's tree).
// ─────────────────────────────────────────────────────────────────────────

/**
 * Create a being and place it in the world at a home Space.
 *
 * @param {object} opts
 * @param {"human"|"llm"|"scripted"|"mixed"} opts.operatingMode   required
 * @param {string} [opts.name]            required for human; auto-generated for ai if missing
 * @param {string} [opts.password]            required for human; auto-generated for ai if missing
 * @param {string} [opts.role]                required for ai
 * @param {string} [opts.llmDefault]
 * @param {string} [opts.homeSpace]           use this existing Space as the home
 * @param {string} [opts.homeParent]          OR create a new child under this Space
 * @param {string} [opts.homeName]            name for the new home (defaults derived)
 * @param {string} [opts.homeType]            type for the new home (defaults derived)
 * @param {object} [opts.homeMetadata]        initial metadata for the new home Space
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
    // `homeSpace` matches the schema field on Being. The caller passes
    // an existing Space's id and the being's `homeSpace` field is set
    // to it. Use `homeParent` instead to create a fresh child Space
    // under an existing parent.
    homeSpace    = null,
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
  // `name` is the new canonical opt name; `username` accepted as a
  // legacy alias for one transition while in-tree callers migrate.
  let { name, username, password } = opts || {};
  if (!name && username) name = username;

  // ── Validate mode + required fields ──
  if (operatingMode !== "human" && operatingMode !== "llm" && operatingMode !== "scripted" && operatingMode !== "mixed") {
    throw new Error("createBeingWithHome requires operatingMode='human' | 'llm' | 'scripted' | 'mixed'");
  }
  if (operatingMode !== "human" && !role) {
    throw new Error("createBeingWithHome: non-human beings require a role");
  }
  if (!homeSpace && !homeParent) {
    throw new Error("createBeingWithHome requires either homeSpace or homeParent");
  }

  // ── Resolve identity (auto-fill for non-human beings) ──
  if (!name) {
    if (operatingMode !== "human") name = await generateUniqueName(role);
    else throw new ProtocolError(400, ERR.INVALID_INPUT, "Name is required");
  }
  if (!password) {
    if (operatingMode !== "human") password = crypto.randomBytes(32).toString("hex");
    else throw new ProtocolError(400, ERR.INVALID_INPUT, "Password is required");
  }

  // ── Resolve the home Space ──
  // Two paths:
  //   A. homeSpace: use an existing Space as the home. No structural
  //      change to the tree.
  //   B. homeParent: create a new child Space under the given parent.
  //      Defaults for name/type come from the operating mode + role.
  let home = null;
  let createdNewHome = false;

  if (homeSpace) {
    home = await Space.findById(homeSpace);
    if (!home) throw new Error(`createBeingWithHome: home space ${homeSpace} not found`);
  } else {
    const parent = await Space.findById(homeParent).select("_id").lean();
    if (!parent) throw new Error(`createBeingWithHome: home parent ${homeParent} not found`);

    const resolvedName = homeName
      || (operatingMode === "human" ? `~${name}` : `${role}-home`);
    const resolvedType = homeType
      || (operatingMode === "human" ? "home-territory" : `${role}-home`);

    home = await Space.create({
      _id:          uuidv4(),
      name:         resolvedName,
      type:         resolvedType,
      parent:       homeParent,
      rootOwner:    null,                  // set below for humans only
      contributors: [],
      ...(homeMetadata ? { metadata: homeMetadata } : {}),
    });
    await Space.updateOne(
      { _id: homeParent },
      { $addToSet: { children: home._id } },
    );
    createdNewHome = true;
  }

  // ── Create the being, rolling back the home on failure ──
  let being;
  try {
    being = await createBeing(name, password, {
      operatingMode,
      role,
      homeSpace: String(home._id),
      llmDefault,
      isRemote,
      homeLand,
      parentBeingId,
    });
  } catch (err) {
    if (createdNewHome) {
      try {
        await Space.deleteOne({ _id: home._id });
        await Space.updateOne(
          { _id: homeParent },
          { $pull: { children: home._id } },
        );
      } catch (rollbackErr) {
        log.warn("auth", `createBeingWithHome rollback failed: ${rollbackErr.message}`);
      }
    }
    throw err;
  }

  // ── Wire ownership on newly-created home nodes ──
  // Human home territories are tree roots (rootOwner = the being).
  // Non-human being homes are structural sub-nodes within someone
  // else's tree; they inherit access from the parent and leave
  // rootOwner null.
  if (createdNewHome && operatingMode === "human") {
    await Space.updateOne(
      { _id: home._id },
      { $set: { rootOwner: being._id } },
    );
    home.rootOwner = being._id;
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

  // ── Register the being home on the home Space ──
  // Skipped for humans — humans aren't surfaced as beings at their
  // own home. Non-human beings register under their role so the
  // descriptor / authorize / SUMMON can resolve the specific being
  // instance.
  if (operatingMode !== "human" && role) {
    try {
      const { mergeExtMeta } = await import("../space/extensionMetadata.js");
      await mergeExtMeta(home, "beings", {
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
      await scaffolding({ being, home });
    } catch (err) {
      log.warn("auth", `createBeingWithHome scaffolding callback failed: ${err.message}`);
    }
  }

  return { being, home: homeSpace };
}

// ─────────────────────────────────────────────────────────────────────────
// LEGACY HOME-TERRITORY HELPER
//
// Kept for the migration path; new callers should use
// createBeingWithHome instead. Creates a home Space for an already-
// existing being.
// ─────────────────────────────────────────────────────────────────────────

export async function createHomeTerritory(being, opts = {}) {
  if (!being?._id) throw new Error("createHomeTerritory requires a being");

  // Idempotent: if the being already has a real home Space, return it.
  if (being.homeSpace) {
    const existing = await Space.findById(being.homeSpace).lean();
    if (existing) return existing;
  }

  const landRootId = getLandRootId();
  if (!landRootId) {
    throw new Error("createHomeTerritory: land root not ready");
  }

  const parentId = opts.parentId || landRootId;
  const name = opts.name || `~${being.name}`;
  const type = opts.type || "home-territory";

  const home = await Space.create({
    _id: uuidv4(),
    name,
    type,
    parent: parentId,
    rootOwner: being._id,
    contributors: [],
    status: "active",
  });

  // Link parent's children list (mirrors createSpace's behavior).
  await Space.updateOne({ _id: parentId }, { $addToSet: { children: home._id } });

  // Wire the home Space back onto the being.
  await Being.updateOne(
    { _id: being._id },
    { $set: { homeSpace: String(home._id) } },
  );
  being.homeSpace = String(home._id);

  return home;
}
