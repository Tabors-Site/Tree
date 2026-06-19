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
import { keypairFromPrivateKeyPem, keypairFromSeed } from "./keys.js";
import { mnemonicToEntropy } from "./mnemonic.js";

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
  if (nameId === "i-am") return { ok: false, reason: "i-am-is-the-story" };

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

/**
 * Connect a Name with its PRIVATE KEY directly — the true name itself. No
 * password: possessing the key IS the proof (the key's pubkey IS the nameId).
 * The holder presents the key (a PKCS8 PEM or the 24-word paper form); the
 * server derives the nameId, confirms the Name was declared here (and isn't
 * banished), then HOLDS the presented key for the session. This is the
 * doctrine "you can always act with the raw private key" made a portal login,
 * not just an API path. The server never persists it — it lives only in the
 * in-memory signing session until release.
 *
 * @returns {Promise<{ok:true, nameId:string} | {ok:false, reason:string}>}
 */
export async function nameConnectWithKey(privateKeyInput) {
  let kp;
  try {
    const s = String(privateKeyInput || "").trim();
    if (!s) return { ok: false, reason: "no-key" };
    const words = s.split(/\s+/);
    if (words.length === 24) kp = keypairFromSeed(mnemonicToEntropy(s));
    else if (/PRIVATE KEY/.test(s)) kp = keypairFromPrivateKeyPem(s);
    else return { ok: false, reason: "bad-key" };
  } catch { return { ok: false, reason: "bad-key" }; }

  const nameId = kp.nameId;
  if (nameId === "i-am") return { ok: false, reason: "i-am-is-the-story" };

  // The Name must have been declared on THIS story (a key whose name was
  // never declared here is no name here — import it first).
  const { loadProjection } = await import("../projections.js");
  const slot = await loadProjection("name", nameId, "0");
  if (!slot?.state) return { ok: false, reason: "no-such-name" };
  const { isNameBanished } = await import("./closure.js");
  if (await isNameBanished(nameId)) return { ok: false, reason: "banished" };

  // Hold the holder's own key for the session; the stamper signs with it.
  unlockSigning(nameId, kp.privateKeyPem);
  return { ok: true, nameId };
}

/** Release a Name from the session: wipe its held key and unbind it (the
 *  identity-layer be:release — "the name calling its own release"). */
export function nameRelease(nameId) {
  if (!nameId) return { ok: false, reason: "no-name" };
  lockSigning(nameId);
  return { ok: true, nameId };
}
