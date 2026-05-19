// TreeOS Seed — system beings.
//
// Every land has a small set of AI beings that live at the land root
// itself, not at any tree: the auth-being (handles BE register/claim/
// release), the land-manager (god-tier administration), and citizen
// (read-only browsing). These need to exist as real Being rows in the
// beings table so the descriptor can surface them and the address
// grammar can resolve `<land>/@<username>` to them.
//
// Being-tree parenting: per the substrate-as-universal-workspace model,
// every land has exactly ONE root being (the first human who registers
// during land setup). System beings (auth, land-manager, citizen) are
// being-tree children of that root being — so walking parentBeingId
// from any system being reaches the operator, then null at the root.
//
// `ensureSystemBeings(landRootId)` runs at boot. If the root being does
// not yet exist (fresh land, no human has registered), the call is a
// no-op — system beings are deferred until first registration triggers
// the same flow. Idempotent — safe to call on every boot. The drift
// reconciler also keeps existing system beings' parentBeingId pointed
// at the current root being.
//
// Each being's password is auto-generated random bytes, bcrypt-hashed
// by the Being model's pre-save hook. The plaintext is discarded after
// hashing. A future admin operation could reset the password to allow
// a human to "inhabit" an AI being.

import log from "./log.js";
import Being from "../models/being.js";
import Node from "../models/node.js";
import { createBeingWithHome } from "./identity.js";

/**
 * Find the land's root being — the first admin human who registered.
 * Returns null if no human has registered yet (fresh land, deferred setup).
 */
export async function findRootBeing() {
  return Being.findOne({ operatingMode: "human", roles: "admin" })
    .sort({ _id: 1 })
    .select("_id name")
    .lean();
}

const SYSTEM_BEINGS = [
  {
    name: "auth",
    role: "auth",
    description: "Welcome character; processes BE register/claim/release/switch.",
  },
  {
    name: "land-manager",
    role: "land-manager",
    description: "God-tier administration: extensions, config, peers.",
  },
  {
    name: "citizen",
    role: "citizen",
    description: "Read-only browsing of the land's public surface.",
  },
];

/**
 * Ensure each system being exists as a Being row, has the land root
 * as its home, is parented to the root being (the first admin human)
 * in the being-tree, and is registered in metadata.beings at the
 * land root. Returns a summary { created, existing, deferred }.
 *
 * Deferred when the root being does not yet exist (fresh land before
 * first human registration). The registration flow re-invokes this
 * function right after `createFirstBeing` so system beings come up
 * with the correct parent chain.
 */
export async function ensureSystemBeings(landRootId) {
  if (!landRootId) {
    log.warn("SystemBeings", "ensureSystemBeings called without a landRootId");
    return { created: 0, existing: 0, deferred: false };
  }

  const landRoot = await Node.findById(landRootId);
  if (!landRoot) {
    log.warn("SystemBeings", `land root ${String(landRootId).slice(0, 8)} not found; skipping`);
    return { created: 0, existing: 0, deferred: false };
  }

  const rootBeing = await findRootBeing();
  if (!rootBeing) {
    log.info("SystemBeings", "no root being yet; deferring system-being setup until first human registers");
    return { created: 0, existing: 0, deferred: true };
  }
  const rootBeingId = String(rootBeing._id);

  let created = 0;
  let existing = 0;

  for (const spec of SYSTEM_BEINGS) {
    try {
      // Look up by username (the canonical identifier per land).
      const existingBeing = await Being.findOne({ name: spec.name })
        .select("_id roles defaultRole homePositionId operatingMode parentBeingId");
      if (existingBeing) {
        // Idempotent drift correction: keep mode/role/home/parent in sync.
        let dirty = false;
        if (existingBeing.operatingMode !== "ai") { existingBeing.operatingMode = "ai"; dirty = true; }
        // Sync roles[] + defaultRole to the spec's single role. System
        // beings carry exactly the role the spec names; if the spec
        // changes, the being is updated.
        const carried = Array.isArray(existingBeing.roles) ? existingBeing.roles : [];
        if (!carried.includes(spec.role) || carried.length !== 1) {
          existingBeing.roles = [spec.role];
          dirty = true;
        }
        if (existingBeing.defaultRole !== spec.role) {
          existingBeing.defaultRole = spec.role;
          dirty = true;
        }
        if (existingBeing.homePositionId !== String(landRootId)) {
          existingBeing.homePositionId = String(landRootId);
          dirty = true;
        }
        // Re-parent under the root being. Pre-being-tree lands have
        // null parents on system beings; this backfills them.
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

      // Fresh insert via the unified primitive. homeNodeId = land root
      // because system beings don't create their own child nodes —
      // they live at the land root itself. parentBeingId = root being
      // so the being-tree chain system-being → root → null is intact.
      // createBeingWithHome links into the root's children list itself.
      await createBeingWithHome({
        operatingMode: "ai",
        name:          spec.name,
        role:          spec.role,
        homeNodeId:    String(landRootId),
        parentBeingId: rootBeingId,
      });
      created++;
      log.info("SystemBeings", `created ${spec.role} being (name=${spec.name})`);
    } catch (err) {
      log.error("SystemBeings", `failed to ensure ${spec.role} being: ${err.message}`);
    }
  }

  if (created > 0 || existing > 0) {
    log.info("SystemBeings", `system beings ensured: ${created} created, ${existing} already present (parent=${rootBeingId.slice(0, 8)})`);
  }
  return { created, existing, deferred: false };
}
