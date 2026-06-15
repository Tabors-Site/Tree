// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// signingSession — the per-Name signing latch + key holder.
//
// A Name's private key may be PASSWORD-LOCKED: its `privateKeyEnc` is
// encrypted with a key derived from the Name's password (materials/name/
// passwordKey.js), so the server CANNOT auto-decrypt it. Logging in
// (real-name + password) decrypts the key once and hands it to this
// module, which HOLDS the decrypted PEM in memory for the session. While
// the session is open, the stamper signs the Name's acts with the held
// key; on logout (or TTL expiry) the key is wiped and the Name's acts
// seal UNSIGNED until the next login. A Name whose key is NOT password-
// locked (system-encrypted, or I_AM's reality key) never needs this —
// signing is automatic.
//
// All Names are the same here: the latch is NOT soul-type-gated. It is a
// function of whether the key is password-locked, not of human/llm/scripted.
// Real-name + password are always OPTIONAL — a holder can also act with the
// raw private key directly, never touching this latch.
//
// State is in-memory and deliberately NOT facts: liveness of a signing
// session is security state of the running host, not world history. The
// login/logout ACTS are recorded (audit facts); only the live latch + the
// held key live here. A restart locks everyone (the safe direction) — the
// held keys are gone and everyone re-authenticates.

const DEFAULT_TTL_MS = 30 * 60_000;   // 30 minutes, slid on every signed seal

const _unlocked = new Map();          // nameId -> { key: PEM|null, expiresAt }

/**
 * Open (or refresh) a signing session for a Name. `key` is the decrypted
 * private-key PEM the login produced for a password-locked Name; pass null
 * for a plain unlock (no key held) where the server holds the key itself.
 */
export function unlockSigning(nameId, key = null, ttlMs = DEFAULT_TTL_MS) {
  if (!nameId) return;
  _unlocked.set(String(nameId), { key: key || null, expiresAt: Date.now() + ttlMs });
}

/** Close a Name's signing session (logout, explicit lock). Wipes the key. */
export function lockSigning(nameId) {
  _unlocked.delete(String(nameId));
}

/** Is this Name's signing session live? Expired entries drop lazily. */
export function isSigningUnlocked(nameId) {
  const e = _unlocked.get(String(nameId));
  if (!e) return false;
  if (Date.now() > e.expiresAt) { _unlocked.delete(String(nameId)); return false; }
  return true;
}

/**
 * The decrypted private-key PEM held for this Name's open session, or null
 * when locked / expired / no key was held. loadSigningKey reads this for a
 * password-locked Name.
 */
export function getSigningKey(nameId) {
  if (!isSigningUnlocked(nameId)) return null;
  return _unlocked.get(String(nameId))?.key ?? null;
}

/** Slide the TTL forward (called on each signed seal so an active session
 *  stays unlocked; idle sessions re-lock on their own). */
export function touchSigning(nameId, ttlMs = DEFAULT_TTL_MS) {
  const e = _unlocked.get(String(nameId));
  if (e && Date.now() <= e.expiresAt) {
    e.expiresAt = Date.now() + ttlMs;
  }
}
