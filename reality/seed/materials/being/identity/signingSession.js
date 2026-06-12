// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// signingSession — the secondary unlock (IDENTITY.md "the felt control").
//
// The reality holds a hosted being's private key in custody, but it
// only SIGNS for a human while their session is UNLOCKED with a secret
// the human holds. No active unlocked session, no signature on their
// acts (the seal still lands — unsigned). This does not remove the
// custodial ceiling (a malicious host can bypass its own check); it
// raises the bar and makes the control felt. Sovereign self-hosters
// already are their own custodian, so for them this is just a latch.
//
// Scope: HUMANS ONLY. Scripted and LLM beings (the seed delegates)
// have no hand to type a secret; their cognition runs in-process, so
// gating them would only turn the whole tree unsigned. I_AM signs with
// the reality key and is the reality itself.
//
// State is in-memory and deliberately NOT facts: liveness of a signing
// session is security state of the running host, not world history.
// The unlock/lock ACTS are still recorded (the ops stamp audit facts);
// only the live latch lives here. A restart locks everyone, which is
// the safe direction.

const DEFAULT_TTL_MS = 30 * 60_000;   // 30 minutes, slid on every signed seal

const _unlocked = new Map();          // beingId -> expiresAt (ms epoch)

/** Open (or refresh) a signing session for a being. */
export function unlockSigning(beingId, ttlMs = DEFAULT_TTL_MS) {
  if (!beingId) return;
  _unlocked.set(String(beingId), Date.now() + ttlMs);
}

/** Close a being's signing session (sign-out, explicit lock). */
export function lockSigning(beingId) {
  _unlocked.delete(String(beingId));
}

/** Is this being's signing session live? Expired entries drop lazily. */
export function isSigningUnlocked(beingId) {
  const exp = _unlocked.get(String(beingId));
  if (!exp) return false;
  if (Date.now() > exp) { _unlocked.delete(String(beingId)); return false; }
  return true;
}

/** Slide the TTL forward (called on each signed seal so an active
 *  human stays unlocked; idle sessions re-lock on their own). */
export function touchSigning(beingId, ttlMs = DEFAULT_TTL_MS) {
  if (isSigningUnlocked(beingId)) {
    _unlocked.set(String(beingId), Date.now() + ttlMs);
  }
}
