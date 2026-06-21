// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// factResult.js — an op's act yields two things: a FACT (the world-change the dispatcher
// stamps) and a RESULT (the answer returned to the asker). These helpers let an op DECLARE
// its fact on the result it returns, instead of hand-wiring the dispatcher's `_factParams` /
// `_factTarget` plumbing inline (which was copy-pasted across five ops).
//
// EVERY ACT MAKES A FACT: the dispatcher stamps unconditionally. An op that "changed nothing"
// (an idempotent re-take, a queued ask) still RECORDS the act — it returns its outcome as the
// fact params WITHOUT a grant record, so the fact lands in the being's history but the reducer
// folds no world-change. There is no "lay no fact"; there is only "lay a fact that records the
// act and folds nothing."
//
// The dispatcher (do.js / be.js auto-Fact) reads the declaration and lays the ONE
// caller-attributed fact, on the moment's actId; stripForAudit drops the `_`-prefixed keys,
// so neither the recorded fact nor the returned result carries the declaration (or any reveal).
//
// Reads as doctrine at the call site:  return stampsFact(answer, params, target);
//                                      return stampsWordFact(result, "being", "matterId");

// The act lays a fact. `params` are stamped as the fact's params; `target` ({kind,id}) is the
// reel it lands on (a freshly content-addressed matter, the asker's being, …). Omit `target`
// to let the dispatcher resolve it from the call-target (resolveAuditTarget).
export function stampsFact(result, params, target = null) {
  const out = { ...(result && typeof result === "object" ? result : {}) };
  out._factParams = params;
  if (target && target.id != null) {
    out._factTarget = { kind: target.kind ?? null, id: String(target.id) };
  }
  return out;
}

// The act lays its fact on a reel OTHER than the call-target — declare just the target. The
// fact's params stay the default (ctx.params); only the reel is overridden (a new space, the
// asker's being, the grantee). For ops that don't author params, only redirect the audit.
export function targetsFact(result, target) {
  if (!result || typeof result !== "object" || !target || target.id == null) return result;
  return { ...result, _factTarget: { kind: target.kind ?? null, id: String(target.id) } };
}

// Land a `.word`-authored fact (Option B — the word builds its own fact params). The word
// returned `factParams` (the fact's params) and optionally `factTarget` (the target id);
// promote them to the dispatcher's declaration. `idFrom` names a result field to read the
// target id from when the word returned no `factTarget` (e.g. "matterId", "granteeBeingId").
export function stampsWordFact(result, kind, idFrom = null) {
  if (!result || typeof result !== "object") return result;
  const { factParams, factTarget, ...rest } = result;
  // The word should always author its fact params (every act makes a fact); if it didn't,
  // fall through with the input so the dispatcher still stamps the act from ctx.params.
  if (factParams == null) return rest;
  const id = factTarget != null ? factTarget : idFrom ? rest[idFrom] : null;
  return stampsFact(rest, factParams, id != null ? { kind, id } : null);
}
