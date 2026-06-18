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
//   - live: facts go through emitFact into the real moment (moment.deltaF),
//     and form-being dispatches to the real birthBeing primitive.
//
// Faithful to the cherub birth flow mapped from the JS handlers:
//   reality/seed/present/roles/cherub/role.js (_registerHumanWithFreshHome)
//   reality/seed/materials/being/identity/birth.js (birthBeing)

// Live-mode primitives (emitFact, birthBeing) are imported lazily inside the live
// branches, so dry-run never loads the DB stack and can run standalone.

// getPath is the shared dotted-path resolver (cond.js is pure — no DB — so a static
// import is safe). resolveValue uses it so a `$a.b` write ref descends the same way the
// `see`/`return`/cond sides already do (the write/read symmetry the credential-reset cut
// exposed: a flat lookup left `$credential.hash` an unresolved literal in the row).
import { getPath } from "./cond.js";

// ── entry ────────────────────────────────────────────────────────────────────

// Control-flow unwinds (8.md Engine answers, the CONTROL strand — none lay a fact):
//   BREAK   — halts the nearest foreach (§3), caught by evalForeach.
//   WordReturn — a SUCCESS terminator (§7): ends the flow with a `result` the host
//     transport reads (tokens / seatBranch / reveal). Benign: evaluate() catches it.
//   WordRefusal — a host HALT (§7): an IbpError-shaped abort that propagates OUT of
//     evaluate() so the verb layer maps it to the ack error envelope and the moment
//     rolls back. NO fact laid.
const BREAK = { __wordBreak: true };
class WordRefusal extends Error {
  constructor(message, code = "FORBIDDEN") { super(message || "refused"); this.name = "WordRefusal"; this.__wordRefusal = true; this.code = code; }
}

// Run a program (a node or an array of nodes) against a context, return ctx.deltaF.
// ctx = { moment, identity, branch, trigger, env, bindings?, deltaF?, dryRun? }
// A §7 `return` sets ctx.result and unwinds here (benign); a §7 `refuse` propagates.
export async function evaluate(program, ctx) {
  ctx.bindings ??= {};
  ctx.deltaF ??= [];
  const nodes = Array.isArray(program) ? program : [program];
  try {
    for (const node of nodes) await evalNode(node, ctx);
  } catch (e) {
    if (e && e.__wordReturn) { ctx.result = e.result; return ctx.deltaF; } // success terminator
    throw e; // WordRefusal + real errors propagate to the verb layer
  }
  return ctx.deltaF;
}

async function evalNode(node, ctx) {
  switch (node.kind) {
    case "flow":    return evalFlow(node, ctx);
    case "act":     return evalAct(node, ctx);
    case "see":     return evalSee(node, ctx);      // the READ verb: query the substrate, no fact
    case "call":    return evalCall(node, ctx);     // the CALL verb: reach another being (space), lays the reach record
    case "recall":  return evalRecall(node, ctx);   // the RECALL verb: reach back across TIME into a chain (no fact); a verdict records the conclusion
    case "closure": return evalClosure(node, ctx);
    case "if":      return evalIf(node, ctx);       // §2: branch in the moment
    case "mark":    return evalMark(node, ctx);     // §5: a flow-local flag a sibling cond reads
    case "foreach": return evalForeach(node, ctx);  // §3: iterate a source
    case "break":   throw BREAK;                    // §3: halt the nearest foreach
    case "refuse":  return evalRefuse(node, ctx);   // §7: host halt, no fact
    case "return":  return evalReturn(node, ctx);   // §7: success terminator, no fact
    case "gate":    return evalGate(node, ctx);     // §8: pre-seal precondition, fail-closed
    case "match":   return evalMatch(node, ctx);    // §9: type dispatch (flat surface)
    case "derive":  return evalDerive(node, ctx);   // §7: emit a fact, OR register a read-rule
    // ── the LAW strand (§11 + is/can/cannot): the OBJECTIVE register's first move.
    // Registered, NEVER run as effects — read backward off the reel (computed-on-read,
    // Q6/Q7). The parser's reasoning guard is the subject/object wall; everything here
    // is the law side of it (government-innerfold.md). Collected into ctx.laws until the
    // role/type-registry integration arms them in authorizeViaRoles / registerMatterType.
    case "is": case "can": case "cannot":
    case "law": case "capability": case "extends": case "property":
    case "prohibition": case "derive-rule": case "lifetime":
    case "inheritance-rule": case "relate": case "declare":
      (ctx.laws ??= []).push(node); return undefined;
    default: throw new Error(`word: unknown node kind "${node.kind}"`);
  }
}

// ── flow (rule 6: a dormant watch; the trigger has already matched to get here) ──

async function evalFlow(flow, ctx) {
  for (const name of flow.binds || []) ctx.bindings[name] = ctx.trigger?.[name];
  // the body is `body` (8.md §0) or the legacy `effects` (the current slices); accept
  // either until the parser settles on `body`.
  for (const node of flow.body || flow.effects || []) await evalNode(node, ctx);
}

// ── if (§2): resolve the condition, run the taken branch IN the moment ──────────
//
// The condition resolves through the shared `resolveCond` (cond.js, the §1 surface:
// test skeletons, host predicates, flow-local flags, all/any, negation). then/else are
// node arrays (a comma-conjoined list inline, or an indented body); the untaken branch
// is skipped, so its effects never reach the chain. The cherub-connect accumulate-then-
// branch shape: marks set flow-local flags in a loop, then an `if (no being was found)`
// reads the OR of them.
async function evalIf(node, ctx) {
  const { resolveCond } = await import("./cond.js");
  const taken = (await resolveCond(node.cond, ctx)) ? node.then : node.else;
  for (const n of taken || []) await evalNode(n, ctx);
}

// ── mark (§5): a self-directed flow-local boolean a SIBLING condition later reads ──
//
// The parser canonicalized the flag name via inferFlag (its lane), so both the mark and
// the bare-leaf cond that reads it name the same flag. OR-accumulate: a flag set in any
// branch or any loop pass stays true (disjunctive — "asFather true if any path
// succeeded"), so a mark never resets a flag within a flow. Flow-local: it lives in
// ctx.bindings, never a fact (the CONTROL strand, not WORLD).
async function evalMark(node, ctx) {
  const v = node.value !== undefined ? !!node.value : true;
  ctx.bindings[node.flag] = !!(ctx.bindings[node.flag] || v);
}

// ── see (the READ verb): query the substrate, NO fact ─────────────────────────────
//
// The Word's reads ARE verbs, not host escapes — the see-registry dissolves into Word
// (1.md). Three forms, live-resolved against the projection read-model + the canonical
// reads; SEE never stamps a fact (chainRoots.js: "the verb that never stamps facts").
//   QUERY:     { see, of:"<kind>", where:{<field>:<val>}, bind, one?:bool }   → row(s)
//   READ:      { see, of:<ref>, read:"<dotted-quality>", fresh?:bool, bind }  → a value
//   PREDICATE: { see, of:<ref>, descendsFrom:<ref>, bind }                    → bool (being-tree)
async function evalSee(node, ctx) {
  const { getPath } = await import("./cond.js");
  if (ctx.dryRun) {
    const tag = node.read || (typeof node.of === "string" ? node.of : (node.descendsFrom !== undefined ? "descends" : "see"));
    if (node.bind) ctx.bindings[node.bind] = `<see:${tag}>`;
    return ctx.bindings[node.bind];
  }
  const entity = (v) => (v && typeof v === "object" && v.ref != null) ? getPath(v.ref, ctx) : resolveValue(v, ctx);
  let result = null;

  // A registered SEE-op: a read or pure-compute exposed as a verb (the host:->see
  // dissolution — `see mint-credential as credential`, `see find-by-name(name) as cand`).
  // Dispatch its backing fn (ctx.env.host, the role's see-op handlers) — PERCEPTION, lays
  // NO fact, exactly like every other see. The verb IS the nature; no tag. (A compute is
  // see-shaped: it perceives an output from its inputs, changing nothing in the world.)
  if (node.act) {
    const args = (node.args || []).map((a) => resolveValue(a, ctx));
    result = await callHost(node.act, { args }, ctx);
    if (node.bind) ctx.bindings[node.bind] = result;
    return result;
  }

  if (typeof node.of === "string") {
    result = await seeQuery(node.of, resolveValue(node.where, ctx) || {});
    if (node.one) result = Array.isArray(result) ? (result[0] ?? null) : result;
  } else if (node.descendsFrom !== undefined) {
    const subject = entity(node.of), ancestor = entity(node.descendsFrom);
    const { isAncestorOf } = await import("../../materials/being/identity/lookups.js");
    result = await isAncestorOf(
      String(ancestor?.beingId ?? ancestor?._id ?? ancestor),
      String(subject?._id ?? subject?.beingId ?? subject),
    );
  } else if (node.hasAuthorityOver !== undefined) {
    // AUTHORITY PREDICATE: does <of> have authority over <hasAuthorityOver>? The being-
    // tree authority WALK is a read, so it's a `see` verb (the credential-reset gate, the
    // grant gates). `credential:true` = credential authority (being -> being, the re-mint
    // gate); else general authority (name -> being). Resolved via the canonical walks the
    // JS gates call, exactly as `descends from` resolves via isAncestorOf.
    const subject = entity(node.of), object = entity(node.hasAuthorityOver);
    // Resolve the #main pointer, never floor to literal "0": an authority WALK on the wrong
    // tree is an auth bug (never-default-branch-zero). hasCredentialAuthority self-resolves a
    // falsy branch, but hasAuthorityOver hands branch straight to walkUp, so resolve here.
    let branch = node.branch ?? ctx.branch;
    if (!branch) {
      const { getDefaultBranch } = await import("../../materials/branch/branchRegistry.js");
      branch = await getDefaultBranch();
    }
    const objId = String(object?.beingId ?? object?._id ?? object);
    if (node.credential) {
      const { hasCredentialAuthority } = await import("../../materials/being/identity/lineage.js");
      result = await hasCredentialAuthority(String(subject?.beingId ?? subject?._id ?? subject), objId, branch);
    } else {
      const { hasAuthorityOver } = await import("../../materials/being/identity/inheritation.js");
      result = await hasAuthorityOver(String(subject?.nameId ?? subject?.trueName ?? subject), objId, branch);
    }
  } else if (node.read != null) {
    result = await seeRead(entity(node.of), node.read, node.fresh, node.branch ?? ctx.branch);
  }

  if (node.bind) ctx.bindings[node.bind] = result;
  return result;
}

// query a kind's projection rows by a flat field predicate. being-by-name routes to the
// canonical cross-branch sweep so the candidate shape (_id, homeBranch, ...state) matches
// what the flows read; other queries hit the read-model (the fold) directly.
async function seeQuery(kind, where) {
  if (kind === "being" && where && where.name && Object.keys(where).length === 1) {
    const { findBeingCandidatesByName } = await import("../../materials/being/identity/lookups.js");
    return findBeingCandidatesByName(String(where.name));
  }
  const { default: Projection } = await import("../../materials/branch/projection.js");
  const q = { type: kind, tombstoned: { $ne: true } };
  for (const k of Object.keys(where || {})) q[`state.${k}`] = where[k];
  const rows = await Projection.find(q).lean();
  // tag each row with its `kind` so a later `see <row>'s <quality>` READ knows which
  // projection to re-read (space/matter, not just being).
  return rows.map((r) => ({ _id: r.id, kind, homeBranch: r.state?.homeBranch, ...(r.state || {}) }));
}

// read a bound entity's dotted quality; `fresh` re-reads the projection (vs the bound
// snapshot, which can lag), matching connectHandler's "re-read fresh at connect time".
// The kind comes from the entity (`subject.kind` — set by seeQuery, or by a {kind,id} bind
// like move's `subject`), defaulting to "being" (back-compatible: connect's candidates
// carry no kind and are beings). So space/matter slot reads are now `see` verbs too.
async function seeRead(subject, quality, fresh, branch) {
  // A bare id STRING is an id (key-export's target arrives as a plain beingId, not a row;
  // cherub-connect's collapse only worked because its candidate was already a row). Treat
  // it as { id }, kind=being, so the fresh read can loadProjection it — without this guard
  // a string subject silently reads "i-am"["trueName"] → null.
  const str = typeof subject === "string";
  let src = str ? null : subject;
  const kind = (str ? null : subject?.kind) || "being";
  const id = str ? subject : (subject?._id ?? subject?.id);
  if (fresh && id) {
    const { loadProjection } = await import("../../materials/projections.js");
    const proj = await loadProjection(kind, String(id), (str ? null : subject?.homeBranch) || branch || "0");
    src = proj?.state ?? src;
  }
  return String(quality).split(".").reduce((o, k) => (o == null ? o : o[k]), src) ?? null;
}

// ── recall (the SIXTH verb): reach back across TIME into a chain — the inner fold ──────
//
// CALL reaches across SPACE (a being, now); RECALL reaches across TIME (a chain, the past) —
// the "re-" is the temporal vector, one reaching at two distances. Reading a chain back lays
// NO fact (private cognition). The OBJECT decides BOTH the rendering and the gate: your OWN
// thread (recalled, always yours) or the WORLD you stand in (saw, the space's thread you can
// see); a foreign being's thread is private. What WRITES is the VERDICT — `recall <X> that
// <Y>` publishes the conclusion as a do:verdict fact; the two ends surface (what recalled +
// what concluded), the reflecting between stays silent. "saw … that it was good": the watching
// is private, the JUDGMENT is the fact. IR: { kind:"recall", of:<ref|"world">, as?, that? }.
async function evalRecall(node, ctx) {
  const branch = ctx.branch ?? "0";
  const ownBeing = ctx.identity?.beingId != null ? String(ctx.identity.beingId) : null;
  const ownName  = ctx.identity?.nameId  != null ? String(ctx.identity.nameId)  : (ctx.identity?.name != null ? String(ctx.identity.name) : null);

  // which thread? → the rendering (saw/recalled) + the access gate
  const isWorld = node.of === "world" || node.of?.ref === "world";
  let query, mode, ofLabel;
  if (isWorld) {
    query = { branch }; mode = "saw"; ofLabel = "the world";            // the world-space you stand in
  } else {
    const ref = (node.of && typeof node.of === "object" && node.of.ref != null) ? getPath(node.of.ref, ctx) : resolveValue(node.of, ctx);
    const id = String(ref?._id ?? ref?.id ?? ref ?? ownBeing);
    if (id === ownBeing || id === ownName) {
      query = { branch, $or: [{ through: ownBeing }, { by: ownName }] }; mode = "recalled"; ofLabel = "my own thread"; // your own thread, always yours
    } else {
      // your own thread is always yours; the world you can see; a foreign thread is private.
      // (Per-space saw-access for a specific other space is the next refinement.)
      throw new WordRefusal(`recall: that thread is not yours to recall`, "FORBIDDEN");
    }
  }

  if (ctx.dryRun) {
    if (node.as) ctx.bindings[node.as] = `<${mode}>`;
    if (node.that !== undefined) ctx.deltaF.push({ verb: "do", act: "verdict", params: { mode, of: ofLabel, that: resolveValue(node.that, ctx), ...(node.because !== undefined ? { because: resolveValue(node.because, ctx) } : {}) } });
    return mode;
  }

  // READ the chain back — the thread (NO fact: the inner fold the cognition reflects on)
  const { default: Fact } = await import("../../past/fact/fact.js");
  const thread = await Fact.find(query).sort({ date: 1, seq: 1 }).lean();
  if (node.as) ctx.bindings[node.as] = thread;

  // the VERDICT — the conclusion AND the why, published as one memory-write. CRITICAL (Tabor):
  // the recorded `because` is the being's DECLARED ACCOUNT of its reasoning — an authored Word
  // claim — NOT the live inference. The actual thinking stays silent and unstored ("refuse to
  // narrate the thinking"; the because is a pulled word, output not process). So the why on the
  // chain is the being's CLAIM about why (a self-report, possibly partial/self-serving), not its
  // computation: continuity for a stateless being, NOT transparency-of-thought. The being's own
  // chain is its memory; this verdict is the note it leaves itself, in the Word (the new-test form).
  if (node.that !== undefined) {
    await emit({
      verb: "do", act: "verdict", by: ownName, through: ownBeing,
      of: { kind: "being", id: ownBeing },   // the memory lands on the being's OWN reel — its chain is its memory
      params: { mode, of: ofLabel, that: resolveValue(node.that, ctx), ...(node.because !== undefined ? { because: resolveValue(node.because, ctx) } : {}) },
    }, ctx);
  }
  return thread;
}

// ── call (the CALL verb): reach ANOTHER being across SPACE, now — summon them to act or to
// talk. Lays the reach RECORD as a fact THROUGH moment, so it rides the moment + the
// stamper (never a bare emit). `.word` surface: `call <being>, saying <content>` (talk) and
// `call <being> to <intent>, with <content>` (summon-to-act) — the parser maps the surface
// to { being, intent?, content }. The backing is TreeOS's summon machinery (summonVerb),
// named `call` at the surface now; the full rename comes later. (RECALL — reaching across
// TIME into a chain — is the private twin; it lays no fact by itself.)
async function evalCall(node, ctx) {
  const entity = (v) => (v && typeof v === "object" && v.ref != null) ? getPath(v.ref, ctx) : resolveValue(v, ctx);
  // `saying <msg>` = a conveyed message (intent "message"); `to <act>[, with <payload>]` =
  // summon-to-act. `to` is an INTENT LABEL (kebab), NOT a parsed act — the owner receives it
  // plus the content and decides (a request). The structured payload rides in with/saying/content.
  const toIntent = node.to ? String(node.to).trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() : null;
  const intent = toIntent || node.intent || "message";
  const content = resolveValue(node.with ?? node.saying ?? node.content ?? {}, ctx);
  if (ctx.dryRun) {
    const r = `<call:${intent}>`;
    if (node.bind) ctx.bindings[node.bind] = r;
    return r;
  }
  const { getRealityDomain } = await import("../../ibp/address.js");
  const { loadOrFold } = await import("../../materials/projections.js");
  const reality = getRealityDomain();
  // the being to reach -> its stance (reality/@name). The being may arrive as a row
  // (name at top), a projection slot (name under .state), or a bare id (loadOrFold it).
  const target = entity(node.of ?? node.being);
  let toName = target?.name ?? target?.state?.name;
  if (!toName) {
    const id = target?._id ?? target?.id ?? (typeof target === "string" ? target : null);
    if (id) toName = (await loadOrFold("being", String(id), ctx.branch || "0"))?.state?.name;
  }
  if (!toName) throw new WordRefusal("call: cannot address the target being", "INVALID_INPUT");
  // the caller (the Name acting through its being) is the `from` stance. When the moment carries
  // only a beingId (a role-op threading its actor without a name), resolve the name off the being
  // so the `from` is a real stance — otherwise summon authorizes @undefined as anonymous.
  let fromName = ctx.identity?.name || ctx.identity?.nameId;
  if (!fromName && ctx.identity?.beingId) {
    fromName = (await loadOrFold("being", String(ctx.identity.beingId), ctx.branch || "0"))?.state?.name;
  }
  const message = { from: `${reality}/@${fromName}`, content, ...(node.intent ? { intent: node.intent } : {}) };
  const { summonVerb } = await import("../../ibp/verbs/summon.js");
  const result = await summonVerb(`${reality}/@${toName}`, message, { identity: ctx.identity, moment: ctx.moment });
  if (node.bind) ctx.bindings[node.bind] = result;
  return result;
}

// ── foreach (§3): iterate a source; body per item; break halts THIS loop only ──────
//
// Source forms (8.md §3): { ref } a bound collection; { ref, filter } filtered per item
// via the shared resolveCond; { walk } a being-tree walk resolved through the host
// registry (ctx.env.host.walk — the inheritation up-walk). The item binds to node.bind
// for the body AND the filter. A §5 flag a mark sets inside the body PERSISTS across
// iterations and after the loop (the accumulator). A `break` (BREAK sentinel) unwinds
// to the nearest foreach — caught here; refuse/return/real errors unwind past it.
async function evalForeach(node, ctx) {
  const { resolveCond, getPath } = await import("./cond.js");
  let items;
  if (node.in?.walk) {
    const fn = ctx.env?.host?.walk;
    items = fn ? (await fn(node.in.walk, ctx)) || [] : [];
  } else {
    const got = node.in?.ref ? getPath(node.in.ref, ctx) : [];
    items = Array.isArray(got) ? got : [];
  }
  for (const item of items) {
    ctx.bindings[node.bind] = item;
    if (node.in?.filter && !(await resolveCond(node.in.filter, ctx))) continue;
    try {
      for (const n of node.body || []) await evalNode(n, ctx);
    } catch (e) {
      if (e === BREAK) return; // §3 break: stop THIS loop, continue after it
      throw e;                 // refuse / return / real errors unwind past the loop
    }
  }
}

// ── refuse (§7): a host HALT, fail-closed, NO fact ─────────────────────────────────
// Throws a WordRefusal the verb layer maps to the ack error envelope; the moment rolls
// back. A §8 gate's onFail is a refuse. Distinct from a cond's negation (§10) and from
// break (loop-only). The message resolves $binding placeholders.
async function evalRefuse(node, ctx) {
  const m = typeof node.message === "string" ? resolveValue(node.message, ctx) : (resolveValue(node.message, ctx) || "refused");
  throw new WordRefusal(String(m), node.code || "FORBIDDEN");
}

// ── return (§7): a SUCCESS terminator, NO fact ─────────────────────────────────────
// Resolves named values + literal/ref extras into a result object and unwinds the flow
// (the __wordReturn signal evaluate() catches). The host transport reads ctx.result
// (tokens, seatBranch, reveal, asFather) — the "rode the handler return, never the
// fact" rule. World facts a flow lays came from §7 act/derive nodes that ran BEFORE it.
async function evalReturn(node, ctx) {
  const { getPath } = await import("./cond.js");
  const result = {};
  for (const name of node.values || []) result[name] = ctx.bindings[name];
  if (node.extra) for (const k of Object.keys(node.extra)) {
    const v = node.extra[k];
    // a {ref} reads a binding/flag/path (e.g. owned:(true/false) from a §5 flag);
    // anything else ($name or a literal) goes through resolveValue.
    result[k] = (v && typeof v === "object" && v.ref != null) ? getPath(v.ref, ctx) : resolveValue(v, ctx);
  }
  throw { __wordReturn: true, result };
}

// ── gate (§8): a PRE-SEAL precondition, fail-closed, lays NO fact ───────────────────
//
// Positional: the parser places the gate BEFORE the acts it guards, so it runs first.
// The predicate is the §1 cond, or a whole-gate host lookup (resolvedBy: findByName /
// getRole / hasAuthorityOver). Pass → fall through (a guard, not an effect). Fail →
// run onFail (a refuse: throw WordRefusal, halt, no fact) — mirrors do.js authorize and
// the NAME-declare must-not-exist throw, both of which abort before emitFact.
async function evalGate(node, ctx) {
  const { resolveCond } = await import("./cond.js");
  const cond = node.cond
    ? node.cond
    : (node.resolvedBy ? { resolvedBy: node.resolvedBy, args: node.args, negated: node.negated } : null);
  if (await resolveCond(cond, ctx)) return; // precondition holds
  if (node.onFail) return evalNode(node.onFail, ctx);
  throw new WordRefusal(resolveValue(node.message, ctx) || "precondition failed", node.code || "INVALID_INPUT");
}

// ── match (§9): type dispatch — keeps a flat surface flat ───────────────────────────
//
// Resolve `on` (a ref or a type field), run the FIRST matching case's body: a `label`
// compares to the on-value; a `when` is a §1 cond; a case with neither is the default.
// (Forcing the 5-way matter-type dispatch into nested ifs would break reads-cleanly.)
async function evalMatch(node, ctx) {
  const { resolveCond, getPath } = await import("./cond.js");
  const onVal = node.on != null ? getPath(node.on, ctx) : undefined;
  for (const c of node.cases || []) {
    const hit = c.label !== undefined ? String(onVal) === String(c.label)
      : c.when ? await resolveCond(c.when, ctx)
      : true; // default
    if (hit) { for (const n of c.body || []) await evalNode(n, ctx); return; }
  }
}

// ── derive (§7): the general fact-emission, OR a registered read-rule ───────────────
//
// `stored:false` → register a READ-RULE (the objective register: liveness / coverage /
// containment / authority computed on read off the reel, never persisted — Q7). Default
// → emit exactly ONE fact (`fact.type` = verb:op), attributed to `attributedTo` (the
// Name) and landing on its target/reel. The two forms differ purely in `stored`.
async function evalDerive(node, ctx) {
  if (node.stored === false) {
    (ctx.readRules ??= []).push(node); // a law read backward, not a deed
    return undefined;
  }
  const [verb, action] = String(node.fact?.type || "do:derive").split(":");
  return emit({
    verb,
    act: action,
    through: node.attributedTo ? resolveName(node.attributedTo, ctx) : (ctx.identity?.nameId ?? ctx.identity?.beingId ?? null),
    of: node.of ? resolveTarget(node.of, ctx) : undefined,
    params: resolveValue(node.params, ctx) || {},
  }, ctx);
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
  if (when.act) return fact.verb === when.act.verb && (!when.act.act || fact.act === when.act.act);
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
  if (act.verb === "be" && act.act === "form-being") {
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
    let target = resolveTarget(act.of, ctx);
    let p = params;
    if (act.act === "create-space") {
      // "I make <X>": X NAMES the new space; create-space raises it UNDER its target, which
      // is where the actor STANDS (the position the session reports) — of names the child,
      // not the parent. So the noun becomes the name and the position becomes the target.
      if (act.of?.id && !(p && p.name != null)) p = { ...(p || {}), name: act.of.id };
      if (ctx.position) target = { kind: "space", id: String(ctx.position) };
    }
    const res = await doVerb(target, act.act, p, { identity: ctx.identity, moment: ctx.moment });
    // bind the id the op actually created (the home space), so later acts
    // (form-being's homeId, set-space's owner target) reference the real id and
    // not the pre-mint. create-space returns { spaceId } (space/ops.js).
    if (act.bind) ctx.bindings[act.bind] = String(res?.spaceId ?? res?.id ?? res?._id ?? ctx.bindings[act.bind]);
    return res;
  }

  // every other verb emits its own fact (the act, sealed)
  return emit({
    verb: act.verb,
    act: act.act,                   // the operation within the verb (do:create-space, ...)
    through: through || by,         // the deed lands under the acting being / Name
    by,                             // the actor Name (rule 9)
    of: resolveTarget(act.of, ctx),
    to: act.to !== undefined ? resolveBeing(act.to, ctx) : undefined, // the receiver (rule 17)
    params,
    _event: act.event,              // a derived event this act counts as ("that is a beat")
    _sets: act.sets,                // this act's effect on world state (folded below)
  }, ctx);
}

// rule 13: a closure names a bounded span
async function evalClosure(node, ctx) {
  return emit({
    verb: "do", act: "close-span",
    through: resolveName(node.by, ctx),
    of: { kind: "span" },
    params: { name: node.name },
  }, ctx);
}

// ── primitive dispatch ────────────────────────────────────────────────────────

// emit a fact: dry-run collects it into ctx.deltaF; live sends it through emitFact
// into the moment. The two paths are EXCLUSIVE: emitFact itself appends the spec
// to moment.deltaF (facts.js:934), so when live + ctx.deltaF === moment.deltaF
// (runRoleWord shares the array), also doing ctx.deltaF.push would DOUBLE-LIST the
// fact. Live → emitFact owns the append; dry-run → ctx.deltaF.push (no live moment).
async function emit(spec, ctx) {
  const fact = { ...spec, actId: ctx.moment?.actId, branch: ctx.branch };
  if (spec._sets) Object.assign((ctx.state ??= {}), spec._sets); // the fold: a fact updates state
  if (ctx.dryRun) {
    ctx.deltaF.push(fact);
  } else {
    const { emitFact } = await import("../../past/fact/facts.js");
    await emitFact(fact, ctx.moment); // appends to moment.deltaF itself
  }
  (ctx._queue ??= []).push(fact); // a sealed fact may fire standing watches (the choq)
  return fact;
}

// form a being: dry-run models the be:birth fact; live calls the real primitive.
async function formBeing(spec, ctx) {
  if (ctx.dryRun) {
    const beingId = `<being:${spec.name}>`; // birthBeing computes a content hash; placeholder here
    ctx.deltaF.push({
      verb: "be", act: "birth", through: beingId, of: { kind: "being", id: beingId },
      params: spec, actId: ctx.moment?.actId, branch: ctx.branch,
    });
    return { beingId, name: spec.name };
  }
  const { birthBeing } = await import("../../materials/being/identity/birth.js");
  return birthBeing({ spec, identity: ctx.identity, moment: ctx.moment, branch: ctx.branch });
}

async function callHost(builtin, params, ctx) {
  const fn = ctx.env?.host?.[builtin];
  // pass the eval ctx as a 2nd arg so a host op that lays a fact (e.g. the be:release
  // displacement) can reach ctx.moment; pure ops ignore it.
  if (fn) return fn(params, ctx);
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
  // A `$`-ref resolves through getPath (dotted-aware): a flat `$target` reads
  // ctx.bindings.target exactly as before, and a dotted `$credential.hash` descends the
  // bound object. A genuinely-unbound ref stays the literal (getPath returns undefined).
  if (typeof v === "string" && v.startsWith("$")) {
    const got = getPath(v.slice(1), ctx);
    return got === undefined ? v : got;
  }
  // A possessive reference: `credential's hash` parses to { ref: "credential.hash" }, the
  // SAME shape returns and conditions already use. Resolve it through getPath so a write
  // value resolves identically to a return value or a cond operand — one ref, one resolver.
  if (v && typeof v === "object" && v.ref != null) return getPath(v.ref, ctx);
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
