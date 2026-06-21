// TreeOS Portal . core/state.js
//
// THE in-memory model. Every view (3d, text, console, explorer) reads
// from one instance of this and reacts to its change events; no view
// owns its own copy of session / descriptor / address. This is the
// Phase-1 seam from PORTAL.md: the two former singletons (`state` in
// 3d/main.js and `flat.state` in flat/host.js) collapse into this.
//
// Shape (all fields live on one flat model):
//
//   session         { placeUrl, placeIsProxied, token, username,
//                     beingAddress, homeSpaceId, inherited?, spawnerName? }
//   discovery       the /.well-known bootstrap payload merged with the
//                   socket-side `.discovery` SEE (clones, timezone, ...)
//   descriptor      the current Position Description (what every view renders)
//   currentAddress  the address the descriptor answers
//   actorHistory     the session's seated branch (server "history" pushes)
//   selectedBeing   { beingId, name, lastSetAt } | null — cross-view focus
//   history / navIndex   portal-internal navigation history
//   connection      "idle" | "connected" | "disconnected" | "error"
//   activeView      registry name of the mounted view
//   pendingSummons  Map(correlation -> being) — async summon bookkeeping
//   debugLiveEvents verbose live-event logging toggle
//
// Subscribers receive (partial, meta, model): `partial` is exactly what
// changed, `meta` is the publisher's annotation (navigation uses
// { reason: "navigate" | "live" | "rewind" | "now", resetCamera }), and
// `model` is the whole current model for convenience. A listener that
// throws is logged and skipped — one buggy view can't starve the rest.

export function createPortalState(initial = {}) {
  const model = {
    session: null,
    discovery: null,
    descriptor: null,
    currentAddress: null,
    actorHistory: "0",
    // The being's CURRENT POSITION path — where the per-navigate
    // set-being:position fact landed. The left stance renders from
    // this: it always follows where the being is, so left and right
    // match unless the view diverges (ghost view, portals).
    actorPosition: "/",
    // Ghost-walk anchor. Non-null while the portal is rewound:
    // { atTimestamp } (or { atSeq }). Navigation carries it on every
    // SEE so the user can WALK AROUND IN THE PAST — all four views
    // render the fold at that moment until return-to-now clears it.
    historicalAnchor: null,
    selectedBeing: null,
    navStack: [],
    navIndex: -1,
    connection: "idle",
    activeView: null,
    pendingSummons: new Map(),
    debugLiveEvents: false,
    ...initial,
  };

  const listeners = new Set();

  function set(partial, meta = {}) {
    if (!partial || typeof partial !== "object") return;
    Object.assign(model, partial);
    for (const fn of listeners) {
      try { fn(partial, meta, model); }
      catch (err) { console.warn("[portal:state] listener threw:", err?.message || err); }
    }
  }

  return {
    /** The live mutable model. Legacy readers (branch-bar's
     *  window.__state) point here; new code should prefer get(). */
    get raw() { return model; },
    /** get() → whole model; get("descriptor") → one field. */
    get(key) { return key === undefined ? model : model[key]; },
    set,
    /** subscribe(fn) → unsubscribe. fn(partial, meta, model). */
    subscribe(fn) {
      if (typeof fn !== "function") return () => {};
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
