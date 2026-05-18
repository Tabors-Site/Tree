// TreeOS Seed — system beings.
//
// Every land has a small set of AI beings that live at the land root
// itself, not at any tree: the auth-being (handles BE register/claim/
// release), the land-manager (god-tier administration), and citizen
// (read-only browsing). These need to exist as real Being rows in the
// beings table so the descriptor can surface them and the address
// grammar can resolve `<land>/@<username>` to them.
//
// `ensureSystemBeings(landRootId)` runs at boot (after the User → Being
// migration and after the land root exists). It creates each system
// being if missing and writes `metadata.beings.<role>.beingId` on
// the land root pointing at the being. Idempotent — safe to call on
// every boot.
//
// Each being's password is auto-generated random bytes, bcrypt-hashed
// by the Being model's pre-save hook. The plaintext is discarded after
// hashing. A future admin operation could reset the password to allow
// a human to "inhabit" an AI being.

import log from "./log.js";
import Being from "./models/being.js";
import Node from "./models/node.js";
import { createBeingWithHome } from "./auth.js";

const SYSTEM_BEINGS = [
  {
    username: "auth",
    role:     "auth",
    description: "Welcome character; processes BE register/claim/release/switch.",
  },
  {
    username: "land-manager",
    role:     "land-manager",
    description: "God-tier administration: extensions, config, peers.",
  },
  {
    username: "citizen",
    role:     "citizen",
    description: "Read-only browsing of the land's public surface.",
  },
];

/**
 * Ensure each system being exists as a Being row, has the land root
 * as its home, and is registered in metadata.beings at the land
 * root. Returns a summary { created, existing }.
 */
export async function ensureSystemBeings(landRootId) {
  if (!landRootId) {
    log.warn("SystemBeings", "ensureSystemBeings called without a landRootId");
    return { created: 0, existing: 0 };
  }

  const landRoot = await Node.findById(landRootId);
  if (!landRoot) {
    log.warn("SystemBeings", `land root ${String(landRootId).slice(0, 8)} not found; skipping`);
    return { created: 0, existing: 0 };
  }

  let created = 0;
  let existing = 0;

  for (const spec of SYSTEM_BEINGS) {
    try {
      // Look up by username (the canonical identifier per land).
      const existingBeing = await Being.findOne({ username: spec.username })
        .select("_id roles defaultRole homePositionId operatingMode");
      if (existingBeing) {
        // Idempotent drift correction: keep mode/role/home in sync.
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
        if (dirty) await existingBeing.save();
        existing++;
        continue;
      }

      // Fresh insert via the unified primitive. homeNodeId = land root
      // because system beings don't create their own child nodes —
      // they live at the land root itself. createBeingWithHome handles
      // password generation and beings registration on the home.
      await createBeingWithHome({
        operatingMode: "ai",
        username:      spec.username,
        role:          spec.role,
        homeNodeId:    String(landRootId),
      });
      created++;
      log.info("SystemBeings", `created ${spec.role} being (username=${spec.username})`);
    } catch (err) {
      log.error("SystemBeings", `failed to ensure ${spec.role} being: ${err.message}`);
    }
  }

  if (created > 0 || existing > 0) {
    log.info("SystemBeings", `system beings ensured: ${created} created, ${existing} already present`);
  }
  return { created, existing };
}
