// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Name reducer. (state, fact) -> state.
//
// One pure function per material type, per FOLD.md. The fold engine
// hands this reducer each fact on a Name's reel in seq order and
// accumulates the returned state into the Name projection. The Name's
// biography is its act-chain; its reel carries the identity-layer facts
// (declare, close, soul transitions) that fold into this row.
//
// Pure: same (state, fact) -> same state, every time. No I/O, no clocks,
// no reads outside `state` and `fact`. This is what makes rebuild
// deterministic.

import { applySetQualities, applySetField } from "../reducerHelpers.js";

/** Empty initial state. */
export function initial() {
  return {};
}

// name:declare (a.k.a. mint) — seed the Name row from the declare fact's
// spec. The spec carries the identity-layer fields lifted off Being:
// the lineage, the custodial encrypted key, the key-scheme descriptor,
// the default Soul, and the federation markers. No-op for any other fact.
function applyMintName(state, fact) {
  if (fact?.verb !== "name") return state;
  if (fact.act !== "declare" && fact.act !== "mint") return state;
  const spec = fact?.params?.spec;
  if (!spec || typeof spec !== "object") return state;
  return {
    ...state,
    parentNameId:  spec.parentNameId ?? null,
    privateKeyEnc: spec.privateKeyEnc ?? null,
    identity:      spec.identity ?? null,
    soulType:      spec.soulType ?? null,
    // The real name (trueName.name) — the optional human handle.
    name:          spec.name ?? null,
    createdAt:     state.createdAt ?? fact.date,
    updatedAt:     fact.date,
  };
}

// name:banish (a.k.a. close) — the Name tombstones itself: no fact can ever
// be signed by it again (the gate lives upstream in logFact, like be:death).
// The history persists; this just folds the closed marker. Idempotent.
function applyCloseName(state, fact) {
  if (fact?.verb !== "name") return state;
  if (fact.act !== "banish" && fact.act !== "close") return state;
  if (state.closedAt) return state;
  return { ...state, closedAt: fact.date, updatedAt: fact.date };
}

// name:connect / name:release — the session lifecycle, mirroring be:connect /
// be:release at the identity layer. The reel IS the truth of whether the Name
// is connected (a live session holds its key): connect folds connected:true,
// release folds connected:false. The handlers gate the transitions (can't
// connect twice, can't release when not connected) by reading this state. No
// wall-clock timestamp here — WHEN it connected/released is the connect/release
// fact's own position on the reel (the fact-reel IS the time); the folded
// state only needs the boolean.
function applyNameSession(state, fact) {
  if (fact?.verb !== "name") return state;
  if (fact.act === "connect") return { ...state, connected: true };
  if (fact.act === "release") return { ...state, connected: false };
  return state;
}

// name:set-password — re-key the private key under a new password (or back to
// the system key when the password is removed). Folds ONLY the new
// privateKeyEnc; the identity (the pubkey _id) never changes, just the at-rest
// encryption. The plaintext key never rides the fact — only the new encrypted
// blob, which is a SECRET_KEY (censored on serialize-out, redact.js).
function applySetPassword(state, fact) {
  if (fact?.verb !== "name" || fact.act !== "set-password") return state;
  const spec = fact?.params?.spec;
  if (!spec || spec.privateKeyEnc == null) return state;
  return { ...state, privateKeyEnc: spec.privateKeyEnc };
}

/**
 * Apply one fact to the Name state.
 *
 * @param {object} state  current accumulated state
 * @param {object} fact   the fact to apply
 * @returns {object} new state
 */
export function reduce(state, fact) {
  let next = state;

  // name:declare — produces the initial row state from spec.
  next = applyMintName(next, fact);

  // name:close — locks the Name's lifecycle (history persists).
  next = applyCloseName(next, fact);

  // name:connect / name:release — the session lifecycle on the reel.
  next = applyNameSession(next, fact);

  // name:set-password — re-key the private key under a new (or removed) password.
  next = applySetPassword(next, fact);

  // do:set on this Name — scalar fields + qualities paths (e.g. a soul
  // transition writing qualities.soul, or auth carve-outs). Reuses the
  // shared set helpers; they operate on state generically.
  next = applySetField(next, fact);
  next = applySetQualities(next, fact);

  // updatedAt is reducer-owned (nothing auto-stamps it on Name). Bump on
  // any state-mutating apply so rebuild reproduces the live fold's value.
  if (next !== state) {
    next = { ...next, updatedAt: fact.date };
  }

  return next === state ? { ...state } : next;
}
