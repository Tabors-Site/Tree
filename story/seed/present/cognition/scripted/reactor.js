// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// reactor.js . the live reactive script being (25.md Pillar D / 26.md).
//
// A scripted cognition that does NOT read the completed face as a static
// snapshot (the way 3-momentum hands moment.innerFace to a scripted role).
// It SUBSCRIBES to the being's rasterization stream and reacts to each
// piece AS IT LANDS: the first trigger whose `when` matches fires `then`,
// producing the one do for the moment -- the being acts the instant its
// condition appears in the forming face, not at a poll boundary.
//
// This is the SCRIPTED reader of the one rasterization stream (the other
// two are the portal and the llm; see rasterStream.js). It is pure over
// the existing fold: it watches the same items buildInnerFace streams and
// lays no fact itself -- it DECIDES a do; the caller dispatches that do as
// a Word (runRoleWord), so a script being's act is a Word like any other.
//
// A trigger: { when(item, state) -> bool, then(item, state) -> do | null }
//   item  . one rasterization item { seq, kind, ... }
//           (kind: position | role | can | see | complete)
//   state . accumulates as the face forms:
//           { position, role, can:{canDo,canSummon,canBe}, seen:[], items:[] }
//   do    . the decided act spec (e.g. { op, target, params }), or null
// ONE do per moment: the FIRST trigger to fire wins; later items are
// ignored once decided. No trigger fires -> no act (a see-moment).

import { onRaster } from "../../stamper/2-fold/rasterStream.js";
import { buildInnerFace } from "../../stamper/2-fold/innerFace.js";

function freshState() {
  return {
    position: null,
    role: null,
    can: { canDo: [], canSummon: [], canBe: [] },
    seen: [],
    items: [],
  };
}

function absorb(state, item) {
  state.items.push(item);
  if (item.kind === "position") state.position = item.value;
  else if (item.kind === "role") state.role = item.value;
  else if (item.kind === "can") state.can[item.verb] = Array.isArray(item.words) ? item.words : [];
  else if (item.kind === "see") state.seen.push(item.block);
}

/**
 * Build a stateful reactor from a trigger list. `consume(item)` folds the
 * item into the accumulating state and, if nothing has fired yet, tests
 * each trigger in order; the first to match decides the do. Returns the
 * decision so far (or null). `complete` never fires a trigger -- it only
 * marks the frame finished. A trigger that throws is treated as no-match
 * (a script being can't crash its own moment).
 */
export function createReactor(triggers) {
  const list = Array.isArray(triggers) ? triggers : [];
  const state = freshState();
  let decided = null;

  function consume(item) {
    absorb(state, item);
    if (decided != null) return decided;          // one do per moment
    if (!item || item.kind === "complete") return decided;
    for (const t of list) {
      let hit = false;
      try { hit = !!t?.when?.(item, state); } catch { hit = false; }
      if (hit) {
        try { decided = t?.then?.(item, state) ?? null; } catch { decided = null; }
        break;
      }
    }
    return decided;
  }

  return {
    consume,
    state,
    get decided() { return decided; },
    get acted() { return decided != null; },
  };
}

/**
 * Run a reactive scripted cognition over a being's forming face. Subscribes
 * to the rasterization, drives buildInnerFace (which streams synchronously),
 * and returns the decided do (or none). The completed face is returned too
 * -- the same object buildInnerFace produced, unchanged.
 *
 * Returns { acted, act, state, face }. The caller turns `act` into a Word
 * and dispatches it (runRoleWord) onto the moment, exactly like the LLM
 * path turns its emitted Word into facts; a no-act moment is a see.
 */
export async function runReactorOverFace(triggers, role, ctx = {}) {
  const reactor = createReactor(triggers);
  const un = onRaster(ctx?.beingId, (item) => reactor.consume(item));
  let face;
  try {
    face = await buildInnerFace(role, ctx);
  } finally {
    un();
  }
  return { acted: reactor.acted, act: reactor.decided, state: reactor.state, face };
}
