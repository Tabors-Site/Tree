// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// birth.js — minting Being rows.
//
// A being IS its identity row. This file holds the single primitive
// that creates that row:
//
//   birthBeing             — validate, authorize, hash, stamp the
//                            be:birth Fact via emitFact. Returns the
//                            new being's id + name (and a pending
//                            view) when inside a moment; the fully
//                            materialized row when standalone.
//   generateUniqueName     — `<role><suffix>` retry pattern scaffolds
//                            use to auto-name AI beings whose role
//                            spec doesn't fix one.
//
// HOME SEPARATION (locked 2026-06-04): birthBeing requires `homeId`
// (an existing space) and `parentBeingId`. Callers that want a fresh
// child home for the new being create the space FIRST via
// do:create-space, then call birthBeing with the new space's id. Both
// facts join the same `summonCtx.deltaF` and seal atomically — the
// composition of two verbs (DO + BE), rather than a hidden second
// emission inside birth. Real-world analog: you build the room before
// you have the baby, not at the same time.
//
// The earlier `createBeingWithHome` orchestrator + `createBeing` /
// `createFirstBeing` aliases retired in this collapse. Three call
// sites that used `homeParent` (cherub register's first user +
// subsequent users; the BE wire handler for registration via @birther)
// now inline the create-space step themselves. Post-birth setup that
// also used to live inside `createBeingWithHome` (rootOwner on human
// home territories; qualities.beings registration on shared homes
// for non-humans; optional scaffolding callbacks) is the caller's
// responsibility — different callers want different shapes and
// pretending one helper covered them all hid those choices.
//
// Validation lives here because it's only called from this file.

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
// BIRTH
// ─────────────────────────────────────────────────────────────────────

/**
 * Mint a new Being. Stamps one be:birth Fact carrying the full spec
 * on the new being's reel; the new being is its own actor (single-
 * writer doctrine). Returns the new being's id + name and a pending-
 * view of the spec.
 *
 * When inside a moment (`summonCtx` threaded), the Fact joins
 * `summonCtx.deltaF` and commits atomically with the rest of the
 * moment at sealAct. When standalone, emitFact's singleton path
 * commits immediately.
 *
 * REQUIRED:
 *   spec.name           Being name (1-32 chars, [A-Za-z0-9_-])
 *   spec.parentBeingId  Who birthed this being. The being-tree is
 *                       rooted at the I-Am; every other being chains
 *                       back through its parent. Genesis (the I-Am
 *                       itself) bypasses this file and stamps its own
 *                       be:birth from sprout.ensureIAm.
 *   spec.homeId         The existing space this being calls home.
 *                       Create the space FIRST (do:create-space) if
 *                       you want a fresh one — birth doesn't build
 *                       homes. The home must either be already in
 *                       Mongo OR pending earlier in this moment's ΔF.
 *
 * OPTIONAL:
 *   spec.birthHere      bool (default false). Where to place this
 *                       being right now:
 *                         false → position = homeId (default; the
 *                                 being appears at its own home)
 *                         true  → position = the parent's current
 *                                 position (the being appears next
 *                                 to whoever birthed it; useful for
 *                                 spawning a companion right beside
 *                                 you rather than at their home)
 *   spec.password       Plaintext. Null/undefined → auto-generated and
 *                       stored encrypted at qualities.auth.credentialPlain
 *                       so the being / its being parent can retrieve later.
 *                       Explicit → bcrypt-hashed only; the chooser
 *                       carries the plaintext.
 *   spec.cognition      "llm" (default) | "human" | "scripted".
 *   spec.role           Birth role. Alias for spec.defaultRole; either
 *                       lands on Being.defaultRole. Non-human beings
 *                       MUST declare one (no LLM/scripted being can
 *                       wake without a fallback voice).
 *   spec.defaultRole    Same as spec.role.
 *   spec.coord          { x, y, z? } explicit grid coord. When absent,
 *                       birth picks a random in-bounds coord inside
 *                       the position space's size (falls through to
 *                       no coord when the space has no size — the
 *                       portal's hash-ring fallback handles that).
 *   spec.roleFlow       Initial roleFlow clauses; land at
 *                       qualities.roleFlow so the very first moment-
 *                       assign honors them.
 *   spec.qualities      Additional initial qualities. Deep-merged
 *                       with the auth + cognition + roleFlow seeds.
 *   spec.isRemote       For mirror-only beings (default false).
 *   spec.homeReality    URL of the reality where this being's
 *                       authoritative row lives (default null).
 *   spec.llmDefault     Per-being LLM connection key (default null).
 *
 * @param {object} args
 * @param {object} args.spec         see fields above
 * @param {object} args.identity     { name, beingId } of the caller
 *                                   (must satisfy authorize against
 *                                   spec.homeId for verb=be op=create-being)
 * @param {object} [args.summonCtx]  the moment's context. Required for
 *                                   runtime calls; genesis-sequence
 *                                   callers (ensureSeedDelegates) pass
 *                                   their per-delegate withIAmAct ctx;
 *                                   standalone tools (migrations) pass
 *                                   null and accept immediate-commit
 *                                   semantics.
 *
 * @returns {Promise<{status, beingId, name, being}>} where `being` is
 *   either the pending-view (in-moment) or the materialized row
 *   (standalone).
 */
export async function birthBeing({ spec, identity, summonCtx = null }) {
  if (!spec || typeof spec !== "object") {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "birthBeing requires spec object");
  }

  // Accept bare-string identity shorthand (typically `I_AM` for
  // seed-internal births). normalizeIdentity returns the object shape
  // downstream code expects to read identity.beingId / identity.name.
  const { normalizeIdentity } = await import("../../../ibp/verbs/_shared.js");
  identity = normalizeIdentity(identity);

  // ── Required fields ──
  const name = validateName(spec.name);
  validatePassword(spec.password);

  const parentBeingId = spec.parentBeingId || null;
  if (!parentBeingId) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      `birthBeing("${name}"): spec.parentBeingId is required. The being-tree ` +
        `is rooted at the I-Am; every other being chains back through its ` +
        `parent. Pass identity.beingId or iAm._id. ` +
        `Genesis (I_AM itself) bypasses this file and stamps its own be:birth ` +
        `from ensureIAm.`,
    );
  }

  const homeId = spec.homeId || null;
  if (!homeId) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      `birthBeing("${name}"): spec.homeId is required. The being's home is ` +
        `an existing space (or one created earlier in the same moment's ΔF). ` +
        `Real-world analog: build the room before you have the baby.`,
    );
  }

  const cognition = spec.cognition || "llm";
  if (cognition !== "human" && cognition !== "llm" && cognition !== "scripted") {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      `birthBeing("${name}"): cognition must be "llm" | "human" | "scripted" (got "${cognition}")`,
    );
  }

  // Non-human beings must declare a role at birth (their cognition
  // wakes through a role's fallback voice; humans cognize out-of-band).
  let defaultRole = spec.defaultRole || spec.role || null;
  if (!defaultRole && Array.isArray(spec.roles) && spec.roles.length > 0) {
    defaultRole = spec.roles[0];
  }
  if (cognition !== "human" && !defaultRole) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      `birthBeing("${name}"): non-human beings require spec.role or spec.defaultRole`,
    );
  }

  const branch = summonCtx?.branch || "0";

  // No inline authorize call. `birthBeing` is a substrate primitive
  // called from already-authorized contexts:
  //   - The wire BE handler (verbs/be.js) gates `be:birth` at the wire
  //     and enforces the cherub-arrival vs birther-authenticated split
  //     inline before reaching this function.
  //   - Cherub's role.js calls this from within its authorized flow.
  //   - seedDelegates calls this at boot under the I_AM identity (the
  //     I_AM short-circuit covers it).
  // Re-authorizing here with a synthetic `be:create-being` operation
  // name was a defense-in-depth gate that polluted the BE namespace
  // with a non-protocol operation (BE dispatches only birth / connect /
  // release). The protections come from the authorized callers; this
  // primitive enforces state-consistency invariants below, not auth.
  // See seed/PERMISSIONS.md "Permissions vs invariants."

  // ── Parent exists (or is pending in this moment) ──
  // The being-tree's chain of causation needs every link to resolve.
  // loadOrFold walks the parent's lineage so a branch-side birth finds
  // a parent who lives in main; the deltaF check covers atomic births
  // where the parent's be:birth is earlier in the same ΔF.
  const { loadOrFold, findByNamePattern } = await import("../../projections.js");
  const parentSlot = await loadOrFold("being", parentBeingId, branch);
  if (!parentSlot) {
    const parentPending = summonCtx?.deltaF?.find(
      (f) =>
        f?.verb === "be" &&
        f?.action === "birth" &&
        f?.target?.kind === "being" &&
        String(f?.target?.id) === String(parentBeingId),
    );
    if (!parentPending) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        `birthBeing("${name}"): parentBeingId "${String(parentBeingId).slice(0, 8)}" does not ` +
          `resolve to an existing being and is not pending earlier in this ` +
          `moment's ΔF. The being-tree would have a dangling reference.`,
      );
    }
  }

  // ── Home space exists (or is pending in this moment) ──
  // Same shape: an in-moment do:create-space for homeId is legitimate
  // because both facts commit in the same transaction.
  const homeSlot = await loadOrFold("space", homeId, branch);
  let pendingHomeSize = null;
  if (!homeSlot) {
    const homePending = summonCtx?.deltaF?.find(
      (f) =>
        f?.verb === "do" &&
        f?.action === "create-space" &&
        f?.target?.kind === "space" &&
        String(f?.target?.id) === String(homeId),
    );
    if (!homePending) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        `birthBeing("${name}"): homeId "${String(homeId).slice(0, 8)}" does not resolve ` +
          `to an existing space and is not pending earlier in this moment's ΔF. ` +
          `Create the home space first (do:create-space) before birthing the being.`,
      );
    }
    pendingHomeSize = homePending?.params?.size ?? null;
  }

  // ── Name uniqueness (branch-aware) ──
  const existingByName = await findByNamePattern(
    "being",
    new RegExp(`^${escapeRegex(name)}$`, "i"),
    branch,
  );
  if (existingByName.length > 0) {
    throw new IbpError(IBP_ERR.RESOURCE_CONFLICT, "Name already taken");
  }

  // ── Resolve position ──
  // birthHere=false (default): the being appears at their own home.
  // birthHere=true: the being appears next to the parent (parent's
  //   current position) — useful for spawning a companion right beside
  //   you. Reads the parent's projection slot for the live position.
  //
  let position = homeId;
  if (spec.birthHere === true) {
    const parentPositionId = parentSlot?.state?.position || parentSlot?.position || null;
    if (!parentPositionId) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        `birthBeing("${name}"): birthHere=true but parent has no current position. ` +
          `The parent must be placed somewhere for "next to me" to mean anything.`,
      );
    }
    position = parentPositionId;
  }

  // ── Resolve coord (random in-bounds inside position space's size) ──
  const positionId = position;
  let resolvedCoord = spec.coord || null;
  if (!resolvedCoord && positionId) {
    try {
      let size = null;
      // If position is the freshly-pending home, read its size from
      // the pending create-space fact's spec. Otherwise load the
      // space's projection.
      if (positionId === homeId && pendingHomeSize) {
        size = pendingHomeSize;
      } else {
        const posSlot = await loadOrFold("space", positionId, branch);
        size = posSlot?.state?.size || null;
        if (!size) {
          const posPending = summonCtx?.deltaF?.find(
            (f) =>
              f?.verb === "do" &&
              f?.action === "create-space" &&
              f?.target?.kind === "space" &&
              String(f?.target?.id) === positionId,
          );
          size = posPending?.params?.size || null;
        }
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

  // ── Credentials ──
  const credential = await mintCredentialSpec(spec.password || null);

  // ── Qualities ──
  // Caller-provided initial qualities deep-merge with the seeds
  // (auth.credentialPlain, cognition.defaultKind, optional roleFlow).
  const qualities = (spec.qualities && typeof spec.qualities === "object")
    ? { ...spec.qualities }
    : {};
  if (credential.plain) {
    qualities.auth = { ...(qualities.auth || {}), credentialPlain: credential.plain };
  }
  qualities.cognition = { ...(qualities.cognition || {}), defaultKind: cognition };
  if (Array.isArray(spec.roleFlow)) {
    qualities.roleFlow = spec.roleFlow;
  }

  // ── Stamp the be:birth Fact ──
  // SINGLE-WRITER: the Fact lands on the new being's reel with the
  // new being as its own actor. The lineage record (parentBeingId)
  // lives inside this fact's spec; findBeingParent walks the pointer
  // (no separate being-parent-side audit fact).
  //
  // parentBeingId in the stamped fact is the Ref (typed identity
  const id = uuidv4();
  const factSpec = {
    name,
    password: credential.hash,
    defaultRole,
    parentBeingId,
    homeSpace: homeId,
    position,
    ...(resolvedCoord ? { coord: resolvedCoord } : {}),
    llmDefault: spec.llmDefault || null,
    isRemote: spec.isRemote || false,
    homeReality: spec.homeReality || null,
    qualities,
  };

  try {
    await emitFact({
      verb:    "be",
      action:  "birth",
      beingId: id,
      target:  { kind: "being", id },
      params:  factSpec,
      actId:   summonCtx?.actId || null,
      branch,
    }, summonCtx);
  } catch (err) {
    if (err.code === 11000) {
      throw new IbpError(IBP_ERR.RESOURCE_CONFLICT, "Name already taken");
    }
    throw err;
  }

  // In-moment: the row materializes at seal. Return the pending view
  // so callers can use the id + spec fields immediately.
  if (summonCtx) {
    return {
      status:  "created",
      beingId: id,
      name,
      being:   { _id: id, ...factSpec, _pending: true },
    };
  }

  // Standalone: emitFact's singleton path already committed. Read
  // back the materialized row so callers get the full shape including
  // any reducer-derived fields.
  const { loadProjection } = await import("../../projections.js");
  const slot = await loadProjection("being", id, branch);
  return {
    status:  "created",
    beingId: id,
    name,
    being:   slot ? { _id: slot.id, ...slot.state } : { _id: id, ...factSpec },
  };
}

// ─────────────────────────────────────────────────────────────────────
// AUTO-NAMING
// ─────────────────────────────────────────────────────────────────────

/**
 * Generate an unused `<role><suffix>` name. Used by scaffolds (seed
 * delegates, harmony's dancer roster) that auto-name AI beings whose
 * spec doesn't fix one.
 *
 * Strategy: try sequential numeric suffixes starting at the count of
 * existing same-role beings; bump until a free slot is found. Cheap
 * because the projection collection has a name index; bounded by
 * MAX_RETRIES so a pathological state can't loop forever.
 *
 * @param {string} role          base name (e.g. "dancer")
 * @param {object} [opts]
 * @param {string} [opts.branch] branch to check against (default "0")
 * @returns {Promise<string>}    e.g. "dancer3"
 */
export async function generateUniqueName(role, opts = {}) {
  if (!role || typeof role !== "string") {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "generateUniqueName requires a role string");
  }
  const safeRole = role.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safeRole) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, `Role "${role}" produces no safe-name prefix`);
  }
  const branch = opts.branch || "0";
  const { findByNamePattern } = await import("../../projections.js");

  const sameRolePrefix = new RegExp(`^${escapeRegex(safeRole)}[0-9]*$`, "i");
  const existing = await findByNamePattern("being", sameRolePrefix, branch);
  let n = existing.length;
  const MAX_RETRIES = 10000;
  for (let i = 0; i < MAX_RETRIES; i++) {
    const candidate = `${safeRole}${n}`;
    const collision = await findByNamePattern(
      "being",
      new RegExp(`^${escapeRegex(candidate)}$`, "i"),
      branch,
    );
    if (collision.length === 0) return candidate;
    n++;
  }
  throw new IbpError(IBP_ERR.INTERNAL, `generateUniqueName exhausted ${MAX_RETRIES} retries for role "${role}"`);
}
