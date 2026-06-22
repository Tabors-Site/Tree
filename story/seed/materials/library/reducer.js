// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Library reducer. (state, fact) -> state.
//
// The story's ONE 5D library reel (of.kind "library", one per story, out of any history): the
// name-level / cross-history facts — shared books, federation peers, story config — folded into a
// single catalog. The library is the 5th reel kind (5d.md: Ours, the catalog of worlds; only names
// act there). Pure + deterministic, symmetric with being/space/matter/name reducers.

/** Empty initial state. */
export function initial() {
  return { books: {}, peers: {}, config: {} };
}

export function reduce(state, fact) {
  const act = fact?.act;
  const p = fact?.params || {};

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
