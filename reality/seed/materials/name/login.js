// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// login — open / close a Name's signing session with real-name + password.
//
// This is the OPTIONAL easier-access path. A Name whose key is password-
// locked (declared with a password) can only sign while logged in: login
// resolves the Name (by real-name or pubkey), decrypts its key with the
// password, and HANDS THE DECRYPTED KEY to the signing session, which holds
// it for the session. The stamper's loadSigningKey then reads the held key.
// Logout wipes it. A Name with no password is system-key (the server signs
// automatically — no login); and a holder can always act with the raw
// private key directly. So login is purely a convenience over the keypair.

import { resolveNameId } from "./registry.js";
import { decryptWithPassword, isPasswordLocked } from "./passwordKey.js";
import { unlockSigning, lockSigning } from "./signingSession.js";

/**
 * Log in to a Name. `token` is a real-name or a pubkey; `password` decrypts
 * the password-locked key into the session.
 *
 * @returns {Promise<{ok:true, nameId:string} | {ok:false, reason:string}>}
 */
export async function nameLogin(token, password) {
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

/** Log out a Name: wipe its held key and close the session. */
export function nameLogout(nameId) {
  if (!nameId) return { ok: false, reason: "no-name" };
  lockSigning(nameId);
  return { ok: true, nameId };
}
