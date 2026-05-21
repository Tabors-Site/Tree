// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// The place beings. My first delegates.
//
// Every place has a small set of beings I plant at the place root
// itself, not at any tree:
//
//   auth          BE register/claim/release/switch. Scripted cognition.
//   llm-assigner  Configures LLM connections. Scripted cognition.
//   place-manager  Conversational interface for place-level admin
//                 (extensions, config, peers). LLM cognition.
//
// They exist as real Being rows so the descriptor can surface them
// and the address grammar resolves `<place>/@auth` (etc.) to them.
//
// These are beings I formed from myself, but they are no longer me.
// They have their own identities, their own summon paths, their own
// stances. Anything they do attributes to their own beingId, not to
// me. The distinction matters: I am the kernel acting; they are
// first-class participants the world addresses by name.
//
// Being-tree parenting. Every place has exactly one I-Am at the root
// of the being-tree (the only Being with `parentBeingId: null`),
// planted during `ensurePlaceRoot()`. The place beings (auth,
// llm-assigner, place-manager) and every human are my children.
// Walking parentBeingId from any being eventually reaches me, then
// `null`.
//
// `ensurePlaceBeings(placeRootId)` runs at genesis after my Being row
// exists. Idempotent: safe to call every boot. The drift reconciler
// also keeps existing place beings' parentBeingId pointed at me.
//
// Each place being's password is auto-generated random bytes,
// bcrypt-hashed by the Being model's pre-save hook. The plaintext
// is discarded after hashing. A future admin operation could reset
// the password to allow a human to inhabit one of these beings.

import log from "../../system/log.js";
import Being from "../../models/being.js";
import Space from "../../models/space.js";
import { createBeingWithHome } from "./identity.js";

/**
 * Find the I_AM: the place's first Being row, the root of the being-
 * tree, identified by `parentBeingId: null`. Every other being on the
 * place chains back to it. Created during `ensurePlaceRoot()`; absent
 * only on a pre-bootstrap place.
 */
export async function findIAm() {
  return Being.findOne({ parentBeingId: null }).select("_id name").lean();
}

// Cached I_AM identity object suitable for `opts.identity` on verb
// calls. The I_AM has universal authority on its place; kernel-internal
// callers (DO-trigger fan-out, scheduled-wake tick, genesis scaffolding)
// pass this identity so `authorize` shorts to allow.
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
 * `operatingMode === "human"`. Returns null on a fresh place before any
 * human has registered. Use this for "who runs this place" checks
 * (place-LLM config, root-only operations); use `findIAm()` for
 * "who is the substrate's identity" checks.
 */
export async function findRootOperator() {
  return Being.findOne({ operatingMode: "human" })
    .sort({ _id: 1 })
    .select("_id name")
    .lean();
}

const PLACE_BEINGS = [
  {
    name: "auth",
    role: "auth",
    operatingMode: "scripted",
    description:
      "Welcome character; processes BE register/claim/release/switch.",
  },
  {
    name: "llm-assigner",
    role: "llm-assigner",
    operatingMode: "scripted",
    description:
      "Configures LLM connections — caller's being, owned nodes, or place default (root operator only for place scope).",
  },
  {
    name: "place-manager",
    role: "place-manager",
    operatingMode: "llm",
    description:
      "Conversational interface for place-level administration (extensions, config, peers). Carries no authority of its own; its writes are gated by the caller's stance — root operator, or owner / contributor on the place root.",
  },
];

/**
 * Ensure each place being exists as a Being row, has the place root as
 * its home, is parented under me (the only Being with
 * parentBeingId: null) in the being-tree, and is registered in
 * qualities.beings at the place root. Returns a summary
 * { created, existing, deferred }.
 *
 * Deferred when I do not yet exist as a Being row (pre-bootstrap
 * place). ensurePlaceRoot() creates my row first and then calls this.
 * Subsequent boots re-run idempotently to backfill any drift.
 */
export async function ensurePlaceBeings(placeRootId) {
  if (!placeRootId) {
    log.warn("PlaceBeings", "ensurePlaceBeings called without a placeRootId");
    return { created: 0, existing: 0, deferred: false };
  }

  const placeRoot = await Space.findById(placeRootId);
  if (!placeRoot) {
    log.warn(
      "PlaceBeings",
      `place root ${String(placeRootId).slice(0, 8)} not found; skipping`,
    );
    return { created: 0, existing: 0, deferred: false };
  }

  const iAm = await findIAm();
  if (!iAm) {
    log.info(
      "PlaceBeings",
      "no I_AM yet; deferring system-being setup until ensurePlaceRoot() runs",
    );
    return { created: 0, existing: 0, deferred: true };
  }
  const rootBeingId = String(iAm._id);

  let created = 0;
  let existing = 0;

  for (const spec of PLACE_BEINGS) {
    try {
      // Look up by name (the canonical identifier per place).
      const existingBeing = await Being.findOne({ name: spec.name }).select(
        "_id roles defaultRole homeSpace operatingMode parentBeingId",
      );
      if (existingBeing) {
        // Idempotent drift correction: keep mode/role/home/parent in sync.
        let dirty = false;
        if (existingBeing.operatingMode !== spec.operatingMode) {
          existingBeing.operatingMode = spec.operatingMode;
          dirty = true;
        }
        // Sync roles[] + defaultRole to the spec's single role. System
        // beings carry exactly the role the spec names; if the spec
        // changes, the being is updated.
        const carried = Array.isArray(existingBeing.roles)
          ? existingBeing.roles
          : [];
        if (!carried.includes(spec.role) || carried.length !== 1) {
          existingBeing.roles = [spec.role];
          dirty = true;
        }
        if (existingBeing.defaultRole !== spec.role) {
          existingBeing.defaultRole = spec.role;
          dirty = true;
        }
        if (existingBeing.homeSpace !== String(placeRootId)) {
          existingBeing.homeSpace = String(placeRootId);
          dirty = true;
        }
        // Re-parent under me if drift left parentBeingId out of date.
        // The being-tree chain place-being → me → null must hold.
        if (existingBeing.parentBeingId !== rootBeingId) {
          existingBeing.parentBeingId = rootBeingId;
          dirty = true;
          await Being.updateOne(
            { _id: rootBeingId },
            { $addToSet: { children: String(existingBeing._id) } },
          );
        }
        if (dirty) await existingBeing.save();
        existing++;
        continue;
      }

      // Fresh insert via the unified primitive. homeSpace = place root
      // because place beings don't create their own child spaces — they
      // live at the place root itself. parentBeingId = me, so the
      // being-tree chain place-being → me → null is intact.
      // createBeingWithHome links into my children list itself.
      await createBeingWithHome({
        operatingMode: spec.operatingMode,
        name: spec.name,
        role: spec.role,
        homeSpace: String(placeRootId),
        parentBeingId: rootBeingId,
      });
      created++;
      log.info("PlaceBeings", `created ${spec.role} being (name=${spec.name})`);
    } catch (err) {
      log.error(
        "PlaceBeings",
        `failed to ensure ${spec.role} being: ${err.message}`,
      );
    }
  }

  if (created > 0 || existing > 0) {
    log.info(
      "PlaceBeings",
      `place beings ensured: ${created} created, ${existing} already present (parent=${rootBeingId.slice(0, 8)})`,
    );
  }
  return { created, existing, deferred: false };
}
