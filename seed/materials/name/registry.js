// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// registry — resolve a name-address token to a nameId (pubkey).
//
// In the IBPA, a Name can be addressed either by its PUBKEY (the z-form id)
// or by its REAL NAME (Name.name, the human handle): `<realName>@<story>`
// auto-resolves to the pubkey behind the scenes on the server that holds
// the registry. The "registry" is just the Name projections themselves —
// findByName("name", realName, "0") looks a Name up by its `name` field
// (story-scoped; Names live on main). A token that is already a pubkey is
// returned as-is; the literal "i-am" is the story root.

import { isKeyId } from "./keys.js";

/**
 * Resolve a name token (pubkey or real-name) to its nameId, or null if a
 * real-name doesn't resolve on this server.
 * @param {string} token  a pubkey, "i-am", or a real-name
 * @returns {Promise<string|null>}
 */
export async function resolveNameId(token) {
  if (!token || typeof token !== "string") return null;
  if (token === "i-am") return "i-am";   // the story root's literal id
  if (isKeyId(token)) return token;       // already a pubkey
  const { findByName } = await import("../projections.js");
  const slot = await findByName("name", token, "0");
  return slot ? String(slot.id) : null;
}
