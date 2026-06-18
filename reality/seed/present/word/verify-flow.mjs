#!/usr/bin/env node
// if + mark, end to end through evaluate() — the §2/§5 keystone wired into the
// evaluator (dry-run, no DB). Hand-built flow IR in the cherub-connect shape:
// marks set flow-local flags, then an `if` over them branches, and only the taken
// branch's acts reach deltaF. Proves evalIf/evalMark + the shared resolveCond compose.

import { evaluate } from "./evaluator.js";

let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d !== undefined) console.log(`      ${JSON.stringify(d)}`); };

// run a hand-built flow dry, return the verbs:ops it laid + bindings + result/refusal
async function run(flow, trigger = {}, bindings = {}, env = {}) {
  const ctx = { dryRun: true, summonCtx: { actId: "t" }, branch: "0", trigger, bindings: { ...bindings }, deltaF: [], env };
  let refused = null;
  try { await evaluate(flow, ctx); }
  catch (e) { if (e && e.__wordRefusal) refused = e; else throw e; }
  return { laid: ctx.deltaF.map((f) => `${f.verb}:${f.action}`), bindings: ctx.bindings, result: ctx.result, refused, deltaF: ctx.deltaF, laws: ctx.laws || [], readRules: ctx.readRules || [] };
}

// a plain dry-run act (emits one fact through the evaluator's emit path)
const act = (op) => ({ kind: "act", verb: "do", op, of: { kind: "being", id: "x" }, params: {} });

console.log(`\n  verify-flow (if + mark through evaluate)\n`);

// ── 1. if-TRUE runs `then`, skips `else` ──
{
  const flow = { kind: "flow", binds: [], body: [
    { kind: "if", cond: { test: { op: "equals", path: "role", value: "dj" } },
      then: [act("queue")], else: [act("deny")] },
  ] };
  const { laid } = await run(flow, {}, { role: "dj" });
  laid.length === 1 && laid[0] === "do:queue" ? ok("if TRUE → only `then` ran") : bad("if true", laid);
}

// ── 2. if-FALSE runs `else` ──
{
  const flow = { kind: "flow", binds: [], body: [
    { kind: "if", cond: { test: { op: "equals", path: "role", value: "dj" } },
      then: [act("queue")], else: [act("deny")] },
  ] };
  const { laid } = await run(flow, {}, { role: "guest" });
  laid.length === 1 && laid[0] === "do:deny" ? ok("if FALSE → only `else` ran") : bad("if false", laid);
}

// ── 3. if-FALSE with no else → nothing ──
{
  const flow = { kind: "flow", binds: [], body: [
    { kind: "if", cond: { flag: "allowed" }, then: [act("go")] },
  ] };
  const { laid } = await run(flow, {}, { allowed: false });
  laid.length === 0 ? ok("if FALSE, no else → no act") : bad("if no-else", laid);
}

// ── 4. mark then read: the accumulate-then-branch shape ──
{
  const flow = { kind: "flow", binds: [], body: [
    { kind: "mark", flag: "beingFound" },                              // a "loop pass" found one
    { kind: "if", cond: { negated: true, flag: "beingFound" },         // "if no being was found"
      then: [act("refuse-path")], else: [act("inhabit")] },
  ] };
  const { laid, bindings } = await run(flow);
  bindings.beingFound === true && laid.length === 1 && laid[0] === "do:inhabit"
    ? ok("mark sets flag → sibling `if no being was found` takes else (inhabit)") : bad("mark+if", { laid, beingFound: bindings.beingFound });
}

// ── 5. mark OR-accumulates (asFather true if ANY pass set it) ──
{
  const flow = { kind: "flow", binds: [], body: [
    { kind: "mark", flag: "asFather", value: false },  // a no-op-ish set (value false)
    { kind: "mark", flag: "asFather" },                // a later pass sets true
    { kind: "mark", flag: "asFather", value: false },  // must NOT reset it
    { kind: "if", cond: { flag: "asFather" }, then: [act("displace")] },
  ] };
  const { laid, bindings } = await run(flow);
  bindings.asFather === true && laid[0] === "do:displace"
    ? ok("mark OR-accumulates (a later false does NOT reset a set flag)") : bad("mark OR", { asFather: bindings.asFather, laid });
}

// ── 6. nested if + all/any cond ──
{
  const flow = { kind: "flow", binds: [], body: [
    { kind: "if", cond: { all: [ { flag: "signedIn" }, { any: [ { flag: "owns" }, { test: { op: "equals", path: "name", value: "root" } } ] } ] },
      then: [ { kind: "if", cond: { test: { op: "compare", as: "ge", path: "votes", against: { ref: "quorum" } } },
        then: [act("pass")], else: [act("hold")] } ],
      else: [act("reject")] },
  ] };
  const a = await run(flow, {}, { signedIn: true, owns: false, name: "root", votes: 3, quorum: 2 });
  const b = await run(flow, {}, { signedIn: true, owns: true, name: "x", votes: 1, quorum: 2 });
  const c = await run(flow, {}, { signedIn: false });
  a.laid[0] === "do:pass" && b.laid[0] === "do:hold" && c.laid[0] === "do:reject"
    ? ok("nested if + all/any: (root,3≥2)→pass, (owns,1<2)→hold, (!signedIn)→reject") : bad("nested", { a: a.laid, b: b.laid, c: c.laid });
}

// ── 7. foreach: body runs per item; a mark inside accumulates across passes ──
{
  const flow = { kind: "flow", binds: [], body: [
    { kind: "foreach", bind: "c", in: { ref: "candidates" }, body: [
      { kind: "if", cond: { test: { op: "equals", path: "c.kind", value: "match" } }, then: [ { kind: "mark", flag: "found" } ] },
    ] },
    { kind: "if", cond: { flag: "found" }, then: [act("inhabit")], else: [act("none")] },
  ] };
  const hit = await run(flow, {}, { candidates: [{ kind: "x" }, { kind: "match" }, { kind: "y" }] });
  const miss = await run(flow, {}, { candidates: [{ kind: "x" }, { kind: "y" }] });
  hit.bindings.found === true && hit.laid[0] === "do:inhabit" && miss.laid[0] === "do:none"
    ? ok("foreach body per item; mark accumulates → post-loop if reads the OR") : bad("foreach+mark", { hit: hit.laid, miss: miss.laid });
}

// ── 8. break halts the nearest foreach (stop on first match) ──
{
  const flow = { kind: "flow", binds: [], body: [
    { kind: "foreach", bind: "c", in: { ref: "items" }, body: [
      act("visit"),
      { kind: "if", cond: { test: { op: "equals", path: "c", value: "stop" } }, then: [ { kind: "break" } ] },
    ] },
  ] };
  const { laid } = await run(flow, {}, { items: ["a", "stop", "b", "c"] });
  // visits "a" then "stop" (then breaks) → 2 visits, never reaches "b"/"c"
  laid.length === 2 && laid.every((x) => x === "do:visit") ? ok("break halts the foreach on first match (2 visits, not 4)") : bad("break", laid);
}

// ── 9. foreach filter (only items passing the cond run the body) ──
{
  const flow = { kind: "flow", binds: [], body: [
    { kind: "foreach", bind: "s", in: { ref: "schedules", filter: { test: { op: "compare", as: "le", path: "s.due", against: { ref: "now" } } } },
      body: [ act("fire") ] },
  ] };
  const { laid } = await run(flow, {}, { now: 100, schedules: [{ due: 50 }, { due: 200 }, { due: 100 }, { due: 999 }] });
  laid.length === 2 ? ok("foreach filter: only entries past their cursor fire (2 of 4)") : bad("foreach filter", laid);
}

// ── 10. refuse: throws WordRefusal, lays NO fact, propagates out ──
{
  const flow = { kind: "flow", binds: [], body: [
    { kind: "if", cond: { negated: true, flag: "ok" }, then: [ { kind: "refuse", message: "not allowed", code: "FORBIDDEN" } ] },
    act("never"),
  ] };
  const { refused, laid } = await run(flow, {}, { ok: false });
  refused && refused.code === "FORBIDDEN" && refused.message === "not allowed" && laid.length === 0
    ? ok("refuse → WordRefusal (code+message), no fact, halts the flow") : bad("refuse", { refused: refused && refused.message, laid });
}

// ── 11. return: sets ctx.result, stops the flow (later nodes don't run) ──
{
  const flow = { kind: "flow", binds: [], body: [
    { kind: "mark", flag: "owned" },
    { kind: "return", values: ["being"], extra: { owned: { ref: "owned" }, welcome: "hi" } },
    act("never-runs"),
  ] };
  const { result, laid } = await run(flow, {}, { being: "b-123" });
  result && result.being === "b-123" && result.owned === true && result.welcome === "hi" && laid.length === 0
    ? ok("return: result {being, owned:flag-ref, welcome}, flow stops (no later act)") : bad("return", { result, laid });
}

// ── 12. break is loop-local; refuse inside a loop propagates PAST it ──
{
  const flow = { kind: "flow", binds: [], body: [
    { kind: "foreach", bind: "c", in: { ref: "items" }, body: [
      { kind: "if", cond: { test: { op: "equals", path: "c", value: "bad" } }, then: [ { kind: "refuse", message: "bad item" } ] },
      act("ok"),
    ] },
    act("after-loop"),
  ] };
  const { refused, laid } = await run(flow, {}, { items: ["good", "bad", "more"] });
  refused && refused.message === "bad item" && laid.length === 1 && laid[0] === "do:ok"
    ? ok("refuse inside foreach propagates PAST the loop (1 ok, then halt; no after-loop)") : bad("refuse-in-loop", { refused: refused && refused.message, laid });
}

// ── 13. gate PASS → falls through to the guarded act ──
{
  const flow = { kind: "flow", binds: [], body: [
    { kind: "gate", cond: { test: { op: "reads", path: "role" } }, onFail: { kind: "refuse", message: "no role" } },
    act("grant"),
  ] };
  const { laid, refused } = await run(flow, {}, { role: "human" });
  !refused && laid[0] === "do:grant" ? ok("gate PASS → guarded act runs") : bad("gate pass", { laid, refused });
}

// ── 14. gate FAIL → refuse, no fact (the NAME-declare must-not-exist shape) ──
{
  const flow = { kind: "flow", binds: [], body: [
    // a gate via host: "the real-name must not already exist"
    { kind: "gate", resolvedBy: "nameExists", args: [{ ref: "name" }], negated: true, onFail: { kind: "refuse", message: "name taken", code: "RESOURCE_CONFLICT" } },
    act("declare"),
  ] };
  const env = { host: { nameExists: async (n) => n === "taken" } };
  const free = await run(flow, {}, { name: "fresh" }, env);
  const taken = await run(flow, {}, { name: "taken" }, env);
  free.laid[0] === "do:declare" && !free.refused && taken.refused?.code === "RESOURCE_CONFLICT" && taken.laid.length === 0
    ? ok("gate via host: fresh name declares, taken name refuses (no fact)") : bad("gate host", { free: free.laid, taken: taken.refused?.code });
}

// ── 15. match by label (the 5-way matter-type dispatch) ──
{
  const flow = { kind: "flow", binds: [], body: [
    { kind: "match", on: "type", cases: [
      { label: "file",   body: [act("store-bytes")] },
      { label: "model",  body: [act("store-glb")] },
      { body: [act("store-generic")] }, // default
    ] },
  ] };
  const f = await run(flow, {}, { type: "file" });
  const m = await run(flow, {}, { type: "model" });
  const g = await run(flow, {}, { type: "note" });
  f.laid[0] === "do:store-bytes" && m.laid[0] === "do:store-glb" && g.laid[0] === "do:store-generic"
    ? ok("match by label: file→bytes, model→glb, other→default") : bad("match label", { f: f.laid, m: m.laid, g: g.laid });
}

// ── 16. match by when-cond ──
{
  const flow = { kind: "flow", binds: [], body: [
    { kind: "match", on: null, cases: [
      { when: { test: { op: "compare", as: "ge", path: "votes", against: { ref: "quorum" } } }, body: [act("pass")] },
      { body: [act("hold")] },
    ] },
  ] };
  (await run(flow, {}, { votes: 5, quorum: 3 })).laid[0] === "do:pass" && (await run(flow, {}, { votes: 1, quorum: 3 })).laid[0] === "do:hold"
    ? ok("match by when-cond: votes≥quorum→pass, else hold") : bad("match when");
}

// ── 17. derive (default) emits ONE fact; derive stored:false registers a read-rule ──
{
  const emitFlow = { kind: "flow", binds: [], body: [
    { kind: "derive", fact: { type: "be:birth" }, attributedTo: "I", of: { kind: "being", id: "b-new" }, params: { name: "newbie" } },
  ] };
  const { laid } = await run(emitFlow, {}, {});
  laid.length === 1 && laid[0] === "be:birth" ? ok("derive default → emits one fact (be:birth)") : bad("derive emit", laid);

  const readFlow = { kind: "flow", binds: [], body: [
    { kind: "derive", fact: { type: "do:grant-inheritation" }, stored: false, infer: { relation: "authority" } },
  ] };
  const r = await run(readFlow, {}, {});
  r.laid.length === 0 && r.readRules.length === 1 ? ok("derive stored:false → registers a read-rule, NO fact (objective register)") : bad("derive read-rule", { laid: r.laid, rules: r.readRules.length });
}

// ── 18. the LAW family registers (no fact), the OBJECTIVE register ──
{
  const flow = { kind: "flow", binds: [], body: [
    { kind: "capability", role: "dj", polarity: "can", verb: "do", op: "queue" },
    { kind: "prohibition", clause: "no one can back it", negated: true },
    { kind: "property", subject: "matter", prop: "owner" },
    act("real-deed"),
  ] };
  const { laid, laws } = await run(flow, {}, {});
  laid.length === 1 && laid[0] === "do:real-deed" && laws.length === 3
    ? ok("law family (capability/prohibition/property) registers, lays NO fact; deeds still run") : bad("law family", { laid, laws: laws.length });
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
