// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Identity. How I mint a Being.
//
// A being IS its identity row. This file holds the primitives that
// create that row, place it in the world with a home space, verify
// passwords, mint tokens, and look up beings by name. Everything else
// about a being (how it acts, how it thinks) lives in ibp/ and
// factory/. Here is only the "is."

import Being from "./being.js";
import Space from "../space/space.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import { escapeRegex } from "../../utils.js";
import { getRealityConfigValue } from "../../realityConfig.js";
import { IBP_ERR, IbpError } from "../../ibp/protocol.js";
import log from "../../seedReality/log.js";
import { emitFact, sealFacts } from "../../past/fact/facts.js";

if (!process.env.JWT_SECRET)
  throw new Error(
    "JWT_SECRET is required. Run the setup wizard or add it to .env",
  );
const JWT_SECRET = process.env.JWT_SECRET;

// ─────────────────────────────────────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────────────────────────────────────

const BEING_NAME_RE = /^[a-zA-Z0-9_-]{1,32}$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;

function validateName(name) {
  if (!name || typeof name !== "string")
    throw new IbpError(IBP_ERR.INVALID_INPUT, "Name is required");
  const trimmed = name.trim();
  if (!BEING_NAME_RE.test(trimmed)) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "Name may only contain letters, numbers, hyphens, and underscores (1-32 chars)");
  }
  return trimmed;
}

function validatePassword(password) {
  if (!password || typeof password !== "string")
    throw new IbpError(IBP_ERR.INVALID_INPUT, "Password is required");
  if (password.length < MIN_PASSWORD)
    throw new IbpError(IBP_ERR.INVALID_INPUT, `Password must be at least ${MIN_PASSWORD} characters`);
  if (password.length > MAX_PASSWORD)
    throw new IbpError(IBP_ERR.INVALID_INPUT, `Password must be ${MAX_PASSWORD} characters or fewer`);
}

// ─────────────────────────────────────────────────────────────────────────
// LOOKUPS
// ─────────────────────────────────────────────────────────────────────────

/**
 * Find the I_AM: the place's first Being row, the root of the
 * being-tree, identified by `parentBeingId: null`. Every other
 * being on the place chains back to it. Created during
 * `ensureSpaceRoot()`; absent only on a pre-bootstrap place.
 */
export async function findIAm() {
  return Being.findOne({ parentBeingId: null }).select("_id name").lean();
}

// Cached I_AM identity object suitable for `opts.identity` on verb
// calls. The I_AM has universal authority on its reality; seed-internal
// callers (DO-trigger fan-out, scheduled-wake tick, genesis
// scaffolding) pass this identity so `authorize` shorts to allow.
let _iAmIdentityCache = null;
export async function iAmIdentity() {
  if (_iAmIdentityCache) return _iAmIdentityCache;
  const row = await findIAm();
  if (!row) return null;
  _iAmIdentityCache = { beingId: String(row._id), name: row.name };
  return _iAmIdentityCache;
}

/**
 * Find the place's root operator — the first human who registered.
 * The I_AM precedes them; the operator is the first being whose
 * `operatingMode === "human"`. Returns null on a fresh reality before
 * any human has registered. Use this for "who runs this place"
 * checks (place-LLM config, root-only operations); use `findIAm()`
 * for "who is the substrate's identity" checks.
 */
export async function findRootOperator() {
  return Being.findOne({ operatingMode: "human" })
    .sort({ _id: 1 })
    .select("_id name")
    .lean();
}

/**
 * Check if this is the first human being on the place.
 */
export async function isFirstBeing() {
  return (await Being.countDocuments({ operatingMode: "human" })) === 0;
}

// ─────────────────────────────────────────────────────────────────────────
// BEING CREATION
// ─────────────────────────────────────────────────────────────────────────

// First human on a fresh reality. The I-Am already exists by this point
// (planted by ensureSpaceRoot); callers pass my id as opts.parentBeingId
// so the first human's being-tree parent is me. Race-resilient: two
// concurrent first-run registrations both pass isFirstBeing(); the
// earliest insertion wins via the unique index.
export async function createFirstBeing(name, password, opts = {}) {
  return createBeing(name, password, opts);
}

// Create a being. Fact-driven (Slice D, 2026-05-23). Hashes the
// password explicitly, stamps a be:register Fact with the full spec
// on the new being's reel, then reads back the row that eager-fold
// materialized via applyCreateBeing + initProjection. The pre-save
// bcrypt hook is retired (Slice E) — the fact path is the only path
// that creates Being rows now, and it pre-hashes before stamping.
//
// opts.actId threads the calling moment so the be:register Fact rides
// the caller's frame. Genesis flows (seedDelegates) pass null actId.
export async function createBeing(name, password, opts = {}) {
  name = validateName(name);
  validatePassword(password);

  // Case-insensitive uniqueness check. Regex because Mongo collation
  // support varies across deployments. The unique index on `name` is
  // the safety net; this check produces a friendly error first.
  const existing = await Being.findOne({
    name: { $regex: `^${escapeRegex(name)}$`, $options: "i" },
  });
  if (existing)
    throw new IbpError(IBP_ERR.RESOURCE_CONFLICT, "Name already taken");

  // Roles + defaultRole. opts.role (singular) is the common shape: AI
  // beings declare one role at creation; that becomes the default and
  // the only entry in roles[]. Composite beings pass roles[] +
  // defaultRole directly. Humans have empty roles[] at registration;
  // they acquire roles later as they're granted.
  let rolesList = [];
  let defaultRole = null;
  if (Array.isArray(opts.roles) && opts.roles.length > 0) {
    rolesList = opts.roles.slice();
    defaultRole = opts.defaultRole || rolesList[0];
  } else if (opts.role) {
    rolesList = [opts.role];
    defaultRole = opts.role;
  }

  // Hash the password manually so the fact carries the hashed value.
  // The reducer's applyCreateBeing reads spec.password verbatim and
  // applyProjection writes it via $set (which skips the pre-save hook).
  const salt = await bcrypt.genSalt(12);
  const hashedPassword = await bcrypt.hash(password, salt);

  const id = uuidv4();
  const spec = {
    name,
    password: hashedPassword,
    operatingMode: opts.operatingMode || "human",
    roles: rolesList,
    defaultRole,
    parentBeingId: opts.parentBeingId || null,
    homeSpace: opts.homeSpace || null,
    currentSpace: opts.currentSpace || opts.homeSpace || null,
    llmDefault: opts.llmDefault || null,
    isRemote: opts.isRemote || false,
    homeReality: opts.homeReality || null,
    qualities: {},
  };

  // Actor attribution. Default: self-stamp (the new being is its
  // own actor — the historical "identity acting on identity" pattern
  // that ensureIAm uses for the I-Am's very first Fact). For beings
  // created by another being (seed plants, operator-triggered
  // create-being flows), `opts.actor` overrides so the be:register
  // Fact records the CAUSE of this being's existence on the cause's
  // own audit (Fact.beingId is the actor; target.kind/target.id =
  // being/<newId> keeps the Fact on the new being's reel where the
  // reducer materializes the row).
  const actor = opts.actor || id;

  // ATOMIC BIRTH (math-pure, Phase 2): the be:register Fact joins the
  // calling moment's ΔF via emitFact. When inside a moment, the Fact
  // commits with the rest of the moment's ΔF + Act row in one Mongo
  // transaction — the seal is the unit of commit. When standalone
  // (boot/scaffold, no summonCtx), emitFact falls back to sealFacts
  // singleton — eager commit, row materializes immediately.
  //
  // Return shape depends on context:
  //   - In-moment: pending view ({ _id, ...spec, _pending: true }).
  //     The Being row doesn't exist in Mongo until sealAct commits
  //     the moment; callers that need the row read it after seal.
  //   - Standalone: full Mongoose document (Being.findById). The
  //     eager singleton commit ran the fold; the row exists.
  //
  // Callers inside a moment can read spec fields off the pending view
  // (name, operatingMode, roles, homeSpace, etc.). Schema-derived /
  // timestamp fields aren't on the pending view; defer those reads.
  try {
    await emitFact({
      verb:    "be",
      action:  "register",
      beingId: actor,
      target:  { kind: "being", id },
      params:  { spec },
      actId:   opts.actId || null,
    }, opts.summonCtx);
  } catch (err) {
    if (err.code === 11000)
      throw new IbpError(IBP_ERR.RESOURCE_CONFLICT, "Name already taken");
    throw err;
  }

  // In-moment: return the pending view. Row will exist after seal.
  if (opts.summonCtx) {
    return { _id: id, ...spec, _pending: true };
  }

  // Standalone: row exists now (sealFacts singleton committed).
  const being = await Being.findById(id);
  if (!being) {
    throw new Error(
      `createBeing: register Fact stamped but row ${id} not materialized`,
    );
  }
  return being;
}

/**
 * Generate a unique name for a new being. Pattern:
 * <role><suffix>, retrying with a longer suffix on collision. Used by
 * extensions that scaffold AI beings (governing → ruler/planner/...).
 */
export async function generateUniqueName(role, opts = {}) {
  const base = String(role || "being")
    .replace(/[^a-z0-9-]/gi, "")
    .slice(0, 24);
  const attempts = opts.attempts || 8;
  for (let i = 0; i < attempts; i++) {
    const bits = 4 + i;
    const suffix = crypto.randomBytes(bits).toString("hex").slice(0, 6);
    const candidate = `${base}${suffix}`;
    const clash = await Being.findOne({
      name: { $regex: `^${escapeRegex(candidate)}$`, $options: "i" },
    })
      .select("_id")
      .lean();
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
        timer = setTimeout(
          () => reject(new Error("Password verification timed out")),
          BCRYPT_TIMEOUT_MS,
        );
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
 * is configurable via place config (default 30 days).
 */
export function generateToken(being) {
  const expiresIn = getRealityConfigValue("jwtExpiryDays")
    ? `${Math.max(1, Math.min(Number(getRealityConfigValue("jwtExpiryDays")), 365))}d`
    : "30d";

  return jwt.sign(
    {
      beingId: being._id,
      name: being.name,
      jti: crypto.randomUUID(),
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
 * ([transports/http/middleware/authenticate.js]) decodes them with
 * `decodeToken` and reads beingId + name.
 *
 * @param {object} args
 * @param {string} args.beingId
 * @param {string} args.name
 * @param {string} [args.clientSessionId]  optional correlation tag
 * @param {string} [args.expiresIn]        default "24h"
 */
export function signInternalToken({
  beingId,
  name,
  clientSessionId,
  expiresIn = "24h",
}) {
  if (!beingId) throw new Error("signInternalToken: `beingId` is required");
  const payload = {
    beingId: String(beingId),
    name: name || null,
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
      name: decoded.name,
      iat: decoded.iat,
      jti: decoded.jti,
    };
  } catch {
    return null;
  }
}

/**
 * Strict JWT verification. Decodes the token, looks up the Being to
 * confirm it still exists, and checks `qualities.auth.tokensInvalidBefore`
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
    .select(loadBeing ? undefined : "_id qualities")
    .lean();
  if (!being) return null;

  const authMeta =
    being.qualities instanceof Map
      ? being.qualities.get("auth")
      : being.qualities?.auth;
  if (authMeta?.tokensInvalidBefore) {
    const invalidBefore =
      new Date(authMeta.tokensInvalidBefore).getTime() / 1000;
    if (decoded.iat && decoded.iat < invalidBefore) return null;
  }

  return {
    beingId: decoded.beingId,
    name: decoded.name,
    jwt: token,
    being: loadBeing ? being : null,
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
// `createBeingWithHome` is the single primitive for placing a being in
// the world with a home. Same operation handles every case:
//
//   - Human registration: operatingMode="human", homeParent=space root.
//     Creates the human's home territory directly under the place root.
//   - Seed delegates (cherub, llm-assigner, reality-manager): homeSpace=space
//     root. No new space; the delegate just lives at the space root.
//   - Ruler promotion: homeSpace=the ruler-scope space. Existing space,
//     no rootOwner change. beings.ruler.beingId stamped on it.
//   - Trio members (Planner, Contractor, Foreman): homeParent=ruler
//     scope, homeName/Type role-specific. Fresh child space created;
//     the role spec runs from the registry; the being lives at the
//     new space.
//   - Worker leaf positions: same pattern as trio members.
//
// Atomic: rolls back the home space if being creation fails. The home
// space's rootOwner is set when the being is human (home is a real
// tree root); for non-human beings rootOwner stays inherited (the
// home is a structural sub-space within someone else's tree).
// ─────────────────────────────────────────────────────────────────────────

/**
 * Create a being and place it in the world at a home Space.
 *
 * @param {object} opts
 * @param {"human"|"llm"|"scripted"|"mixed"} opts.operatingMode   required
 * @param {string} [opts.name]                required for human; auto-generated for AI if missing
 * @param {string} [opts.password]            required for human; auto-generated for AI if missing
 * @param {string} [opts.role]                required for non-human
 * @param {string} [opts.llmDefault]
 * @param {string} [opts.homeSpace]           use this existing Space as the home
 * @param {string} [opts.homeParent]          OR create a new child under this Space
 * @param {string} [opts.homeName]            name for the new home (defaults derived)
 * @param {string} [opts.homeType]            type for the new home (defaults derived)
 * @param {object} [opts.homeQualities]       initial qualities for the new home Space
 * @param {function} [opts.scaffolding]       async ({being, home}) => {} for extra structure
 * @param {boolean} [opts.isRemote=false]
 * @param {string} [opts.homeReality=null]
 * @param {string} [opts.parentBeingId]       being-tree parent
 * @returns {Promise<{being: object, home: object}>}
 */
export async function createBeingWithHome(opts) {
  const {
    operatingMode,
    role = null,
    llmDefault = null,
    // `homeSpace` matches the schema field on Being. The caller passes
    // an existing Space's id and the being's `homeSpace` field is set
    // to it. Use `homeParent` instead to create a fresh child Space
    // under an existing parent.
    homeSpace = null,
    homeParent = null,
    homeName = null,
    homeType = null,
    homeQualities = null,
    scaffolding = null,
    isRemote = false,
    homeReality = null,
    parentBeingId = null,
    identity = null,
    actId = null,
    summonCtx = null,
  } = opts || {};
  let { name, password } = opts || {};

  // ── Validate mode + required fields ──
  if (
    operatingMode !== "human" &&
    operatingMode !== "llm" &&
    operatingMode !== "scripted" &&
    operatingMode !== "mixed"
  ) {
    throw new Error(
      "createBeingWithHome requires operatingMode='human' | 'llm' | 'scripted' | 'mixed'",
    );
  }
  if (operatingMode !== "human" && !role) {
    throw new Error("createBeingWithHome: non-human beings require a role");
  }
  if (!homeSpace && !homeParent) {
    throw new Error(
      "createBeingWithHome requires either homeSpace or homeParent",
    );
  }

  // ── Resolve identity (auto-fill for non-human beings) ──
  if (!name) {
    if (operatingMode !== "human") name = await generateUniqueName(role);
    else throw new IbpError(IBP_ERR.INVALID_INPUT, "Name is required");
  }
  if (!password) {
    if (operatingMode !== "human")
      password = crypto.randomBytes(32).toString("hex");
    else
      throw new IbpError(IBP_ERR.INVALID_INPUT, "Password is required");
  }

  // ── Resolve the home Space ──
  // Two paths:
  //   A. homeSpace: use an existing Space as the home. No structural
  //      change to the tree.
  //   B. homeParent: create a new child Space under the given parent.
  //      Defaults for name/type come from the operating role.
  let home = null;
  let createdNewHome = false;

  if (homeSpace) {
    home = await Space.findById(homeSpace);
    if (!home)
      throw new Error(`createBeingWithHome: home space ${homeSpace} not found`);
  } else {
    const parent = await Space.findById(homeParent).select("_id").lean();
    if (!parent)
      throw new Error(
        `createBeingWithHome: home parent ${homeParent} not found`,
      );

    const resolvedName =
      homeName || (operatingMode === "human" ? `~${name}` : `${role}-home`);
    const resolvedType =
      homeType ||
      (operatingMode === "human" ? "home-territory" : `${role}-home`);

    // Fact-driven home-space birth (Slice D-extended, 2026-05-23).
    // Stamps a do:birth Fact on the new home space's reel; eager-fold
    // runs applyCreateSpace + initProjection to materialize the row.
    // Bypasses createSpace because that helper rejects seedSpace
    // parents — human homes live directly under the place root which
    // IS the SPACE_ROOT seedSpace.
    const homeId = uuidv4();
    const specQualities = homeQualities instanceof Map
      ? Object.fromEntries(homeQualities)
      : (homeQualities || {});
    const { I_AM } = await import("./seedBeings.js");
    // Eager singleton commit — same read-back constraint as
    // createBeing's be:register: the next line reads Space.findById,
    // so the Fact must have committed (the eager-fold materializes
    // the Space row only on commit). Singleton ΔF, no transaction.
    await sealFacts([{
      verb:    "do",
      action:  "create",
      beingId: identity?.beingId ? String(identity.beingId) : I_AM,
      target:  { kind: "space", id: homeId },
      params:  {
        spec: {
          name:      resolvedName,
          type:      resolvedType,
          parent:    String(homeParent),
          rootOwner: null, // set below for humans only via do.set
          qualities: specQualities,
        },
      },
      actId,
    }]);
    home = await Space.findById(homeId);
    if (!home) {
      throw new Error(
        `createBeingWithHome: home-space birth Fact stamped but row ${homeId} not materialized`,
      );
    }
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
      homeReality,
      parentBeingId,
      actId, // ride the caller's moment when threaded through
      summonCtx, // be:register joins moment's ΔF when in-moment
    });
  } catch (err) {
    if (createdNewHome) {
      try {
        await Space.deleteOne({ _id: home._id });
        // No parent.children[] $pull — Space.children retired.
      } catch (rollbackErr) {
        log.warn(
          "auth",
          `createBeingWithHome rollback failed: ${rollbackErr.message}`,
        );
      }
    }
    throw err;
  }

  // ── Wire ownership on newly-created home spaces ──
  // Human home territories are tree roots (rootOwner = the being).
  // Non-human being homes are structural sub-spaces within someone
  // else's tree; they inherit access from the parent and leave
  // rootOwner null. Fact-driven via do.set; scaffold attribution
  // because createBeingWithHome is itself a higher-level orchestration
  // already authorized at the caller (cherub.register, summonCreateBeing).
  // Stamping under the new being's identity would face a chicken-and-egg
  // with stance auth (the being is becoming the owner; auth needs them
  // to already be the owner).
  if (createdNewHome && operatingMode === "human") {
    const { doVerb } = await import("../../ibp/verbs.js");
    const homeDoc = await Space.findById(home._id);
    await doVerb(
      homeDoc,
      "set",
      { field: "rootOwner", value: String(being._id) },
      { scaffold: true },
    );
    home.rootOwner = being._id;
  }

  // The being-tree parent's children[] cache is retired. The being's
  // `parentBeingId` is the single source of truth; downward walks
  // query by parentBeingId (parallel to Space.children retirement,
  // 2026-05-23).

  // ── Register the being home on the home Space ──
  // Skipped for humans — humans aren't surfaced as beings at their
  // own home. Non-human beings register under their role so the
  // descriptor / authorize / SUMMON can resolve the specific being
  // instance.
  //
  // Route through the seed set-qualities DO op so the registry write
  // emits a Fact (every change to Matter/Space/Being goes through
  // DO/BE). Caller-supplied identity attributes the Fact to the
  // summoner; absent that (extension paths that don't thread
  // identity yet), `scaffold: true` attributes to I_AM as the
  // seed-actor stand-in.
  if (operatingMode !== "human" && role) {
    try {
      const { doVerb } = await import("../../ibp/verbs.js");
      await doVerb(
        home,
        "set",
        {
          field: "qualities.beings",
          value: {
            [role]: {
              beingId: String(being._id),
              installedAt: new Date().toISOString(),
              installedBy: "createBeingWithHome",
            },
          },
          merge: true,
        },
        opts?.identity
          ? { identity: opts.identity }
          : { scaffold: true },
      );
    } catch (err) {
      log.warn(
        "auth",
        `createBeingWithHome: failed to register ${role} home: ${err.message}`,
      );
    }
  }

  // ── Optional scaffolding (caller-supplied initial structure) ──
  if (typeof scaffolding === "function") {
    try {
      await scaffolding({ being, home });
    } catch (err) {
      log.warn(
        "auth",
        `createBeingWithHome scaffolding callback failed: ${err.message}`,
      );
    }
  }

  return { being, home };
}
