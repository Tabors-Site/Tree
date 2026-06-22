// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// matter/ops.js — DO operations that target Matter.
//
//   set-matter     — write a Matter field (schema fields or qualities)
//   rename-matter  — first-class rename (per-folder uniqueness check)
//   end-matter     — chain-disconnect target Matter from the projection
//   purge-content  — physically delete the bytes behind a content hash
//
// create-matter was carved out into store/words/create-matter/ (its
// own MOVE-INERT bundle, registered via seed/services.js).
//
// These self-register at module load. `seed/services.js` imports this
// file for side effects; the registry is populated before any caller
// dispatches.

import { registerOperation } from "../../ibp/operations.js";
import { IbpError, IBP_ERR } from "../../ibp/protocol.js";
import { targetIdOf, loadTargetRow } from "../_targetShape.js";
import { assertMatterCoordInBounds } from "./coordBounds.js";
import { registerRoleWord } from "../../present/word/roleWordRegistry.js";
import { stampsFact, stampsWordFact } from "../../ibp/factResult.js";

// Self-register the co-located world strand so resolveRoleWord("matter", "rename-matter") finds it
// (CONVERTING.md step 3). The cut prefers the bridge; the JS handler is the clean-miss fallback.
registerRoleWord("matter", "rename-matter", new URL("./rename-matter.word", import.meta.url));

const RESERVED_SET_META_NS = new Set([
  // none today; the set kept for symmetry with space/being
]);

// ─────────────────────────────────────────────────────────────────────
// set-matter
// ─────────────────────────────────────────────────────────────────────
//
// params: { field, value, merge=true }
// field paths:
//   "name" / "content"                              → schema-field writes
//   "qualities.<namespace>"                          → set/merge that namespace
//   "qualities.<namespace>.<innerKey>"               → merge one inner key
//   value=null on a qualities path                   → unset

async function setOnMatterHandler({ target, params, moment }) {
  const { field, value, merge = true } = params || {};
  if (!field || typeof field !== "string") {
    throw new Error("set-matter: `field` is required");
  }
  // Load the row at the top — set-matter needs spaceId for coord
  // clamping plus the doc for id-emitting return shapes. Passes
  // moment so an in-moment chain (create-matter → set-matter
  // before seal) reads the in-flight spec from deltaF when the row
  // hasn't materialized yet.
  target = await loadTargetRow(target, "matter", { moment });

  // ── qualities paths ────────────────────────────────────
  if (field.startsWith("qualities.")) {
    const rest = field.slice("qualities.".length);
    const parts = rest.split(".");
    const namespace = parts[0];
    if (RESERVED_SET_META_NS.has(namespace)) {
      throw new Error(
        `set-matter: qualities namespace "${namespace}" is not writable through set-matter; it has a dedicated verb.`,
      );
    }
    if (parts.length === 1 && value !== null) {
      if (typeof value !== "object") {
        throw new Error("set-matter: qualities-namespace value must be an object");
      }
    }
    return {
      written: true,
      matterId: String(target._id),
      ...(parts.length === 1 ? { namespace } : { field }),
      ...(value === null ? { unset: true } : {}),
    };
  }

  // ── schema-field writes ────────────────────────────────

  if (field === "name") {
    if (!value || typeof value !== "string") {
      throw new Error("set-matter: `value` must be a string for field=name");
    }
    return { matterId: String(target._id), name: value };
  }

  // content: the matter's bytes. Accepts a CAS ref ({kind:"cas",
  // hash, ...}) the caller has already put into the content store
  // (mirror-mount writes flow through here; vim splices, FUSE
  // truncate, etc.), or null to clear. The handler verifies the
  // hash actually lives in the store so a fact never references
  // missing bytes.
  if (field === "content") {
    if (value === null) {
      return { matterId: String(target._id), content: null };
    }
    const { isCasRef, hasContent } = await import("./contentStore.js");
    if (!isCasRef(value)) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        "set-matter: content value must be a CAS ref ({kind:\"cas\", hash, ...}) or null",
      );
    }
    if (!(await hasContent(value.hash))) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        `set-matter: unknown content hash "${String(value.hash).slice(0, 12)}..." (bytes not in store)`,
      );
    }
    return { matterId: String(target._id), content: value };
  }

  // spaceId: where the matter sits. Two valid value shapes:
  //   - bare space-id (transfer to a new space)
  //   - DELETED sentinel ("deleted") (soft-delete marker)
  if (field === "spaceId") {
    const { DELETED } = await import("../space/heavenSpaces.js");
    if (value === DELETED) {
      return { matterId: String(target._id), spaceId: DELETED };
    }
    if (typeof value !== "string" || !value.length) {
      throw new Error(
        `set-matter: spaceId must be a space id string or the DELETED sentinel . got ${typeof value}`,
      );
    }
    return { matterId: String(target._id), spaceId: value };
  }

  // beingId: who created the matter. Set-matter uses this only at
  // delete time to record DELETED. Live writes during create-matter
  // ride on the create-matter handler, not here.
  if (field === "beingId") {
    const { DELETED } = await import("../space/heavenSpaces.js");
    if (value === DELETED) {
      return { matterId: String(target._id), beingId: DELETED };
    }
    throw new Error(
      `set-matter: beingId only accepts the DELETED sentinel through set-matter; the creator is fixed at birth`,
    );
  }

  // coord: the matter's position inside spaceId. Same shape and
  // semantics as Being.coord — `{ x, y, z? }` clamped to Space.size.
  // A being moving matter inside a space writes here through the
  // standard set-matter path.
  if (field === "coord") {
    if (value === null || value === undefined) {
      return { matterId: String(target._id), coord: null };
    }
    if (typeof value !== "object" || Array.isArray(value)) {
      throw new Error("set-matter: `coord` value must be an object {x,y,z?} or null");
    }
    const clamped = await assertMatterCoordInBounds(target, value, moment?.actorAct?.history || "0");
    return { matterId: String(target._id), coord: clamped };
  }

  throw new Error(
    `set-matter: unknown field "${field}". Supported: name, content, spaceId, beingId, coord, qualities.<namespace>[.<innerKey>]`,
  );
}

// ─────────────────────────────────────────────────────────────────────
// rename-matter
// ─────────────────────────────────────────────────────────────────────
//
// First-class verb for "the matter's name changes." Live writes
// (mirror-mount FUSE rename, future portal rename gestures) come
// through here so the audit trail names the intent ("I renamed this
// matter") instead of recording a bare set-matter on the name field.
//
// Per-parent uniqueness check runs in the handler (pre-flight on the
// live projection), matching the matter-naming doctrine: name scope
// is the folder (spaceId + parentMatterId). The reducer side reuses
// applySetField on the name field — rename-matter is added to
// SET_ACTIONS in reducerHelpers.js so the same fold path applies.

// WIRED: rename-matter.word is the live path; the JS body below is the clean-miss fallback. The .word
// runs the SAME world read (load + per-folder uniqueness) through resolve-rename-spec (renameMatterHost.js),
// returns {matterId, name}, and the dispatcher lays the do:rename-matter fact (stampsWordFact targets the
// matter via matterId). Behavior-preserving; no second fact (the auto-Fact path stamps once).
async function _renameMatterViaWord({ target, params, moment }) {
  if (!moment) return null;
  const { resolveRoleWord, runRoleWord } = await import("../../present/word/roleWordRegistry.js");
  const ir = resolveRoleWord("matter", "rename-matter", moment?.actorAct?.history);
  if (!ir) return null;
  const { renameMatterHostEnv } = await import("./renameMatterHost.js");
  const history = moment?.actorAct?.history;
  try {
    const { result } = await runRoleWord(ir, {
      moment, history,
      trigger: {
        target,
        name: params?.name,
        allowReplace: params?.allowReplace === true,
        branch: history,
      },
      env: { host: renameMatterHostEnv() },
    });
    if (!result) return null;
    return stampsWordFact(result, "matter", "matterId");
  } catch (e) {
    if (e && e.__wordRefusal) throw new IbpError(e.code || IBP_ERR.INVALID_INPUT, e.message);
    throw e;
  }
}

async function renameMatterHandler({ target, params, moment }) {
  const viaWord = await _renameMatterViaWord({ target, params, moment });
  if (viaWord) return viaWord;

  const newName = params?.name;
  if (typeof newName !== "string" || !newName.length) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "rename-matter: `name` is required and must be a non-empty string");
  }
  // `allowReplace` opts out of the per-folder uniqueness check. The
  // caller is responsible for ensuring the colliding row is ended in
  // the same moment (i.e. an end-matter fact for it is in this
  // moment.deltaF ahead of this rename). The atomic-rename-replace
  // path the mirror mount uses for editor save patterns (vim writes a
  // temp file then renames over the original) goes through here.
  const allowReplace = params?.allowReplace === true;
  target = await loadTargetRow(target, "matter", { moment });
  const matterId = String(target._id);
  const history = moment?.actorAct?.history || "0";
  const spaceId = target.spaceId ? String(target.spaceId) : null;
  const parentMatterId = target.parentMatterId ? String(target.parentMatterId) : null;
  if (!spaceId) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "rename-matter: matter has no spaceId");
  }
  if (!allowReplace) {
    // Per-(spaceId, parentMatterId) uniqueness check on the live
    // projection. A name collision throws INVALID_INPUT carrying a
    // tag the IPC bridge maps to EEXIST.
    const { listMatterNamesInFolder } = await import("../projections.js");
    const existing = await listMatterNamesInFolder(history, spaceId, parentMatterId);
    const taken = new Set(existing.map((n) => String(n).toLowerCase()));
    // Strip the current name from the taken set so renaming to the
    // same name is a no-op (not a collision).
    if (typeof target.name === "string") {
      taken.delete(target.name.toLowerCase());
    }
    if (taken.has(newName.toLowerCase())) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        `rename-matter: name "${newName}" already in use in this folder`,
        { reason: "name-in-use" },
      );
    }
  }
  // Lay the name EXACTLY like set-being / set-space lay a scalar (Tabor): _factParams
  // { field:"name", value } so applySetField folds it onto the row — the rename-matter.word path
  // does the same. (The bare { name } the auto-Fact used to stamp was the "weird funk" — applySetField
  // folds only { field, value }, so the name never reached the row. This is the fix.)
  return stampsFact(
    { matterId, name: newName },
    { field: "name", value: newName },
    { kind: "matter", id: matterId },
  );
}

// ─────────────────────────────────────────────────────────────────────
// end-matter
// ─────────────────────────────────────────────────────────────────────

async function endMatterHandler({ target, identity, moment }) {
  const matterId = targetIdOf(target);
  if (!matterId) throw new Error("end-matter: matterId required");
  const history = moment?.actorAct?.history || "0";
  const { deleteMatterAndFile } = await import("./matters.js");
  let beingId = identity?.beingId;
  if (!beingId) {
    const { loadOrFold } = await import("../projections.js");
    const matterSlot = await loadOrFold("matter", matterId, history);
    beingId = matterSlot?.state?.beingId || null;
  }
  await deleteMatterAndFile({
    matterId,
    beingId: String(beingId || ""),
    actId: moment?.actId || null,
    sessionId: moment?.sessionId || null,
    moment,
  });
  return { removed: true, matterId };
}

// ─────────────────────────────────────────────────────────────────────
// purge-content
// ─────────────────────────────────────────────────────────────────────
//
// Physically delete the bytes behind a matter's content hash from the
// content store. The fact chain is append-only — the facts naming the
// hash remain, the projection marks the ref purged, and reads return
// the purged marker. This is the "I accidentally posted that"
// scalpel; background reclamation is casSweep's retention policy.
//
// Dedup makes purge a shared-fate decision: identical bytes are ONE
// blob, so other matter referencing the same hash goes dark too. The
// handler refuses when other live referents exist unless force=true —
// explicit, never silent.
//
// Auth: the role-walk gates canDo "purge-content" (advertised on the
// file/model types); the handler additionally enforces
// author-or-root-owner, same shape as deleteMatterAndFile.

async function purgeContentHandler({ target, params, identity, moment }) {
  const matterId = targetIdOf(target);
  if (!matterId) throw new IbpError(IBP_ERR.INVALID_INPUT, "purge-content: matter target required");
  if (!identity?.beingId) {
    throw new IbpError(IBP_ERR.UNAUTHORIZED, "purge-content: identity required");
  }
  const history = moment?.actorAct?.history || "0";

  const { loadOrFold } = await import("../projections.js");
  const slot = await loadOrFold("matter", String(matterId), history);
  if (!slot) throw new IbpError(IBP_ERR.INVALID_INPUT, "purge-content: matter not found");
  const matter = { _id: slot.id, ...(slot.state || {}) };

  const { isCasRef } = await import("./contentStore.js");
  const hash = typeof params?.hash === "string" && params.hash.length
    ? params.hash
    : (isCasRef(matter.content) ? matter.content.hash : null);
  if (!hash) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "purge-content: matter has no stored content (pass `hash` for a historical version)");
  }

  // Owner gate: the matter's author or the tree's root owner.
  const { resolveRootSpace } = await import("../space/spaces.js");
  const { getSpaceOwner } = await import("../space/members.js");
  const rootSpace = matter.spaceId && matter.spaceId !== "deleted"
    ? await resolveRootSpace(matter.spaceId)
    : null;
  const isAuthor = String(matter.beingId) === String(identity.beingId);
  const isRootOwner = rootSpace
    ? String(getSpaceOwner(rootSpace) || "") === String(identity.beingId)
    : false;
  if (!isAuthor && !isRootOwner) {
    throw new IbpError(
      IBP_ERR.FORBIDDEN,
      "purge-content: only the matter author or the tree owner can purge its content",
    );
  }

  // Shared-fate refcount: other live matter (any history) whose CURRENT
  // content is this hash. Purging would blind them — refuse without
  // force.
  const force = params?.force === true || params?.force === "true";
  const { default: Projection } = await import("../history/projection.js");
  const others = await Projection.find({
    type: "matter",
    "state.content.hash": hash,
    tombstoned: { $ne: true },
    id: { $ne: String(matterId) },
  }).select("id history").lean();
  if (others.length > 0 && !force) {
    throw new IbpError(
      IBP_ERR.RESOURCE_CONFLICT,
      `purge-content: ${others.length} other matter row(s) reference these same bytes ` +
      `(content is deduplicated by hash). Pass force=true to purge anyway — ` +
      `their content goes dark too.`,
      { referents: others.map((o) => ({ matterId: o.id, history: o.history })) },
    );
  }

  // Fact first — the chain explains the missing bytes. The physical
  // delete runs after the moment seals (afterSeal) so a refused seal
  // never leaves bytes gone without a fact; standalone callers (no
  // moment) emit-and-commit immediately, then delete.
  const { emitFact: _emit } = await import("../../past/fact/facts.js");
  await _emit({
    verb:    "do",
    act:     "purge-content",
    through: String(identity.beingId),
    of:      { kind: "matter", id: String(matterId) },
    params:  { hash, force, referents: others.length },
    actId:   moment?.actId || null,
    history: history,
  }, moment);

  const doDelete = async () => {
    const { deleteContent } = await import("./contentStore.js");
    await deleteContent(hash);
  };
  if (moment?.afterSeal) {
    moment.afterSeal.push(doDelete);
  } else {
    await doDelete();
  }

  return { purged: true, matterId: String(matterId), hash, sharedReferents: others.length };
}

// ─────────────────────────────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────────────────────────────

registerOperation("set-matter", {
  targets: ["matter"],
  ownerExtension: "seed",
  factAction: "set-matter",
  // authorize keys this as do:set-matter:<namespace> when the field is
  // qualities.<namespace>... See operations.js isNamespaceKeyedAction.
  useNamespaceKey: true,
  args: {
    field: { type: "text", label: "Field (e.g. name, content, qualities.<ns>.<key>)", required: true },
    value: { type: "json", label: "Value (JSON; null to clear)", required: false },
    merge: { type: "bool", label: "Merge (for qualities objects)", default: true, required: false },
  },
  handler: setOnMatterHandler,
});

registerOperation("rename-matter", {
  targets: ["matter"],
  ownerExtension: "seed",
  factAction: "rename-matter",
  args: {
    name: { type: "text", label: "New name (per-folder uniqueness enforced)", required: true },
  },
  handler: renameMatterHandler,
});

registerOperation("end-matter", {
  targets: ["matter"],
  ownerExtension: "seed",
  factAction: "end-matter",
  args: {},
  handler: endMatterHandler,
});

registerOperation("purge-content", {
  targets: ["matter"],
  ownerExtension: "seed",
  factAction: "purge-content",
  // The handler stamps the purge fact itself (fact-first, delete on
  // afterSeal); a second auto-fact would double-record the act.
  skipAudit: true,
  args: {
    hash:  { type: "text", label: "Content hash (defaults to the matter's current content)", required: false },
    force: { type: "bool", label: "Purge even when other matter shares these bytes", default: false, required: false },
  },
  handler: purgeContentHandler,
});
