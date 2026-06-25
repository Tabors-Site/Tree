// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Library reducer. (state, fact) -> state.
//
// The story's ONE 5D library reel (of.kind "library", one per story, out of any history): the
// name-level / out-of-world facts, folded into a single catalog. A Name has an act-chain but NO
// reel of its own (it ACTS, it is never acted-on), so every name-level fact lands HERE:
//   - names    — name:declare/banish/connect/release/set-password (the Name identity rows)
//   - books    — share-book (the shared-books catalog)
//   - peers    — peer-add / peer-remove (the federation graph)
//   - config   — config-set / config-delete (story-level config)
// Pure + deterministic, symmetric with the being/space/matter reducers. Only Names act here.

// Name-level ops — the retired per-name reel's facts, now folded into the names catalog keyed by
// params.nameId. A Name has no reel; this catalog entry IS its folded state.
const NAME_OPS = new Set(["declare", "mint", "banish", "close", "connect", "release", "set-password"]);

/** Empty initial state. */
export function initial() {
  return { names: {}, books: {}, peers: {}, config: {} };
}

export function reduce(state, fact) {
  const act = fact?.act;
  const p = fact?.params || {};

  // Name identity facts — fold into names[nameId]. A Name acts through a being but is itself
  // never acted-on, so it has no reel; its declare/banish/connect/release/set-password facts ride
  // the library reel and fold into one catalog entry. (verb:"name"; nameId carried in params.)
  if (fact?.verb === "name" && NAME_OPS.has(act)) {
    const nameId = p.nameId;
    if (!nameId) return state;
    const names = state.names || {};
    const nextEntry = foldName(names[nameId] || {}, fact);
    if (names[nameId] && nextEntry === names[nameId]) return state; // idempotent no-op
    return { ...state, names: { ...names, [nameId]: nextEntry } };
  }

  // share-book — a book entered the catalog (latest share of a root wins).
  if (act === "share-book") {
    if (!p.root) return state;
    return {
      ...state,
      books: {
        ...state.books,
        [p.root]: { root: p.root, title: p.title ?? null, author: p.author ?? null, sharedBy: p.sharedBy ?? null, kind: p.kind ?? null, bodyRef: p.bodyRef ?? null, at: fact.date },
      },
    };
  }

  // peer-add / peer-remove — the federation graph (who this story is peered with).
  if (act === "peer-add") {
    if (!p.domain) return state;
    return { ...state, peers: { ...state.peers, [p.domain]: { domain: p.domain, addedBy: p.addedBy ?? null, at: fact.date } } };
  }
  if (act === "peer-remove") {
    if (!p.domain) return state;
    const peers = { ...state.peers };
    delete peers[p.domain];
    return { ...state, peers };
  }

  // config-set / config-delete — story-level config (STORY_NAME, storyUrl, timezone, ...).
  if (act === "config-set") {
    if (p.key == null) return state;
    return { ...state, config: { ...state.config, [p.key]: p.value } };
  }
  if (act === "config-delete") {
    if (p.key == null) return state;
    const config = { ...state.config };
    delete config[p.key];
    return { ...state, config };
  }

  return state;
}

// A Name's identity-layer fold (declare/banish/connect/release/set-password). Ported from the
// retired per-name reducer. No clock folded for truth: closure/connection are booleans whose WHEN
// is the fact's chain position. The row keeps ONE inert display witness, `createdAt` (seeded once
// on declare/mint from the birth fact's date, never re-bumped), which nothing sorts or compares for
// truth. No `updatedAt` clock-fold survives; a later mutation's "when" is its fact's chain position.
// Returns the SAME object reference when a fact is a no-op (idempotent close, key-less set-password)
// so the caller can skip the write.
function foldName(s, fact) {
  const act = fact?.act;
  const spec = fact?.params?.spec;
  if (act === "declare" || act === "mint") {
    if (!spec || typeof spec !== "object") return s;
    return {
      ...s,
      parentNameId:  spec.parentNameId ?? null,
      privateKeyEnc: spec.privateKeyEnc ?? null,
      identity:      spec.identity ?? null,
      soulType:      spec.soulType ?? null,
      // The real name (trueName.name) — the optional human handle.
      name:          spec.name ?? null,
      // ONE inert display witness ("declared when"); never sorted/compared for truth.
      createdAt:     s.createdAt ?? fact.date,
    };
  }
  if (act === "banish" || act === "close") {
    if (s.closed) return s;
    // The banish FACT's existence IS the closure (no clock). "When" is its chain position.
    return { ...s, closed: true };
  }
  if (act === "connect") return { ...s, connected: true };
  if (act === "release") return { ...s, connected: false };
  if (act === "set-password") {
    if (!spec || spec.privateKeyEnc == null) return s;
    return { ...s, privateKeyEnc: spec.privateKeyEnc };
  }
  return s;
}
