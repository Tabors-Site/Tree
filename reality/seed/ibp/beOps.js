// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// BE_OPS . the canonical BE operations.
//
// BE is a closed set: birth, connect, release, death. The substrate
// fixes this list; no extension adds a fifth. So unlike DO (which is
// open and needs a registry), BE just exports a static table.
//
// Each op carries:
//   description   . one-line summary (for the portal's action menu)
//   label         . display name ("Register", "Log in", "Log out")
//   args          . structured arg schema for the portal form renderer
//                   (subset of JSON Schema: type, label, required,
//                   default, minLength, description)
//   handler       . async fn the BE verb dispatches to
//   bootstrap     . if true, beVerb skips assertVerbCaller (used by
//                   birth/connect . the caller has no identity yet)
//
// The handlers live with their owning being's code (cherub's birth/
// connect/release implementations are in seed/present/roles/cherub/
// role.js); this file just imports them into the canonical table. The
// BE verb in ibp/verbs/be.js dispatches `BE_OPS[operation]?.handler(...)`.
//
// Cherub is currently the only being that handles BE. The four ops
// are universal identity surface, not per-being behavior . if a
// future reality wanted a different welcome-character, that being's
// role would still license `canBe: ["birth", "connect", "release", "death"]`
// and rely on the same static table.

import { cherubBeOps } from "../present/roles/cherub/role.js";

export const BE_OPS = Object.freeze({
  birth:   cherubBeOps.birth,
  connect: cherubBeOps.connect,
  release: cherubBeOps.release,
  death:   cherubBeOps.death,
});

/**
 * Look up a BE op by name. Returns null when not in the static set
 * (which means the caller asked for an op that doesn't exist . the
 * BE verb throws ACTION_NOT_SUPPORTED).
 */
export function getBeOp(name) {
  return BE_OPS[name] || null;
}

/**
 * List BE op names. Used by descriptor.enrichBeings to filter a role's
 * `canBe` license against the static set (drop any names the role
 * declared that aren't real ops).
 */
export function listBeOpNames() {
  return Object.keys(BE_OPS);
}
