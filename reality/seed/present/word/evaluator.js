// The Word evaluator, Phase 2 skeleton.
//
// Walks a Word IR program (clause-grained nodes, see philosophy/word/5.md) and
// executes it, emitting facts into ctx.deltaF, the same accumulator the stamper
// uses. An act, run, becomes a fact (4.md: "an act and a fact are one clause at
// two tenses"). One act may lay several facts (form-being below).
//
// Two modes:
//   - dryRun: facts are collected into ctx.deltaF only (no DB, no real birth).
//     Use this to diff the evaluator's facts against the JS handler's facts,
//     the Phase 2 gate.
//   - live: facts go through emitFact into the real moment (summonCtx.deltaF),
//     and form-being dispatches to the real birthBeing primitive.
//
// Faithful to the cherub birth flow mapped from the JS handlers:
//   reality/seed/present/roles/cherub/role.js (_registerHumanWithFreshHome)
//   reality/seed/materials/being/identity/birth.js (birthBeing)

// Live-mode primitives (emitFact, birthBeing) are imported lazily inside the live
// branches, so dry-run never loads the DB stack and can run standalone.

// ── entry ────────────────────────────────────────────────────────────────────

// Run a program (a node or an array of nodes) against a context, return ctx.deltaF.
// ctx = { summonCtx, identity, branch, trigger, env, bindings?, deltaF?, dryRun? }
export async function evaluate(program, ctx) {
  ctx.bindings ??= {};
  ctx.deltaF ??= [];
  const nodes = Array.isArray(program) ? program : [program];
  for (const node of nodes) await evalNode(node, ctx);
  return ctx.deltaF;
}

async function evalNode(node, ctx) {
  switch (node.kind) {
    case "flow":    return evalFlow(node, ctx);
    case "act":     return evalAct(node, ctx);
    case "closure": return evalClosure(node, ctx);
    // declarations (is / can / cannot) are law: registered elsewhere, not run here.
    case "is":
    case "can":
    case "cannot":  return undefined;
    default: throw new Error(`word: unknown node kind "${node.kind}"`);
  }
}

// ── flow (rule 6: a dormant watch; the trigger has already matched to get here) ──

async function evalFlow(flow, ctx) {
  for (const name of flow.binds || []) ctx.bindings[name] = ctx.trigger?.[name];
  for (const effect of flow.effects) await evalNode(effect, ctx);
}

// ── standing watches + the pulse (rules 6, 12: the choq) ──────────────────────
//
// Beyond the linear cherub flow, declarations register their flows as standing
// watches. When an act seals a fact, matching watches fire, the choq: completion
// advances the reel. A self-coupled watch ("when a beat happens, strike again")
// is a pulse; ctx.maxBeats bounds the observation so the demo terminates.

export function register(program, ctx) {
  ctx.flows ??= [];
  const nodes = Array.isArray(program) ? program : [program];
  for (const node of nodes) if (node.kind === "flow") ctx.flows.push(node);
}

// drain the trigger queue, firing watches on each new fact, bounded by maxBeats.
export async function pump(ctx) {
  ctx._queue ??= [];
  while (ctx._queue.length) {
    const fact = ctx._queue.shift();
    if (fact._event === "beat") {
      if ((ctx.beats ?? 0) >= (ctx.maxBeats ?? Infinity)) continue; // bound the pulse
      ctx.beats = (ctx.beats ?? 0) + 1;
    }
    for (const flow of ctx.flows || []) {
      if (matches(flow.when, fact, ctx)) {
        for (const effect of flow.effects) await evalNode(effect, ctx);
      }
    }
  }
}

function matches(when, fact, ctx) {
  if (!when) return false;
  if (when.on) return fact._event === when.on;            // a named event (a beat)
  if (when.act) return fact.verb === when.act.verb && (!when.act.op || fact.action === when.act.op);
  if (when.state) return stateMatches(when.state, ctx?.state || {}); // a world state (rule 6 over state)
  return false;
}

function stateMatches(cond, state) {
  for (const k of Object.keys(cond)) if (state[k] !== cond[k]) return false;
  return true;
}

// ── the driver: a state wheel (the coupled clock, rules 12 + the choq) ────────
//
// Where pump cascades on events, drive turns on STATE. Each turn fires every
// watch matching the current state: a transition's act changes the state and
// advances the wheel, a rider just acts on it. The new state enables the next
// turn, so coupling lives here, the sun setting writes sky=night, which the
// moon's watch was waiting on. No clock; ctx.maxTurns bounds the observation of
// an in-principle-endless wheel.
export async function drive(ctx) {
  ctx.maxTurns ??= 8;
  let turns = 0;
  while (turns < ctx.maxTurns) {
    if (!(await tickWheel(ctx))) break; // no transition advanced the wheel: it halts
    turns++;
  }
  ctx.turns = turns;
}

async function tickWheel(ctx) {
  const before = JSON.stringify(ctx.state ?? {});
  const matching = (ctx.flows || []).filter(
    (f) => f.when?.state && stateMatches(f.when.state, ctx.state ?? {}),
  );
  if (!matching.length) return false;
  for (const flow of matching) for (const effect of flow.effects) await evalNode(effect, ctx);
  return JSON.stringify(ctx.state ?? {}) !== before; // did a transition advance the wheel?
}

// ── act (the deed; sealed, it is a fact) ──────────────────────────────────────

async function evalAct(act, ctx) {
  const by = resolveName(act.by, ctx);                                 // rule 9: actor is a Name
  const through = act.through ? resolveBeing(act.through, ctx) : null; // by/through split: the vessel
  const params = resolveValue(act.params, ctx);

  // the escape hatch (5.md compute-call): genuine host computation only
  if (act.host) {
    const result = await callHost(act.host, params, ctx);
    if (act.bind) ctx.bindings[act.bind] = result;
    return result;
  }

  // be:form-being dispatches to the host birth primitive (one act, many facts:
  // birthBeing lays be:birth + the inherited-role grants + the global grant)
  if (act.verb === "be" && act.op === "form-being") {
    const res = await formBeing(params, ctx);
    if (act.bind) ctx.bindings[act.bind] = res.beingId;
    return res;
  }

  // a DO act in live mode runs its real op handler via doVerb, so the op's own
  // validation and fold run exactly as the JS handler calls them. dry-run below
  // raw-emits the fact shape instead. resolveTarget mints + binds a fresh id at a
  // `bind` site (e.g. the home space) so later acts can reference it.
  if (act.verb === "do" && !ctx.dryRun) {
    const { doVerb } = await import("../../ibp/verbs/do.js");
    const target = resolveTarget(act.of, ctx);
    const res = await doVerb(target, act.op, params, { identity: ctx.identity, summonCtx: ctx.summonCtx });
    // bind the id the op actually created (the home space), so later acts
    // (form-being's homeId, set-space's owner target) reference the real id and
    // not the pre-mint. create-space returns { spaceId } (space/ops.js).
    if (act.bind) ctx.bindings[act.bind] = String(res?.spaceId ?? res?.id ?? res?._id ?? ctx.bindings[act.bind]);
    return res;
  }

  // every other verb emits its own fact (the act, sealed)
  return emit({
    verb: act.verb,
    action: act.op,                 // the operation within the verb (do:create-space, ...)
    beingId: through || by,         // the deed lands under the acting being / Name
    target: resolveTarget(act.of, ctx),
    to: act.to !== undefined ? resolveBeing(act.to, ctx) : undefined, // the receiver (rule 17)
    params,
    _event: act.event,              // a derived event this act counts as ("that is a beat")
    _sets: act.sets,                // this act's effect on world state (folded below)
  }, ctx);
}

// rule 13: a closure names a bounded span
async function evalClosure(node, ctx) {
  return emit({
    verb: "do", action: "close-span",
    beingId: resolveName(node.by, ctx),
    target: { kind: "span" },
    params: { name: node.name },
  }, ctx);
}

// ── primitive dispatch ────────────────────────────────────────────────────────

// emit a fact: dry-run collects it; live sends it through emitFact into the moment.
async function emit(spec, ctx) {
  const fact = { ...spec, actId: ctx.summonCtx?.actId, branch: ctx.branch };
  ctx.deltaF.push(fact);
  if (spec._sets) Object.assign((ctx.state ??= {}), spec._sets); // the fold: a fact updates state
  if (!ctx.dryRun) {
    const { emitFact } = await import("../../past/fact/facts.js");
    await emitFact(fact, ctx.summonCtx);
  }
  (ctx._queue ??= []).push(fact); // a sealed fact may fire standing watches (the choq)
  return fact;
}

// form a being: dry-run models the be:birth fact; live calls the real primitive.
async function formBeing(spec, ctx) {
  if (ctx.dryRun) {
    const beingId = `<being:${spec.name}>`; // birthBeing computes a content hash; placeholder here
    ctx.deltaF.push({
      verb: "be", action: "birth", beingId, target: { kind: "being", id: beingId },
      params: spec, actId: ctx.summonCtx?.actId, branch: ctx.branch,
    });
    return { beingId, name: spec.name };
  }
  const { birthBeing } = await import("../../materials/being/identity/birth.js");
  return birthBeing({ spec, identity: ctx.identity, summonCtx: ctx.summonCtx, branch: ctx.branch });
}

async function callHost(builtin, params, ctx) {
  const fn = ctx.env?.host?.[builtin];
  if (fn) return fn(params);
  if (ctx.dryRun) return `<host:${builtin}>`; // placeholder in dry-run
  throw new Error(`word: no host builtin "${builtin}"`);
}

// ── reference resolution (rules 9 / 10 / 11) ──────────────────────────────────

function resolveName(ref, ctx) {
  if (ref == null) return ctx.identity?.nameId ?? ctx.identity?.beingId ?? null;
  if (ref === "I") return ctx.identity?.nameId ?? ctx.identity?.beingId; // rule 9: I is the Name
  if (ref === "I_AM") return ctx.env?.iam ?? "I_AM";
  return ref; // a being / Name proper name (Cherub, ...)
}

function resolveBeing(ref, ctx) {
  if (ref && ref.ref) return ctx.bindings[ref.ref] ?? ref.ref;
  return ref;
}

function resolveTarget(of, ctx) {
  if (!of) return undefined;
  if (of.bind) { // a fresh id this act creates (e.g. the home space)
    const id = ctx.dryRun ? `<${of.bind}>` : (ctx.env?.mintId?.(of.kind) ?? undefined);
    ctx.bindings[of.bind] = id;
    return { kind: of.kind, id };
  }
  return { kind: of.kind, id: of.ref ? ctx.bindings[of.ref] : of.id };
}

// resolve "$name" placeholders against ctx.bindings, recursively
function resolveValue(v, ctx) {
  if (typeof v === "string" && v.startsWith("$")) return ctx.bindings[v.slice(1)] ?? v;
  // a being's proper name -> its id (the 7.md name/id bridge: the Word names
  // beings by proper noun, the system keys them by id). Scoped to ctx.beings so
  // ordinary strings (roles, names) pass through untouched.
  if (typeof v === "string" && ctx.beings && Object.prototype.hasOwnProperty.call(ctx.beings, v)) return ctx.beings[v];
  if (Array.isArray(v)) return v.map((x) => resolveValue(x, ctx));
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v)) out[k] = resolveValue(v[k], ctx);
    return out;
  }
  return v;
}
