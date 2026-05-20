// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// System beings.
//
// Every land has a small set of AI beings that live at the land root
// itself, not at any tree: the auth-being (handles BE register/claim/
// release), the land-manager (conversational admin interface), and citizen
// (read-only browsing). These need to exist as real Being rows in the
// beings table so the descriptor can surface them and the address
// grammar can resolve `<land>/@<username>` to them.
//
// Being-tree parenting: every land has exactly ONE seed-being at the
// root of the being-tree (the only Being with parentBeingId: null).
// It is created during ensureLandRoot() — see seed/landRoot.js.
// System beings (auth, llm-assigner, land-manager, citizen) and every
// human are children of the seed-being. Walking parentBeingId from any
// being eventually reaches the seed-being, then null.
//
// `ensureSystemBeings(landRootId)` runs at boot after the seed-being
// exists. Idempotent — safe to call on every boot. The drift
// reconciler also keeps existing system beings' parentBeingId pointed
// at the current seed-being.
//
// Each being's password is auto-generated random bytes, bcrypt-hashed
// by the Being model's pre-save hook. The plaintext is discarded after
// hashing. A future admin operation could reset the password to allow
// a human to "inhabit" an AI being.

import log from "../system/log.js";
import Being from "../models/being.js";
import Space from "../models/space.js";
import { createBeingWithHome } from "./identity.js";

/**
 * Find the seed-being — the land's first Being row, the root of the
 * being-tree, identified by `parentBeingId: null`. Every other being on
 * the land chains back to it through parentBeingId. Created by
 * `ensureSeedBeing()` during `ensureLandRoot()` boot; absent only on a
 * pre-bootstrap land.
 */
export async function findSeedBeing() {
  return Being.findOne({ parentBeingId: null })
    .select("_id name")
    .lean();
}

/**
 * Find the land's root operator — the first human who registered.
 * The seed-being precedes them; the operator is the first being whose
 * `operatingMode === "human"`. Returns null on a fresh land before any
 * human has registered. Use this for "who runs this land" checks
 * (land-LLM config, root-only operations); use `findSeedBeing()` for
 * "who is the substrate's identity" checks.
 */
export async function findRootOperator() {
  return Being.findOne({ operatingMode: "human" })
    .sort({ _id: 1 })
    .select("_id name")
    .lean();
}

const SYSTEM_BEINGS = [
  {
    name: "auth",
    role: "auth",
    operatingMode: "scripted",
    description: "Welcome character; processes BE register/claim/release/switch.",
  },
  {
    name: "llm-assigner",
    role: "llm-assigner",
    operatingMode: "scripted",
    description: "Configures LLM connections — caller's being, owned nodes, or land default (root operator only for land scope).",
  },
  {
    name: "land-manager",
    role: "land-manager",
    operatingMode: "llm",
    description: "Conversational interface for land-level administration (extensions, config, peers). Carries no authority of its own; its writes are gated by the caller's stance — root operator, or owner / contributor on the land root.",
  },
  {
    name: "citizen",
    role: "citizen",
    operatingMode: "scripted",
    description: "Read-only browsing of the land's public surface.",
  },
];

/**
 * Ensure each system being exists as a Being row, has the land root
 * as its home, is parented under the seed-being (the only Being with
 * parentBeingId: null) in the being-tree, and is registered in
 * metadata.beings at the land root. Returns a summary
 * { created, existing, deferred }.
 *
 * Deferred when the seed-being does not yet exist (pre-bootstrap land).
 * ensureLandRoot() creates the seed-being and then calls this; lands
 * that already booted past first-ensure still re-run this idempotently
 * to backfill drift.
 */
export async function ensureSystemBeings(landRootId) {
  if (!landRootId) {
    log.warn("SystemBeings", "ensureSystemBeings called without a landRootId");
    return { created: 0, existing: 0, deferred: false };
  }

  const landRoot = await Space.findById(landRootId);
  if (!landRoot) {
    log.warn("SystemBeings", `land root ${String(landRootId).slice(0, 8)} not found; skipping`);
    return { created: 0, existing: 0, deferred: false };
  }

  const seedBeing = await findSeedBeing();
  if (!seedBeing) {
    log.info("SystemBeings", "no seed-being yet; deferring system-being setup until ensureLandRoot() runs");
    return { created: 0, existing: 0, deferred: true };
  }
  const rootBeingId = String(seedBeing._id);

  let created = 0;
  let existing = 0;

  for (const spec of SYSTEM_BEINGS) {
    try {
      // Look up by username (the canonical identifier per land).
      const existingBeing = await Being.findOne({ name: spec.name })
        .select("_id roles defaultRole homeSpace operatingMode parentBeingId");
      if (existingBeing) {
        // Idempotent drift correction: keep mode/role/home/parent in sync.
        let dirty = false;
        if (existingBeing.operatingMode !== spec.operatingMode) { existingBeing.operatingMode = spec.operatingMode; dirty = true; }
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
        if (existingBeing.homeSpace !== String(landRootId)) {
          existingBeing.homeSpace = String(landRootId);
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

      // Fresh insert via the unified primitive. homeSpace = land root
      // because system beings don't create their own child nodes —
      // they live at the land root itself. parentBeingId = root being
      // so the being-tree chain system-being → root → null is intact.
      // createBeingWithHome links into the root's children list itself.
      await createBeingWithHome({
        operatingMode: spec.operatingMode,
        name:          spec.name,
        role:          spec.role,
        homeSpace:     String(landRootId),
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

// Marker for the llm-assigner intro tutorial matter. Used by the
// being's start-tutorial / complete-tutorial BE ops to find + verify
// its own matters. Kept here next to the SYSTEM_BEINGS definition so
// system-being conventions live in one place.
export const LLM_ASSIGNER_TUTORIAL_MARK = "llm-assigner-intro";
export const LLM_ASSIGNER_TUTORIAL_URL  = "https://www.youtube.com/watch?v=_cXGZXdiVgw";
export const LLM_ASSIGNER_TUTORIAL_VIDEO_ID = "_cXGZXdiVgw";
