// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// space/ops.js — DO operations that target Space.
//
//   create-space — bring a new Space into existence under target
//   set-space    — write a Space field (schema fields or qualities)
//   end-space    — chain-disconnect target Space from the projection
//
// These self-register at module load. `seed/services.js` imports this
// file for side effects; the registry is populated before any caller
// dispatches.

import { registerOperation } from "../../ibp/operations.js";
import { createSpace } from "./spaces.js";
import { getStoryDomain } from "../../ibp/address.js";
import {
  IbpError,
  IBP_ERR,
  mapPatternsToIbpError,
} from "../../ibp/protocol.js";
import { I } from "../being/seedBeings.js";
import { registerAbleWord } from "../../present/word/ableWordRegistry.js";
import {
  detectTargetKind,
  targetIdOf,
} from "../_targetShape.js";
import { targetsFact, stampsFact } from "../../ibp/factResult.js";
import { setOwner, removeOwner } from "./ownership.js";
import { setSpaceHostEnv } from "./setSpaceHost.js";
import { endSpaceHostEnv } from "./endSpaceHost.js";

// Self-register the co-located world strand so resolveAbleWord("space", "set-space") finds it.
// set-space is WORD-SOLE: set-space.word is the ONLY path (do.js runOpWord runs it); there is no
// JS handler. The genuine substrate reads (sibling-name availability, heaven-row immutability gate,
// coord-bounds against the parent size, the maxSpaceSize config read) + the ancestor-cache
// invalidation bottom out in resolve-set-space-spec (setSpaceHost.js), reusing the SAME helpers.
registerAbleWord("space", "set-space", new URL("./set-space.word", import.meta.url));

// end-space is WORD-SOLE: end-space.word is the ONLY path (do.js runOpWord runs it); there is no JS
// handler. The genuine substrate READS + read-after-write hygiene (the owner/not-root authority check,
// the already-deleted refusal, the beforeSpaceDelete hook, the per-reel lock, the cache invalidation)
// bottom out in resolve-end-space-spec (endSpaceHost.js), reusing deleteSpaceHistory. The word lays no
// factParams; the space reducer DERIVES parent=DELETED + position=DELETED + owner=deleter from the
// do:end-space fact's act + `through`.
registerAbleWord("space", "end-space", new URL("./end-space.word", import.meta.url));

// ─────────────────────────────────────────────────────────────────────
// create-space
// ─────────────────────────────────────────────────────────────────────
//
// params: { name, type?, size?, ... } — flat
//
// The fact stamped is `{ params: { ...flat fields } }` — no `spec:`
// wrapper anywhere in the substrate. Reducers, walkers, and replicate
// paths all read flat. See seed/done/Chain-Rebuild.md "How symmetrical are
// the fact shapes" for the rationale.
//
// skipAudit because the branch stamps its own birth Fact directly
// (the handler owns the actId + target + spec). One Fact per birth on
// the new aggregate's reel; eager-fold materializes the row via the
// reducer's applyCreateSpace.

async function createSpaceHandler(ctx) {
  const { target, params, identity, moment } = ctx;
  const spec = params || {};
  const targetKind = detectTargetKind(target);
  return createSpaceChild({
    target,
    params: spec,
    identity,
    moment,
    kind: targetKind,
  });
}

// ─────────────────────────────────────────────────────────────────────
// set-space — WORD-SOLE (registered below). No JS handler.
// ─────────────────────────────────────────────────────────────────────
//
// Write one Space field — a schema scalar (name / type / parent / owner / size / coord) or a
// qualities path (qualities.<ns>[.<inner>]). The target is a typed space OR a resolved stance.
//
// set-space.word is the SOLE path. The CONTROL strand (the `field`-required gate + the return)
// is the .word; the genuine substrate READS + read-after-write hygiene — sibling-NAME availability
// (assertNameAvailableAt), the heaven-space ROW read (the immutability gate), COORD-BOUNDS against
// the parent's size, the maxSpaceSize config read (assertValidSpaceSize), and the ancestor-chain
// cache invalidation (invalidateSpace) — are the host see-op resolve-set-space-spec (setSpaceHost.js),
// reaching the SAME helpers the old handler called. The .word returns { spaceId, factParams }; do.js's
// runOpWord promotes factParams + the space target (idFrom:"spaceId" — a typed space's id OR a
// stance's .spaceId, the two factTarget shapes the handler produced) via stampsWordFact, so the lone
// do:set-space fact lands on the space's reel and applySetField / applySetQualities fold it exactly
// as before — the same { field, value[, merge] } the dispatcher stamped when a JS handler stood here.

// ─────────────────────────────────────────────────────────────────────
// end-space — WORD-SOLE (registered below). No JS handler.
// ─────────────────────────────────────────────────────────────────────
//
// end-space.word is the SOLE path. The CONTROL strand (the return) is the .word; the genuine
// substrate READS + read-after-write hygiene — the owner/not-root authority check
// (resolveSpaceAccess walks the ancestor chain), the already-deleted refusal, the beforeSpaceDelete
// hook, the per-reel lock, and the cache invalidation — are the host see-op resolve-end-space-spec
// (endSpaceHost.js), reusing deleteSpaceHistory. The .word lays NO factParams + a {kind,id} factTarget
// at the space; do.js's runOpWord (stampsWordFact, idFrom:"spaceId") lays the lone do:end-space fact
// on the space's reel — verb:do, act:end-space, of:{space,id}, through:deleter, EMPTY params — and the
// space reducer DERIVES parent=DELETED + position=DELETED + owner=deleter, exactly as before.

// ─────────────────────────────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────────────────────────────

// create-space CARVED OUT → store/words/create-space/ (create.word + spaceHost.js +
// index.js). The op now lays its ONE do:create-space fact through the dispatcher (no
// skipAudit, no self-emit): resolve-birth-space runs the non-emitting createSpace floor
// (resolveBirthSpace) and the dispatcher stamps the birth — the spacebar lift. owner/
// heaven are separate words (next moments). createSpaceHandler/createSpaceChild/
// shapeNewSpace below are now dead (the bundle owns the op); cleanup is a follow-up.

// ─────────────────────────────────────────────────────────────────────
// make-heaven — THE HEAVEN WORD
// ─────────────────────────────────────────────────────────────────────
//
// Heaven-ness is a separable attribute decomposed OUT of a space's birth
// (the same shape as owner/qualities): a being makes a space a heaven space
// with its OWN do — one fact on the space's reel — which applyMakeHeaven
// folds onto state.heavenSpace. create-space.word lays it as an inner act
// after the birth (the place root, heaven `.`, the tier-3 regions, the
// host/factory children all born this one way). No able grant exists for
// this op, so authorize() fails it closed for everyone — only the I-Am
// (which short-circuits authorize) can mark a heaven space, preserving the
// genesis-only, fixed-topology, immutable-after-genesis heaven invariant.
// WORD-SOLE: make-heaven.word is the only op path (do.js runOpWord). It authors its fact directly
// (no host read) — factParams { heavenSpace } + a {kind,id} factTarget at the space; stampsWordFact
// lays the one do:make-heaven. The I-only authorize gate runs in doVerb before the word. (Genesis
// emits the fact directly via emitFact, bypassing this op; the params shape matches.)
registerAbleWord("space", "make-heaven", new URL("./make-heaven.word", import.meta.url));
registerOperation("make-heaven", {
  targets: ["space"],
  ownerExtension: "seed",
  factAction: "make-heaven",
  args: {
    heavenSpace: {
      type: "text",
      label: "Heaven marker (which heaven space)",
      required: true,
    },
  },
  word: { noun: "space", able: "space" },
});

// WORD-SOLE: set-space.word is the only path (do.js runOpWord). idFrom:"spaceId" targets the
// fact at the space (a typed space's id OR a stance's .spaceId) and promotes the word's factParams
// ({field, value[, merge]}); resolve-set-space-spec (setSpaceHostEnv) is the lone host READ (load +
// name-availability + heaven-immutability + coord-bounds + maxSpaceSize). No handler.
registerOperation("set-space", {
  targets: ["space", "stance"],
  ownerExtension: "seed",
  factAction: "set-space",
  // authorize keys this as do:set-space:<namespace> when the field is
  // qualities.<namespace>... so operators can author per-namespace
  // rules. See operations.js isNamespaceKeyedAction.
  useNamespaceKey: true,
  args: {
    field: {
      type: "text",
      label: "Field (e.g. name, status, qualities.<ns>.<key>)",
      required: true,
    },
    value: {
      type: "json",
      label: "Value (JSON; null to clear)",
      required: false,
    },
    merge: {
      type: "bool",
      label: "Merge (for qualities objects)",
      default: true,
      required: false,
    },
  },
  word: { noun: "space", able: "space", idFrom: "spaceId" },
  hostEnv: setSpaceHostEnv,
});

// WORD-SOLE: end-space.word is the only path (do.js runOpWord). idFrom:"spaceId" targets the fact at
// the space; the .word lays no factParams — the reducer DERIVES parent=DELETED + position=DELETED +
// owner=deleter from the do:end-space fact's act + `through`. resolve-end-space-spec (endSpaceHostEnv)
// is the lone host READ (load + owner/not-root gate + already-deleted + beforeSpaceDelete hook + lock
// + invalidate). No handler.
registerOperation("end-space", {
  targets: ["space"],
  ownerExtension: "seed",
  factAction: "end-space",
  args: {},
  word: { noun: "space", able: "space", idFrom: "spaceId" },
  hostEnv: endSpaceHostEnv,
});

// ─────────────────────────────────────────────────────────────────────
// Ownership — the owner roster on a place.
// ─────────────────────────────────────────────────────────────────────
//
// Thin DO wrappers over the ownership.js functions. Each self-enforces
// authority and stamps its change as an inner set-space fact, so these
// wrappers carry skipAudit:true — one logical write, one fact. The
// actor is the caller's being; the place is the resolved target (a
// space target's id, or a stance's spaceId).
//
// Owner is the ONE base-axiom membership class — implicit authority
// over the space + descendants without any able grant. All other
// authority shapes (including what was contributor) are ables
// delegated via grant-able per seed/AblesAreAuth.md.

// Resolve the space id from a DO target that may be a space row/envelope
// or a resolved stance (which carries `.spaceId`).
function spaceIdFromTarget(target) {
  const kind = detectTargetKind(target);
  if (kind === "stance") {
    if (!target?.spaceId) {
      throw new IbpError(
        IBP_ERR.SPACE_NOT_FOUND,
        "Resolved position has no spaceId",
      );
    }
    return String(target.spaceId);
  }
  const id = targetIdOf(target);
  if (!id)
    throw new IbpError(
      IBP_ERR.SPACE_NOT_FOUND,
      "Target does not resolve to a space",
    );
  return String(id);
}

function requireActor(identity) {
  if (!identity?.beingId) {
    throw new IbpError(
      IBP_ERR.UNAUTHORIZED,
      "An authenticated being is required",
    );
  }
  return String(identity.beingId);
}

// ownership.js throws plain Errors; map their messages to IBP codes so
// the portal shows FORBIDDEN / NOT_FOUND rather than a generic 500.
const PERMISSION_ERROR_PATTERNS = [
  [
    /only the .*owner|cannot add the owner|already the owner|cannot modify heaven|cannot set ownership|stance authorization/i,
    IBP_ERR.FORBIDDEN,
  ],
  [/not found/i, IBP_ERR.SPACE_NOT_FOUND],
  [/being is being modified|concurrently/i, IBP_ERR.RESOURCE_CONFLICT],
  [/maximum|required|cannot/i, IBP_ERR.INVALID_INPUT],
];

// add-contributor / remove-contributor RETIRED 2026-06-09. Under
// AblesAreAuth, "contributor" is just a able like any other. Granting
// editing authority over a space is: grant-able to a being whose able
// has the relevant canDo at this space.
//
// Migration:
//   OLD: do(<space>, "add-contributor",    { contributorId })
//   NEW: do(<being>, "grant-able",         { able: "contributor",
//                                            anchorSpaceId: <space> })
//
//   OLD: do(<space>, "remove-contributor", { contributorId })
//   NEW: do(<being>, "revoke-able",        { able: "contributor",
//                                            anchorSpaceId: <space>,
//                                            grantedBy: <originalGrantor> })
//
// Operators define their own contributor able via the able-manager UI
// (set-able) with whatever canDo entries fit their story.

// set-owner / remove-owner moved to store/words/owner/ (WORD-SOLE: set-owner.word +
// remove-owner.word + ownerHostEnv). The auth + per-space lock + CAS stay in ownership.js
// (setOwner / removeOwner), now reached as `see` escapes. Imported for side effects by genesis.js.

// ─────────────────────────────────────────────────────────────────────
// PRIVATE HELPERS
// ─────────────────────────────────────────────────────────────────────
//
// Stance-arrival handler for create-space. When the op's target arrives
// from the IBP wire, it's a resolved stance (carries `.chain`,
// `.spaceId`, `.isSpaceRoot`, `.isHomeRoot`). The inline branch above
// handles Mongoose-doc shapes; this helper handles the wire shape.

const KERNEL_ERROR_PATTERNS = {
  createChild: [
    [/cancelled by extension/i, IBP_ERR.FORBIDDEN],
    [/place heaven spaces|reserved|invalid/i, IBP_ERR.INVALID_INPUT],
    [/not found/i, IBP_ERR.SPACE_NOT_FOUND],
  ],
  rename: [
    [/place heaven spaces/i, IBP_ERR.FORBIDDEN],
    [/not found/i, IBP_ERR.SPACE_NOT_FOUND],
    [/cannot|reserved|invalid|characters|empty/i, IBP_ERR.INVALID_INPUT],
  ],
};

async function createSpaceChild({ target, params, identity, moment, kind }) {
  const beingId = identity?.beingId || null;
  const actId = moment?.actId || null;
  const { name, type = null, size = null } = params || {};
  if (!name || typeof name !== "string") {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "`name` is required");
  }

  // Non-stance path: trust the caller, parent is the target. Accepts
  // any of the shapes targetIdOf() handles (Mongoose doc, plain
  // {_id} / {id} / {spaceId} envelope, raw string id).
  if (kind !== "stance") {
    try {
      const newSpace = await createSpace({
        name,
        type,
        size,
        parentId: targetIdOf(target),
        beingId,
        actId,
        moment,
      });
      return shapeNewSpace(newSpace);
    } catch (err) {
      throw mapPatternsToIbpError(err, KERNEL_ERROR_PATTERNS.createChild);
    }
  }

  // Stance-arrival path.
  if (target.isSpaceRoot) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      "Cannot create-child at the place root. Create inside your home (~) instead.",
    );
  }
  if (!target.spaceId) {
    throw new IbpError(
      IBP_ERR.SPACE_NOT_FOUND,
      "Resolved position has no spaceId",
    );
  }
  try {
    const newSpace = await createSpace({
      name,
      type,
      size,
      parentId: target.spaceId,
      beingId,
      actId,
    });
    return shapeNewSpace(newSpace);
  } catch (err) {
    throw mapPatternsToIbpError(err, KERNEL_ERROR_PATTERNS.createChild);
  }
}

function shapeNewSpace(newSpace) {
  const spaceId = String(newSpace._id);
  return targetsFact(
    {
      spaceId,
      name: newSpace.name,
      position: `${getStoryDomain()}/${spaceId}`,
    },
    { kind: "space", id: spaceId },
  );
}
