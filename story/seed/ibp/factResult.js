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

// emitWordFact — the ONE dispatcher-side emit for a FIXED-NOUN fact-word (17.md STEP 2). Lays the
// single caller-attributed fact for an identity-fact word (beop / nameop), reading the VERB from the
// word's binding (factVerb — explicit per-word, the hash-continuity anchor) and the target NOUN from
// binding.noun, instead of a per-file hardcode. The four be:* emit sites + name's writeNameFact
// collapse onto this. do-ops keep their OWN emit: their audit target is dynamic (resolveAuditTarget)
// and their result is summarizeAuditResult, not a fixed noun + stripForAudit — forcing them through
// here would be a weird word, not a cleanup (17.md: clean dirty wiring, do not wrap legitimate logic).
//   binding: { factVerb, factAction, noun }
//   ctx:     { through, actId, history }   (history may be the DESTINATION history, e.g. be:switch)
//   result:  the op result, carrying _factParams + _factTarget (promoted by stampsWordFact)
export async function emitWordFact(binding, ctx, result, moment) {
  const { emitFact } = await import("../past/fact/facts.js");
  const { stripForAudit } = await import("../materials/redact.js");
  const targetId =
    result && typeof result === "object" && result._factTarget?.id != null
      ? String(result._factTarget.id)
      : null;
  await emitFact(
    {
      verb: binding.factVerb,
      act: binding.factAction,
      through: ctx.through,
      of: { kind: binding.noun, id: targetId },
      params:
        result && typeof result === "object" && result._factParams
          ? result._factParams
          : null,
      result: stripForAudit(result),
      actId: ctx.actId,
      history: ctx.history,
    },
    moment,
  );
}
