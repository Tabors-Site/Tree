// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// factResult.js — an op's act yields two things: a FACT (the world-change the dispatcher
// stamps) and a RESULT (the answer returned to the asker). These helpers let an op DECLARE
// its fact on the result it returns, instead of hand-wiring the dispatcher's `_factParams` /
// `_factTarget` / `_noFact` plumbing inline (which was copy-pasted across five ops).
//
// The dispatcher (do.js / be.js auto-Fact) reads the declaration and lays the ONE
// caller-attributed fact, on the moment's actId; stripForAudit drops the `_`-prefixed keys,
// so neither the recorded fact nor the returned result carries the declaration (or any
// reveal). One place for "the dispatcher owns the stamp; the act authors the fact."
//
// Reads as doctrine at the call site:  return laysFact(answer, params, target);
//                                      return laysNoFact(answer);          // idempotent path
//                                      return laysWordFact(result, "being"); // a .word's fact

// The act lays a fact. `params` are stamped as the fact's params; `target` ({kind,id}) is the
// reel it lands on (a freshly content-addressed matter, the asker's being, …). Omit `target`
// to let the dispatcher resolve it from the call-target (resolveAuditTarget).
export function laysFact(result, params, target = null) {
  const out = { ...(result && typeof result === "object" ? result : {}) };
  out._factParams = params;
  if (target && target.id != null) {
    out._factTarget = { kind: target.kind ?? null, id: String(target.id) };
  }
  return out;
}

// The act changed nothing on this path — the dispatcher lays no fact. (Conditional
// world-effects: a re-take of an already-held role, a queued ask awaiting approval.)
export function laysNoFact(result) {
  return { ...(result && typeof result === "object" ? result : {}), _noFact: true };
}

// Land a `.word`-authored fact (Option B — the word builds its own fact params). The word
// returned `factParams` (the fact's params) and optionally `factTarget` (the target id);
// promote them to the dispatcher's declaration. No `factParams` on this path → no fact.
// `idFrom` names a result field to read the target id from when the word returned no
// `factTarget` (e.g. "matterId", "granteeBeingId", "rootId").
export function laysWordFact(result, kind, idFrom = null) {
  if (!result || typeof result !== "object") return result;
  const { factParams, factTarget, ...rest } = result;
  if (factParams == null) return laysNoFact(rest);
  const id = factTarget != null ? factTarget : idFrom ? rest[idFrom] : null;
  return laysFact(rest, factParams, id != null ? { kind, id } : null);
}
