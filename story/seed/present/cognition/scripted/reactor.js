// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// reactor.js . the live reactive script being (25.md Pillar D / 26.md).
//
// A scripted cognition over the rasterization stream. It WATCHES the being's
// face form (consuming each item the rasterizer emits), but it ACTS only on
// the FINISHED face: when the rasterization completes, its triggers are
// evaluated once, over the whole accumulated state, and the first match
// decides the one do. The being never acts on a partial face -- the inner
// face is the full ratification of the past, and you act on the complete
// picture, not a fragment. (The stream is for watching it build; portal, llm,
// and scripted all read the same one, and all act on completion.)
//
// It is pure over the existing fold: it lays no fact itself -- it DECIDES a
// do; the caller dispatches that do as a Word (runAbleWord), so a script
// being's act is a Word like any other.
//
// A trigger: { when(state) -> bool, then(state) -> do | null }
//   state . the COMPLETE face, accumulated:
//           { position, able, can:{canDo,canCall,canBe}, seen:[], items:[] }
//   do    . the decided do, a WORD string (e.g. "do move north."), or null
// Evaluated once, on completion. ONE do per moment: the FIRST trigger whose
// `when(state)` holds wins. None match -> no act (a see-moment).

import { onRaster, faceItems } from "../../stamper/2-fold/rasterStream.js";
import { buildInnerFace } from "../../stamper/2-fold/innerFace.js";
import {
  cognitionSuccess,
  cognitionSee,
  cognitionFailure,
} from "../cognitionResult.js";

function freshState() {
  return {
    position: null,
    able: null,
    can: { canDo: [], canCall: [], canBe: [] },
    seen: [],
    items: [],
  };
}

function absorb(state, item) {
  state.items.push(item);
  if (item.kind === "position") state.position = item.value;
  else if (item.kind === "able") state.able = item.value;
  else if (item.kind === "can")
    state.can[item.verb] = Array.isArray(item.words) ? item.words : [];
  else if (item.kind === "see") state.seen.push(item.block);
}

/**
 * Build a stateful reactor from a trigger list. `consume(item)` folds each
 * rasterization item into the accumulating state; when the `complete` item
 * lands (the finished face), it tests each trigger in order over the WHOLE
 * state and the first match decides the do. The being acts only on the
 * complete face, never mid-form. A trigger that throws is treated as
 * no-match (a script being can't crash its own moment).
 */
export function createReactor(triggers) {
  const list = Array.isArray(triggers) ? triggers : [];
  const state = freshState();
  let decided = null;
  let sealed = false;

  function consume(item) {
    absorb(state, item);
    // Act only on the FINISHED rasterization: evaluate the triggers once,
    // when the face completes, over the whole accumulated state. Never
    // mid-form -- the being acts on the full ratification, not a fragment.
    if (item?.kind === "complete" && !sealed) {
      sealed = true;
      for (const t of list) {
        let hit = false;
        try {
          hit = !!t?.when?.(state);
        } catch {
          hit = false;
        }
        if (hit) {
          try {
            decided = t?.then?.(state) ?? null;
          } catch {
            decided = null;
          }
          break;
        }
      }
    }
    return decided;
  }

  return {
    consume,
    state,
    get decided() {
      return decided;
    },
    get acted() {
      return decided != null;
    },
    get sealed() {
      return sealed;
    },
  };
}

/**
 * Run a reactive scripted cognition over a being's forming face. Subscribes
 * to the rasterization, drives buildInnerFace (which streams synchronously),
 * and returns the decided do (or none). The completed face is returned too
 * -- the same object buildInnerFace produced, unchanged.
 *
 * Returns { acted, act, state, face }. The caller turns `act` into a Word
 * and dispatches it (runAbleWord) onto the moment, exactly like the LLM
 * path turns its emitted Word into facts; a no-act moment is a see.
 */
export async function runReactorOverFace(triggers, able, ctx = {}) {
  const reactor = createReactor(triggers);
  const un = onRaster(ctx?.beingId, (item) => reactor.consume(item));
  let face;
  try {
    face = await buildInnerFace(able, ctx);
  } finally {
    un();
  }
  return {
    acted: reactor.acted,
    act: reactor.decided,
    state: reactor.state,
    face,
  };
}

/**
 * The reactive scripted cognition as a MOMENT runner -- the scripted parallel
 * to runLlmMoment. The fold beat builds moment.innerFace for every soul; the
 * reactor reads it (faceItems), and the first trigger to match yields a WORD
 * (the do the script being speaks). That Word runs through the SAME path the
 * LLM's emitted Word does -- parse -> runAbleWord onto moment.deltaF, signed
 * BY the being's Name THROUGH the being -- so a script being's act is a Word
 * like any other. No trigger -> a see-moment. Returns a CognitionResult.
 *
 * A trigger's `then` returns the do as a WORD STRING (e.g. "do move north.").
 *
 * The being acts only on the COMPLETE face (the triggers fire on the
 * `complete` item), never mid-form. Noted follow-ups: (1) a shared
 * runWordOnMoment wrapper with runWordNativeOutput -- both souls converge on
 * parse->runAbleWord; (2) the able/can model: a "can" is a do + its
 * inner-face; resolveBareCaps + canSee collapse into one can-set with the
 * able->able rename sweep.
 */
export async function runReactorMoment(
  triggers,
  { able, moment, beingId, username, history } = {},
) {
  // 1. React over the COMPLETE face. Prefer the fold beat's already-built
  //    moment.innerFace (no rebuild); fall back to building one.
  let res;
  if (moment?.innerFace) {
    const reactor = createReactor(triggers);
    for (const item of faceItems(moment.innerFace)) reactor.consume(item);
    res = { acted: reactor.acted, act: reactor.decided };
  } else {
    res = await runReactorOverFace(triggers, able, {
      ...(moment || {}),
      beingId,
      history,
    });
  }

  // 2. No trigger fired -> the being looked and chose not to act.
  const word = res.act;
  if (!res.acted || word == null || word === "") return cognitionSee();

  // 3. The being ACTED (a trigger decided a Word). Defer the deeds exactly like the llm path
  //    (moments.md): this moment seals the ANSWER (the decided Word as the inner word), and
  //    moment.js stamps the DEEDS via runWordToStore — each act its own moment to store (the
  //    spacebar). A Word with no deed → a SEE. A refusal surfaces when the deeds run (post-seal).
  let ir;
  try {
    const { parse } = await import("../../word/parser.js");
    ir = parse(String(word));
  } catch (err) {
    return cognitionSee();
  }
  if (!ir || (Array.isArray(ir) && ir.length === 0)) return cognitionSee();
  const { wordHasDeeds, runWordToStore } = await import("../../word/ableWordRegistry.js");
  if (!wordHasDeeds(ir)) return cognitionSee();
  const { getCurrentSpace } = await import("../../../materials/being/position.js");
  // The script being SPOKE a Word: its deeds (incl. any `call <asker> <inner word>`) each stamp
  // their OWN moment to store via runWordToStore — one word = one commit = one fact. This moment
  // is the DECISION (returns see; moment.js closes the inbox); the deeds are the acts, the response
  // rides a call-deed. Exactly the llm path's shape.
  try {
    await runWordToStore(ir, {
      beingId: String(beingId),
      name: username || null,
      history,
      position: getCurrentSpace(String(beingId)) || null,
    });
  } catch (err) {
    if (err?.__wordRefusal) return cognitionFailure(err.code || "refused", err.message);
    return cognitionFailure("internal", `reactor word run failed: ${err.message}`);
  }
  return cognitionSee();
}
