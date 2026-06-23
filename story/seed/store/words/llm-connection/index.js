// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// The llm-connection word cluster — each op lays ONE do:set-being fact through the
// dispatcher (skipAudit gone, no self-emit). The `.word` is `see resolve-* + Return
// factParams`; the host floor (llmHost.js → connect.js E6 kernels) computes + bakes the
// set-being params; the dispatcher stamps. A connection is ONE fact however rich (the
// spacebar). Carved from materials/being/ops.js (which still owns set-being, the able ops,
// …). Per Tabor's NO-JS-FALLBACK rule the `.word` IS the op — on a clean miss it refuses.
//
// Landing incrementally (one op per cut): update-llm-connection first. add (two-moment:
// add + assign-to-main) goes to the engine lane via runWordToStore (new.md). delete (drop
// the slot-clears run-on, the dangling ref folds) + assign follow.

import { registerOperation } from "../../../ibp/operations.js";
import { stampsFact, ranAsMoments } from "../../../ibp/factResult.js";
import { IbpError, IBP_ERR } from "../../../ibp/protocol.js";
import { registerAbleWord } from "../../../present/word/ableWordRegistry.js";
import { detectTargetKind, targetIdOf } from "../../../materials/_targetShape.js";

registerAbleWord("being", "update-llm-connection", new URL("./update-llm-connection.word", import.meta.url));
registerAbleWord("being", "delete-llm-connection", new URL("./delete-llm-connection.word", import.meta.url));
registerAbleWord("being", "add-llm-connection", new URL("./add-llm-connection.word", import.meta.url));
registerAbleWord("being", "assign-llm-slot", new URL("./assign-llm-slot.word", import.meta.url));
registerAbleWord("space", "assign-llm-slot", new URL("./assign-llm-slot.word", import.meta.url));

// Run a cluster op's `.word` through the bridge (CALLER mode). Returns the stampsFact
// result (the do:set-being targets the BEING — the op's target — so the default audit
// target is correct, no override needed), or null on a clean miss.
async function _viaWord(op, { target, params, caller, moment }) {
  if (!moment) return null;
  const { resolveAbleWord, runAbleWord } = await import("../../../present/word/ableWordRegistry.js");
  const ir = resolveAbleWord("being", op, moment?.actorAct?.history);
  if (!ir) return null;
  const { llmHostEnv } = await import("./llmHost.js");
  const history = moment?.actorAct?.history;
  try {
    const { result } = await runAbleWord(ir, {
      moment, history,
      trigger: {
        target,
        targetKind: detectTargetKind(target),
        params: params || {},
        caller: caller ? String(caller) : null,
        branch: history,
      },
      env: { host: llmHostEnv() },
    });
    if (!result) return null;
    return stampsFact(result, result.factParams);
  } catch (e) {
    if (e && e.__wordRefusal) throw new IbpError(e.code || IBP_ERR.INVALID_INPUT, e.message);
    throw e;
  }
}

async function updateLlmConnectionHandler(ctx) {
  const { target, params, identity, moment } = ctx;
  // NO JS fallback (Tabor): the .word IS the op. On a clean miss, refuse.
  const viaWord = await _viaWord("update-llm-connection", { target, params, caller: identity?.beingId, moment });
  if (!viaWord) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "update-llm-connection: the word is not available on this history");
  }
  // Post-fact side-effect: bust the LLM client cache if the connection is assigned (the
  // .word's see flagged wasAssigned). A cache invalidation, not a fact — a fold-hook is the
  // proper home; here it preserves the legacy immediacy.
  if (viaWord.wasAssigned) {
    const { clearBeingClientCache } = await import("../../../present/cognition/llm/connect.js");
    clearBeingClientCache(String(targetIdOf(target)));
  }
  return viaWord;
}

registerOperation("update-llm-connection", {
  targets: ["being"],
  ownerExtension: "seed",
  factAction: "set-being",
  handler: updateLlmConnectionHandler,
});

async function deleteLlmConnectionHandler(ctx) {
  const { target, params, identity, moment } = ctx;
  // NO JS fallback (Tabor): the .word IS the op. On a clean miss, refuse.
  const viaWord = await _viaWord("delete-llm-connection", { target, params, caller: identity?.beingId, moment });
  if (!viaWord) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "delete-llm-connection: the word is not available on this history");
  }
  // Post-fact side-effect: bust the LLM client cache (the connection is gone). A cache
  // invalidation, not a fact — a fold-hook is the proper home; here it keeps legacy immediacy.
  const { clearBeingClientCache } = await import("../../../present/cognition/llm/connect.js");
  clearBeingClientCache(String(targetIdOf(target)));
  return viaWord;
}

registerOperation("delete-llm-connection", {
  targets: ["being"],
  ownerExtension: "seed",
  factAction: "set-being",
  handler: deleteLlmConnectionHandler,
});

// add-llm-connection — the MULTI-MOMENT composite (the genuine runWordToStore proof). add.word
// has real DEEDS: `do set-being` (the connection, one fact) then `If $conn.isFirst, do
// assign-llm-slot` (auto-assign-to-main as its OWN word). Unlike update/delete (atomic, runAbleWord
// + one stampsFact), add runs through `runWordToStore` so each deed is its OWN moment / fact /
// commit — two words, two moments. The host floor `resolve-connection` (llmHost.js → connect.js E6:
// validate / SSRF-gate / encrypt the key / mint the id / read isFirst) lays nothing; the deeds lay
// the facts. The op lays NO own fact (`ranAsMoments` → the dispatcher skips its auto-Fact). The
// being acts as itself (signed BY its Name THROUGH it via withBeingAct). NO skipAudit, NO JS body.
async function _addViaWord({ target, params, caller, moment }) {
  if (!moment) return null;
  if (!caller) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "add-llm-connection requires an identified actor");
  }
  const { resolveAbleWord, runWordToStore } = await import("../../../present/word/ableWordRegistry.js");
  const history = moment?.actorAct?.history;
  const ir = resolveAbleWord("being", "add-llm-connection", history);
  if (!ir) return null;
  const { llmHostEnv } = await import("./llmHost.js");
  try {
    const { result } = await runWordToStore(ir, {
      beingId: String(caller),       // the actor; the deeds target $conn.beingId via the of-ref
      name: null,
      history,
      env: { host: llmHostEnv() },
      trigger: {
        target,
        targetKind: detectTargetKind(target),
        params: params || {},
        caller: String(caller),
        branch: history,
      },
    });
    // The deeds stamped the facts as their own moments — the op lays none of its own. Result shape
    // stays backward-compatible: `connection._id` (what existing callers + verifiers read) AND the
    // flat `connectionId`. The full connection rows live on the being's fold (read there if needed).
    const cid = result?.connectionId ?? null;
    return ranAsMoments({ added: true, connectionId: cid, connection: { _id: cid } });
  } catch (e) {
    if (e && e.__wordRefusal) throw new IbpError(e.code || IBP_ERR.INVALID_INPUT, e.message);
    throw e;
  }
}

async function addLlmConnectionHandler(ctx) {
  const { target, params, identity, moment } = ctx;
  // NO JS fallback (Tabor): add.word IS the op (its two deeds via runWordToStore). On a clean miss, refuse.
  const viaWord = await _addViaWord({ target, params, caller: identity?.beingId, moment });
  if (!viaWord) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "add-llm-connection: the word is not available on this history");
  }
  // Post-fact side-effect: bust the LLM client cache (a new connection may be assigned to main).
  const { clearBeingClientCache } = await import("../../../present/cognition/llm/connect.js");
  clearBeingClientCache(String(targetIdOf(target)));
  return viaWord;
}

registerOperation("add-llm-connection", {
  targets: ["being"],
  ownerExtension: "seed",
  // No factAction / skipAudit: the deeds (do set-being, do assign-llm-slot) lay the facts as their
  // own moments via runWordToStore; ranAsMoments tells the dispatcher this op stamps none of its own.
  handler: addLlmConnectionHandler,
});

// assign-llm-slot — POLYMORPHIC (being / space). The branch picks the op (set-being / set-space),
// so assign-llm-slot.word issues ONE CONDITIONAL DEED (only one branch fires). It runs through
// runWordToStore + ranAsMoments: the chosen deed is its OWN moment / fact, the op stamps none of
// its own. (NOTE: tried runAbleWord per the engine's "atomic per branch" guidance, but when add.word's
// `do assign-llm-slot` deed calls this op, a nested runAbleWord-inside-runWordToStore made add's FIRST
// deed — the connection set-being — stop folding. runWordToStore keeps the moment model consistent
// across the nesting: each deed its own moment. Verified: assign 5/5 + add 6/6. Flagged for the engine.)
// NO factAction / skipAudit / JS body.
async function _assignViaWord({ target, params, caller, moment }) {
  if (!moment) return null;
  if (!caller) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "assign-llm-slot requires an identified actor");
  }
  const { resolveAbleWord, runWordToStore } = await import("../../../present/word/ableWordRegistry.js");
  const history = moment?.actorAct?.history;
  const wordKind = detectTargetKind(target) === "being" ? "being" : "space";
  const ir = resolveAbleWord(wordKind, "assign-llm-slot", history);
  if (!ir) return null;
  const { llmHostEnv } = await import("./llmHost.js");
  try {
    const { result } = await runWordToStore(ir, {
      beingId: String(caller),
      name: null,
      history,
      env: { host: llmHostEnv() },
      trigger: {
        target,
        targetKind: detectTargetKind(target),
        params: params || {},
        caller: String(caller),
        branch: history,
      },
    });
    return ranAsMoments({ slot: result?.slot ?? null, connectionId: result?.connectionId ?? null });
  } catch (e) {
    if (e && e.__wordRefusal) throw new IbpError(e.code || IBP_ERR.INVALID_INPUT, e.message);
    throw e;
  }
}

async function assignLlmSlotHandler(ctx) {
  const { target, params, identity, moment } = ctx;
  // NO JS fallback (Tabor): the .word IS the op. On a clean miss, refuse.
  const viaWord = await _assignViaWord({ target, params, caller: identity?.beingId, moment });
  if (!viaWord) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "assign-llm-slot: the word is not available on this history");
  }
  // Post-fact side-effect: bust the LLM client cache for the being case (the slot changed).
  if (detectTargetKind(target) === "being") {
    const { clearBeingClientCache } = await import("../../../present/cognition/llm/connect.js");
    clearBeingClientCache(String(targetIdOf(target)));
  }
  return viaWord;
}

registerOperation("assign-llm-slot", {
  targets: ["being", "space"],
  ownerExtension: "seed",
  handler: assignLlmSlotHandler,
});
