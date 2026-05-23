// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Seed delegates. My first delegates — pre-planted beings that
// every place ships with.
//
// Every place has a small set of beings I plant at the place root
// itself, not at any tree:
//
//   cherub         The gate. Stands at the threshold between outside
//                  the place (no identity yet) and inside (bound to
//                  a being). The only stance that accepts a request
//                  from an unidentified arrival. BE register/claim/
//                  release/switch. Scripted cognition.
//   llm-assigner   Configures LLM connections (per-being and
//                  per-tree slot assignments) + the first-time setup
//                  tutorial. Scripted cognition.
//   place-manager  Conversational interface for place-level admin
//                  (extensions, config, peers). LLM cognition —
//                  the only one of the three whose moments are
//                  factory-assembled frames.
//
// They exist as real Being rows so the descriptor can surface them
// and the address grammar resolves `<place>/@cherub` (etc.) to them.
//
// These are beings I formed from myself, but they are no longer me.
// They have their own identities, their own summon paths, their own
// stances. Anything they do attributes to their own beingId, not to
// me.
//
// Being-tree parenting. Every place has exactly one I-Am at the
// root of the being-tree (the only Being with `parentBeingId:
// null`), planted during `ensurePlaceRoot()`. The delegates here
// and every human are my children. Walking parentBeingId from any
// being eventually reaches me, then `null`.
//
// `ensureSeedDelegates(placeRootId)` runs at genesis after my Being
// row exists. Idempotent: safe to call every boot. The drift
// reconciler also keeps existing delegate parentBeingId pointed at
// me.
//
// Lookups for I_AM identity (`findIAm`, `iAmIdentity`,
// `findRootOperator`) live alongside other identity primitives in
// [identity.js](identity.js). This file owns the delegate roster
// and the scaffold that ensures their rows exist.

import log from "../../system/log.js";
import Being from "./being.js";
import Space from "../space/space.js";
import { summonCreateBeing } from "../../ibp/verbs.js";
import { findIAm, iAmIdentity } from "./identity.js";

export const SEED_DELEGATES = [
  {
    name: "cherub",
    role: "cherub",
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
 * Ensure each seed delegate exists as a Being row, has the place
 * root as its home, is parented under me (the only Being with
 * parentBeingId: null) in the being-tree, and is registered in
 * qualities.beings at the place root. Returns a summary
 * { created, existing, deferred }.
 *
 * Deferred when I do not yet exist as a Being row (pre-bootstrap
 * place). ensurePlaceRoot() creates my row first and then calls
 * this. Subsequent boots re-run idempotently to backfill any drift.
 */
export async function ensureSeedDelegates(placeRootId) {
  if (!placeRootId) {
    log.warn("SeedDelegates", "ensureSeedDelegates called without a placeRootId");
    return { created: 0, existing: 0, deferred: false };
  }

  const placeRoot = await Space.findById(placeRootId);
  if (!placeRoot) {
    log.warn(
      "SeedDelegates",
      `place root ${String(placeRootId).slice(0, 8)} not found; skipping`,
    );
    return { created: 0, existing: 0, deferred: false };
  }

  const iAm = await findIAm();
  if (!iAm) {
    log.info(
      "SeedDelegates",
      "no I_AM yet; deferring seed-delegate setup until ensurePlaceRoot() runs",
    );
    return { created: 0, existing: 0, deferred: true };
  }
  const rootBeingId = String(iAm._id);

  let created = 0;
  let existing = 0;

  for (const spec of SEED_DELEGATES) {
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
        // Sync roles[] + defaultRole to the spec's single role. Seed
        // delegates carry exactly the role the spec names; if the
        // spec changes, the being is updated.
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
        // The being-tree chain delegate → me → null must hold.
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

      // I summon the new being forth. SUMMON is the verb of one
      // being calling another, and the act of calling a not-yet-
      // being into being is the same act. The seed-internal helper
      // writes the Being row + audits the act as my own. homeSpace
      // = place root because seed delegates live at the place root
      // itself; parent = me, so the being-tree chain delegate → me
      // → null is intact.
      const iAmIdent = await iAmIdentity();
      await summonCreateBeing({
        spec: {
          name: spec.name,
          role: spec.role,
          operatingMode: spec.operatingMode,
          homeSpace: String(placeRootId),
          parentBeingId: rootBeingId,
        },
        identity: iAmIdent,
        scaffold: true,
      });
      created++;
      log.info(
        "SeedDelegates",
        `summoned ${spec.role} delegate forth (name=${spec.name})`,
      );
    } catch (err) {
      log.error(
        "SeedDelegates",
        `failed to ensure ${spec.role} delegate: ${err.message}`,
      );
    }
  }

  if (created > 0 || existing > 0) {
    log.info(
      "SeedDelegates",
      `seed delegates ensured: ${created} created, ${existing} already present (parent=${rootBeingId.slice(0, 8)})`,
    );
  }
  return { created, existing, deferred: false };
}
