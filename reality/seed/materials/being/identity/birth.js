// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// birth.js — minting Being rows.
//
// A being IS its identity row. This file holds the primitives that
// create that row, place it in the world with a home space, and
// generate the names AI beings boot with.
//
//   createBeing             — the primitive: validate, hash, stamp the
//                             be:register Fact via emitFact, return
//                             either the materialized row (standalone)
//                             or a pending view (in-moment)
//   createBeingWithHome     — wraps createBeing with home-space
//                             resolution (existing or new), ownership
//                             wiring, optional scaffolding callback
//   createFirstBeing        — first-human convenience wrapper
//   generateUniqueName      — `<role><suffix>` retry pattern used by
//                             scaffolds that auto-name AI beings
//
// Validation lives here (validateName / validatePassword) because it's
// only called from this file's two birth primitives.

import Being from "../being.js";
import Space from "../../space/space.js";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import { escapeRegex } from "../../../utils.js";
import { IBP_ERR, IbpError } from "../../../ibp/protocol.js";
import log from "../../../seedReality/log.js";
import { emitFact } from "../../../past/fact/facts.js";
import { mintCredentialSpec } from "./credentials.js";
import { I_AM } from "../seedBeings.js";

// ─────────────────────────────────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────────────────────────────────

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

// Validates a caller-supplied plaintext password. Null/undefined is
// permitted (the auto-generate path); only an actually-provided value
// is range-checked.
function validatePassword(password) {
  if (password === null || password === undefined) return;
  if (typeof password !== "string")
    throw new IbpError(IBP_ERR.INVALID_INPUT, "Password must be a string");
  if (password.length < MIN_PASSWORD)
    throw new IbpError(IBP_ERR.INVALID_INPUT, `Password must be at least ${MIN_PASSWORD} characters`);
  if (password.length > MAX_PASSWORD)
    throw new IbpError(IBP_ERR.INVALID_INPUT, `Password must be ${MAX_PASSWORD} characters or fewer`);
}

// ─────────────────────────────────────────────────────────────────────
// BEING CREATION
// ─────────────────────────────────────────────────────────────────────

// First human on a fresh reality. The I-Am already exists by this point
// (planted by ensureSpaceRoot); callers pass my id as opts.parentBeingId
// so the first human's being-tree parent is me. Race-resilient: two
// concurrent first-run registrations both pass isFirstBeing(); the
// earliest insertion wins via the unique index.
export async function createFirstBeing(name, password, opts = {}) {
  return createBeing(name, password, opts);
}

// Create a being. Fact-driven (Slice D, 2026-05-23). Mints the credential
// pair (bcrypt hash + optional retrievable plain) via mintCredentialSpec,
// stamps a be:register Fact with the full spec on the new being's reel,
// then reads back the row that eager-fold materialized via applyCreateBeing
// + initProjection. The pre-save bcrypt hook is retired (Slice E); the fact
// path is the only path that creates Being rows.
//
// Password handling (locked 2026-05-28, see [[project-credential-model]]):
//   - `password` arg null/undefined -> auto-generate. Plaintext is encrypted
//     and stored at qualities.auth.credentialPlain so the being itself or
//     its creator can retrieve it later.
//   - `password` arg string -> the creator chose it. Bcrypt only; no plain
//     stored. The chooser carries it themselves.
//
// "Creator" here means the being that performed THIS birth act (the
// be:summon-create). It is NOT the SUMMON sense (anyone calling anyone)
// and NOT parentBeingId (the being-tree parent, which can drift later).
//
// opts.actId threads the calling moment so the be:register Fact rides
// the caller's frame. Genesis flows (seedDelegates) pass null actId.
export async function createBeing(name, password, opts = {}) {
  name = validateName(name);
  validatePassword(password);

  // ── Being-tree invariant: only the I-Am has null parentBeingId, ──
  // ── and every named parent must resolve to a real being. ───────
  //
  // The being-tree is rooted at the I-Am. Every other being is
  // birthed from an existing being's act, so parentBeingId is the
  // line of causation back to the root. Two failure modes the model
  // refuses to materialize:
  //
  //   (1) parentBeingId is null on a non-I-Am being — a structural
  //       orphan. No chain to walk for ancestor checks (credential
  //       authority, role inheritance, permission resolution); no
  //       truthful "who summoned me forth" record.
  //
  //   (2) parentBeingId is set but points at a being that doesn't
  //       exist — a dangling reference. The chain walks break the
  //       first time anything tries to resolve the parent.
  //
  // Genesis is the one legitimate (1) — the chain doesn't yet exist
  // to chain TO. ensureIAm in sprout.js mints the I-Am with
  // parentBeingId: null, and isIAm short-circuits this check there.
  //
  // (2) has an atomic-batch caveat: when birth runs inside a moment
  // whose ΔF carries the parent's be:register earlier in the same
  // batch, the parent row hasn't sealed yet but the reference is
  // legitimate (it commits in the same transaction). Same shape as
  // the homeSpace pending-check below. Check the moment's deltaF
  // before failing.
  const isIAm = name === I_AM;
  const parentBeingId = opts.parentBeingId || null;
  if (!isIAm) {
    if (!parentBeingId) {
      throw new Error(
        `createBeing("${name}"): non-I-Am beings require parentBeingId. ` +
        `The being-tree is rooted at the I-Am; every other being chains ` +
        `back through its parent. Standard sources: identity.beingId ` +
        `(SUMMON-create), the cherub/I-Am for register flows, or an ` +
        `explicit parent set by the caller. Pass opts.parentBeingId.`,
      );
    }
    const parentRow = await Being.findById(parentBeingId).select("_id").lean();
    if (!parentRow) {
      const pendingInBatch = opts.summonCtx?.deltaF?.find(
        (f) =>
          f?.verb === "be" &&
          f?.action === "birth" &&
          f?.target?.kind === "being" &&
          String(f?.target?.id) === String(parentBeingId),
      );
      if (!pendingInBatch) {
        throw new Error(
          `createBeing("${name}"): parentBeingId "${parentBeingId}" does ` +
          `not resolve to an existing being and is not pending earlier in ` +
          `the current moment's ΔF. The being-tree would have a dangling ` +
          `reference. Pass a parentBeingId that points at a real being.`,
        );
      }
    }
  }

  // Case-insensitive uniqueness check. Regex because Mongo collation
  // support varies across deployments. The unique index on `name` is
  // the safety net; this check produces a friendly error first.
  const existing = await Being.findOne({
    name: { $regex: `^${escapeRegex(name)}$`, $options: "i" },
  });
  if (existing)
    throw new IbpError(IBP_ERR.RESOURCE_CONFLICT, "Name already taken");

  // defaultRole — the being's unconditional fallback voice. The carry
  // list (`roles: [String]`) retired with the RoleFlow build; a
  // being's wearable roles are now the union of every role its
  // `qualities.roleFlow` can reference plus its defaultRole. opts.role
  // (singular) and opts.defaultRole both feed this one field; opts.roles
  // (plural, legacy) is honored only for its first entry as a fallback
  // for callers that haven't migrated yet.
  let defaultRole = opts.defaultRole || opts.role || null;
  if (!defaultRole && Array.isArray(opts.roles) && opts.roles.length > 0) {
    defaultRole = opts.roles[0];
  }

  const credential = await mintCredentialSpec(password || null);
  const qualities = {};
  if (credential.plain) {
    qualities.auth = { credentialPlain: credential.plain };
  }
  // Cognition (closed-set: "llm" | "human" | "scripted") goes on the
  // being as a quality, not a schema field. Effective cognition at
  // moment-assign is read via beingCognition(being) in identity/lookups.js,
  // which prefers the inhabit-projection (qualities.connection.inhabitedBy)
  // and falls back to this defaultKind. Substrate default is "llm";
  // cherub's human-registration path overrides with "human"; seed
  // delegates and extensions pass their own.
  qualities.cognition = { defaultKind: opts.cognition || "llm" };
  // Optional birth-time roleFlow. Birther's create-being path lets the
  // operator hand a child being its initial behavioral program;
  // birth.js stamps it into qualities so the very first moment-assign
  // already reads from the flow. Subsequent edits go through
  // set-being:qualities.roleFlow like any other quality.
  if (Array.isArray(opts.roleFlow)) {
    qualities.roleFlow = opts.roleFlow;
  }

  const id = uuidv4();
  const position = opts.position || opts.currentSpace || opts.homeSpace || null;

  // Derive a random coord inside the position space's size so the
  // portal renders this being at a stable spot . the same rule
  // createSpace uses for its children. Every being is visible at
  // their position+coord (the descriptor surfaces them through
  // occupantsByPosition; the renderer maps coord into world units).
  // Reads the position space's size from disk OR, if the space is
  // pending in this same moment's ΔF (e.g. createBeingWithHome's
  // new-home path), from the create-space Fact's spec. Falls back
  // to no coord when the space has no size; the renderer's hash-ring
  // fallback kicks in there.
  let resolvedCoord = opts.coord || null;
  if (!resolvedCoord && position) {
    try {
      const live = await Space.findById(position).select("size").lean();
      let size = live?.size || null;
      if (!size) {
        const pendingCreate = opts.summonCtx?.deltaF?.find(
          (f) =>
            f?.verb === "do" &&
            f?.action === "create-space" &&
            f?.target?.kind === "space" &&
            String(f?.target?.id) === String(position),
        );
        size = pendingCreate?.params?.spec?.size || null;
      }
      if (size && Number.isFinite(size.x) && Number.isFinite(size.y) &&
          size.x > 0 && size.y > 0) {
        resolvedCoord = {
          x: Math.floor(Math.random() * size.x),
          y: Math.floor(Math.random() * size.y),
        };
      }
    } catch { /* defensive: any lookup failure leaves coord null */ }
  }

  const spec = {
    name,
    password: credential.hash,
    defaultRole,
    parentBeingId: opts.parentBeingId || null,
    homeSpace: opts.homeSpace || null,
    // Starting position. Caller may specify opts.position (or the
    // legacy opts.currentSpace alias during migration). Default is
    // homeSpace — a being starts at home unless placed elsewhere.
    // applyCreateBeing in reducerHelpers seeds Being.position from
    // this. Navigation later writes Being.position via the position-
    // fact pipeline.
    position,
    // Starting coord . random spot inside position-space's size, set
    // at creation so the portal has a place to draw the being from
    // the moment they exist. Every being acts like a human in this
    // respect; movement writes through set-being:coord.
    ...(resolvedCoord ? { coord: resolvedCoord } : {}),
    llmDefault: opts.llmDefault || null,
    isRemote: opts.isRemote || false,
    homeReality: opts.homeReality || null,
    qualities,
  };

  // SINGLE-WRITER, structurally enforced: the be:register Fact lands
  // on the new being's reel with the new being as the actor. The
  // new being is its own first deed; the creator's "I summoned X"
  // record lands on the CREATOR's reel as a separate be:summon-create
  // Fact in the same atomic ΔF (see summonCreateBeing). Two facts on
  // two reels, both self-stamped, one transaction. No knob.
  //
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
  // (name, roles, homeSpace, qualities.cognition.defaultKind, etc.).
  // Schema-derived / timestamp fields aren't on the pending view; defer
  // those reads.
  try {
    await emitFact({
      verb:    "be",
      action:  "birth",
      beingId: id,
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

// ─────────────────────────────────────────────────────────────────────
// UNIFIED BEING + HOME CREATION
//
// `createBeingWithHome` is the single primitive for placing a being in
// the world with a home. Same operation handles every case:
//
//   - Human registration: cognition="human", homeParent=space root.
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
// ─────────────────────────────────────────────────────────────────────

/**
 * Create a being and place it in the world at a home Space.
 *
 * @param {object} opts
 * @param {"llm"|"human"|"scripted"} [opts.cognition]   default "llm"; substrate's choice when caller doesn't specify
 * @param {string} [opts.name]                required for "human" cognition; auto-generated for others if missing
 * @param {string} [opts.password]            required for "human" cognition; auto-generated for others if missing
 * @param {string} [opts.role]                required for non-"human" cognition
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
    defaultRole = null,
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
    homeSize = null,
    scaffolding = null,
    isRemote = false,
    homeReality = null,
    parentBeingId = null,
    identity = null,
    actId = null,
    summonCtx = null,
    scaffold = false,
    // Optional explicit coord for the new being inside its position
    // space. Callers who want deterministic placement (seed delegates
    // on a circle around the place-root origin, scaffolded LLM beings
    // pinned to specific spots) pass this; createBeing falls back to a
    // random in-bounds coord otherwise.
    coord = null,
    // Optional birth-time roleFlow. Set by the birther's create-being
    // path when the operator hands the child its initial behavioral
    // program. Lands at qualities.roleFlow on the new being row.
    roleFlow = null,
  } = opts || {};
  let { name, password } = opts || {};
  // The being's birth role. Non-human beings declare a role at birth
  // so the moment-open path has a fallback voice. `role` and
  // `defaultRole` both feed Being.defaultRole; `role` is the
  // historical alias.
  const role = opts?.role || defaultRole || null;

  // Cognition: default to "llm" (substrate default). Caller can pass
  // "human" (cherub's human-registration path), "scripted" (seed
  // delegates, harmony drummer/dancer-toward), or "llm". Closed set;
  // see seed/present/roles/registry.js header for the doctrine.
  const cognition = opts.cognition || "llm";

  // ── Validate cognition + required fields ──
  if (
    cognition !== "human" &&
    cognition !== "llm" &&
    cognition !== "scripted"
  ) {
    throw new Error(
      `createBeingWithHome: cognition must be "llm" | "human" | "scripted"; got "${cognition}"`,
    );
  }
  // Non-human beings must declare a role at birth so they have a
  // fallback voice for transport-acts and place-driven wakes. Humans
  // may have none (their cognition is outside the substrate).
  if (cognition !== "human" && !role) {
    throw new Error(
      "createBeingWithHome: non-human beings require a role. Pass `role` " +
      "or `defaultRole`.",
    );
  }
  // Home resolution — three sources in priority order:
  //   1. explicit homeSpace (use this existing space)
  //   2. explicit homeParent (create a fresh child space under it)
  //   3. parentBeingId's homeSpace (default: live where your parent
  //      lives — what your instinct expects unless you override)
  //
  // (3) is the natural-meaning fallback. A being birthed without
  // explicit home settles into its parent's home; home can be
  // updated later via do:set-being { field: "homeSpace" }. The
  // I-Am is the one exception (no parent), and ensureIAm sets
  // homeSpace explicitly at genesis.
  if (!homeSpace && !homeParent && parentBeingId) {
    const parentRow = await Being.findById(parentBeingId).select("homeSpace").lean();
    if (parentRow?.homeSpace) {
      homeSpace = String(parentRow.homeSpace);
    }
  }
  if (!homeSpace && !homeParent) {
    throw new Error(
      "createBeingWithHome requires homeSpace, homeParent, or a parentBeingId whose homeSpace can be inherited",
    );
  }

  // ── Resolve identity ──
  // Name: required for humans, auto-generated for AI/scripted beings
  // from the role + suffix.
  // Password: required for humans (the human typed it). For non-human
  // beings, leave it null and let createBeing's mintCredentialSpec
  // auto-generate and store the retrievable plaintext. The old auto-gen
  // here discarded the plaintext, which is what we're fixing.
  if (!name) {
    if (cognition !== "human") name = await generateUniqueName(role);
    else throw new IbpError(IBP_ERR.INVALID_INPUT, "Name is required");
  }
  if (!password && cognition === "human") {
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
    if (!home) {
      // Multi-act atomic batch: when this birth runs inside a moment
      // whose ΔF carries an EARLIER act's create-space fact for this
      // same id, the row hasn't materialized yet but the reference is
      // legitimate — it commits in the same transaction. Genesis is
      // the canonical case: the I-Am's "let there be world" moment
      // contains several conceptually distinct acts (create the space,
      // mint the being, place the being in the space) that must
      // commit together because partial genesis is incoherent. SQL's
      // same-transaction foreign-key insert has this shape. Accept
      // the pending reference; the row materializes at seal.
      const pendingInBatch = summonCtx?.deltaF?.find(
        (f) =>
          f?.verb === "do" &&
          f?.action === "create-space" &&
          f?.target?.kind === "space" &&
          String(f?.target?.id) === String(homeSpace),
      );
      if (!pendingInBatch) {
        throw new Error(`createBeingWithHome: home space ${homeSpace} not found`);
      }
      home = { _id: homeSpace, _pending: true };
    }
  } else {
    let parent = await Space.findById(homeParent).select("_id").lean();
    if (!parent) {
      // Same atomic-batch reference resolution as above.
      const pendingInBatch = summonCtx?.deltaF?.find(
        (f) =>
          f?.verb === "do" &&
          f?.action === "create-space" &&
          f?.target?.kind === "space" &&
          String(f?.target?.id) === String(homeParent),
      );
      if (!pendingInBatch) {
        throw new Error(
          `createBeingWithHome: home parent ${homeParent} not found`,
        );
      }
      parent = { _id: homeParent, _pending: true };
    }

    // The home space's stored name is the being's name (no tilde).
    // "~" is IBP address sugar only — at the substrate layer the home
    // is a regular space with a regular name, listable like any other
    // child of its parent. "/~" and "/~@<name>" are how addresses
    // reach it; the listing surface ("/<name>") shows it by its real
    // name.
    const resolvedName =
      homeName || (cognition === "human" ? name : `${role}-home`);
    const resolvedType =
      homeType ||
      (cognition === "human" ? "home-territory" : `${role}-home`);
    // Default bounding box for human homes. Callers (including a
    // future purchasing/upgrade system) can override by passing
    // `homeSize`. Non-humans don't get a sized home by default;
    // they're code without a 3D footprint until something gives them
    // one explicitly.
    const resolvedSize =
      homeSize || (cognition === "human" ? { x: 100, y: 100 } : null);

    // Compute a random coord inside the parent's size so the home tree
    // lands on the parent's grid rather than the portal's hash-derived
    // ring 22-76 units off-origin (the "homes scattered outside the
    // grid" effect). Mirrors createSpace's default-coord logic; this
    // path bypasses that helper so we replicate the rule inline.
    // Falls back to no coord when the parent has no size (the renderer
    // takes its hash-ring fallback in that case).
    let resolvedCoord = null;
    try {
      const parentSpace = parent && !parent._pending
        ? parent
        : await Space.findById(homeParent).select("size").lean();
      const parentSize = parentSpace?.size || null;
      if (parentSize && Number.isFinite(parentSize.x) && Number.isFinite(parentSize.y) &&
          parentSize.x > 0 && parentSize.y > 0) {
        resolvedCoord = {
          x: Math.floor(Math.random() * parentSize.x),
          y: Math.floor(Math.random() * parentSize.y),
        };
      }
    } catch { /* defensive: any lookup failure leaves coord null */ }

    // Home-space birth fact. Inside a moment (boot or runtime), the
    // fact joins ctx.deltaF and seals with the rest of the ΔF.
    // Outside any moment, emitFact falls back to sealFacts singleton.
    // Bypasses createSpace because that helper rejects seedSpace
    // parents — human homes live directly under the place root which
    // IS the SPACE_ROOT seedSpace.
    const homeId = uuidv4();
    const specQualities = homeQualities instanceof Map
      ? Object.fromEntries(homeQualities)
      : (homeQualities || {});
    const { I_AM } = await import("../seedBeings.js");
    await emitFact({
      verb:    "do",
      action:  "create-space",
      beingId: identity?.beingId ? String(identity.beingId) : I_AM,
      target:  { kind: "space", id: homeId },
      params:  {
        spec: {
          name:      resolvedName,
          type:      resolvedType,
          parent:    String(homeParent),
          rootOwner: null, // set below for humans only via do.set-space
          qualities: specQualities,
          ...(resolvedSize  ? { size:  resolvedSize  } : {}),
          ...(resolvedCoord ? { coord: resolvedCoord } : {}),
        },
      },
      actId: summonCtx?.actId || actId,
    }, summonCtx);
    // Inside a moment, the home row materializes at seal — keep a
    // pending view carrying the id + parent + name so downstream code
    // can keep operating. Outside a moment the eager singleton commit
    // ran and the row exists; read it back.
    if (summonCtx) {
      home = {
        _id: homeId,
        _pending: true,
        name: resolvedName,
        type: resolvedType,
        parent: String(homeParent),
        rootOwner: null,
      };
    } else {
      home = await Space.findById(homeId);
      if (!home) {
        throw new Error(
          `createBeingWithHome: home-space birth Fact stamped but row ${homeId} not materialized`,
        );
      }
    }
    createdNewHome = true;
  }

  // ── Create the being, rolling back the home on failure ──
  let being;
  try {
    being = await createBeing(name, password, {
      cognition,
      role,
      defaultRole,
      homeSpace: String(home._id),
      llmDefault,
      isRemote,
      homeReality,
      parentBeingId,
      // Pass through the explicit coord when callers requested
      // deterministic placement; createBeing's default in-bounds
      // randomization stays available when coord is null.
      coord,
      // Initial roleFlow stamps onto qualities at birth so the very
      // first moment-assign honors it.
      roleFlow,
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
  if (createdNewHome && cognition === "human") {
    const { doVerb } = await import("../../../ibp/verbs/do.js");
    // Both materialized and pending-in-batch homes resolve to the
    // same typed identity. setOnSpace's rootOwner branch uses only
    // targetIdOf — no row load — so the write works whether the
    // row exists yet or not.
    await doVerb(
      { kind: "space", id: String(home._id) },
      "set-space",
      { field: "rootOwner", value: String(being._id) },
      { scaffold: true, summonCtx },
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
  // Route through the seed set-space DO op so the registry write
  // emits a Fact (every change to Matter/Space/Being goes through
  // DO/BE). Caller-supplied identity attributes the Fact to the
  // creator; absent that (extension paths that don't thread identity
  // yet), `scaffold: true` attributes to I_AM as the seed-actor
  // stand-in. When this call is itself part of genesis (seedDelegates
  // at boot, before any moment-opening machinery exists), scaffold is
  // already true on the parent call and threads through. This is the
  // genesis-exempt path, not a runtime "no moment open" fallback.
  if (cognition !== "human" && role) {
    try {
      const { doVerb } = await import("../../../ibp/verbs/do.js");
      const registerOpts = identity
        ? { identity, summonCtx, scaffold }
        : { scaffold: true, summonCtx };
      // Key the entry by the being's NAME, not its role. Multiple
      // beings can share a role (5 dancers all on `harmony:dancer.
      // toward` at one space). Role-keyed entries clobber each other
      // and the descriptor surfaces only the last writer. Name-keyed
      // entries give every being its own slot, and the role rides
      // along in the value for stance-role-shorthand lookups (see
      // summon.js qualifier resolution).
      await doVerb(
        { kind: "space", id: String(home._id) },
        "set-space",
        {
          field: "qualities.beings",
          value: {
            [being.name]: {
              beingId: String(being._id),
              role,
              installedAt: new Date().toISOString(),
              installedBy: "createBeingWithHome",
            },
          },
          merge: true,
        },
        registerOpts,
      );
    } catch (err) {
      log.warn(
        "auth",
        `createBeingWithHome: failed to register ${being.name} home: ${err.message}`,
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
