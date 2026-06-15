// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// name connect / release — bind / unbind a Name to the session, mirroring
// be:connect / be:release at the identity layer. (The NAME lifecycle mirrors
// BE: declare = the name's "birth", connect/release bind/unbind the session,
// banish = its death.) connect resolves the Name (by real-name or pubkey),
// decrypts its password-locked key with the password, and HANDS THE DECRYPTED
// KEY to the signing session, which holds it; the stamper's loadSigningKey
// reads the held key. release wipes it ("the name calling its own release").
//
// This is the OPTIONAL easier-access path. A Name with no password is
// system-key (the server signs automatically — no connect needed); and a
// holder can always act with the raw private key directly. So name:connect is
// purely a convenience over the keypair.

import { resolveNameId } from "./registry.js";
import { decryptWithPassword, isPasswordLocked } from "./passwordKey.js";
import { unlockSigning, lockSigning } from "./signingSession.js";

/**
 * Connect a Name to the session (the identity-layer be:connect). `token` is a
 * real-name or a pubkey; `password` decrypts the password-locked key into the
 * signing session.
 *
 * @returns {Promise<{ok:true, nameId:string} | {ok:false, reason:string}>}
 */
export async function nameConnect(token, password) {
  const nameId = await resolveNameId(token);
  if (!nameId) return { ok: false, reason: "no-such-name" };
  if (nameId === "i-am") return { ok: false, reason: "i-am-is-the-reality" };

  const { loadProjection } = await import("../projections.js");
  const slot = await loadProjection("name", nameId, "0");
  const enc = slot?.state?.privateKeyEnc;
  if (!enc) return { ok: false, reason: "no-key" };

  // System-encrypted (no password set): the server holds the key and signs
  // automatically; there is nothing to unlock with a password.
  if (!isPasswordLocked(enc)) return { ok: false, reason: "name-has-no-password" };

  const pem = decryptWithPassword(enc, password);
  if (!pem) return { ok: false, reason: "bad-password" };

  // Hold the decrypted key for the session; the stamper signs with it.
  unlockSigning(nameId, pem);
  return { ok: true, nameId };
}

/** Release a Name from the session: wipe its held key and unbind it (the
 *  identity-layer be:release — "the name calling its own release"). */
export function nameRelease(nameId) {
  if (!nameId) return { ok: false, reason: "no-name" };
  lockSigning(nameId);
  return { ok: true, nameId };
}
