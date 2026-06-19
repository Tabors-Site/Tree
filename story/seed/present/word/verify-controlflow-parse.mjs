// Integration: PARSE control-flow .word, then run it through the engine's evaluate()
// (the §0-§11 caps). Proves the parser emits IR the caps actually execute, mirroring
// verify-flow.mjs but from prose instead of hand-built IR. Dry-run, no DB.
//
//   node story/seed/present/word/verify-controlflow-parse.mjs

import { parse } from "./parser.js";
import { evaluate } from "./evaluator.js";

let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d !== undefined) console.log(`      ${JSON.stringify(d)}`); };

// parse one flow, run its effects dry, report what it laid / bound / returned / refused
async function run(src, bindings = {}) {
  const flow = parse(src)[0];
  const ctx = {
    dryRun: true, branch: "main", moment: { actId: "<a>" },
    identity: { beingId: "tester", name: "tester", nameId: "tester" },
    env: {}, bindings: { ...bindings }, deltaF: [], flows: [],
  };
  let refused = null;
  try { await evaluate(flow, ctx); }
  catch (e) { if (e && e.__wordRefusal) refused = e; else throw e; }
  return { flow, laid: ctx.deltaF.map((f) => `${f.verb}:${f.act}`), bindings: ctx.bindings, result: ctx.result, refused };
}

console.log("\n  verify-controlflow-parse (.word -> parse -> evaluate)\n");

// 1. if / else (§2) over a lifted test skeleton
{
  const src = `When a guest enters:\n  If the role equals dj:\n    queue the guest.\n  Otherwise:\n    deny the guest.`;
  const dj = await run(src, { role: "dj" });
  const mc = await run(src, { role: "mc" });
  // show the parsed IR once, so the cap-shape match is visible
  console.log("    if-node:", JSON.stringify(dj.flow.effects[0]).slice(0, 120), "…");
  (JSON.stringify(dj.laid) === '["do:queue"]' && JSON.stringify(mc.laid) === '["do:deny"]')
    ? ok("if/else over `the role equals dj` → dj queues, mc denies") : bad("if/else", { dj: dj.laid, mc: mc.laid });
}

// 2. mark + if (§5): reflexive state-mark, sibling `if no X was found` reads the same flag
{
  const src = `When checking a candidate:\n  the candidate is found.\n  If no candidate was found:\n    refuse with "none".\n  Otherwise:\n    accept the candidate.`;
  const r = await run(src);
  (JSON.stringify(r.laid) === '["do:accept"]' && !r.refused)
    ? ok("mark `the candidate is found` → sibling `if no candidate was found` takes else (accept)") : bad("mark+if", { laid: r.laid, refused: !!r.refused, flags: r.bindings });
}

// 3. foreach + break (§3): body per item, break halts on first match
{
  const src = `When scanning the items:\n  For each item in items:\n    visit the item.\n    If the item equals stop:\n      stop.`;
  const r = await run(src, { items: ["a", "stop", "b"] });
  (r.laid.length === 2 && r.laid.every((x) => x === "do:visit"))
    ? ok("foreach + break: visits a, stop, then halts (2 visits, not 3)") : bad("foreach+break", r.laid);
}

// 4. refuse (§7): throws WordRefusal, lays no fact, halts
{
  const src = `When guarding the door:\n  If no pass was verified:\n    refuse with "denied".\n  open the door.`;
  const r = await run(src);
  (r.refused && r.refused.message === "denied" && r.laid.length === 0)
    ? ok("refuse → WordRefusal, no fact laid, flow halts") : bad("refuse", { refused: r.refused && r.refused.message, laid: r.laid });
}

// 5. return (§7): sets ctx.result, stops the flow (later acts don't run)
{
  const src = `When connecting a being:\n  Return token.\n  deny the guest.`;
  const r = await run(src, { token: "abc" });
  (r.result && r.result.token === "abc" && r.laid.length === 0)
    ? ok("return: result carries the binding, flow stops (deny never runs)") : bad("return", { result: r.result, laid: r.laid });
}

// 6. and/any combinators (§1) + nested if
{
  const src = `When voting closes:\n  If signedIn and the votes is at least 2:\n    pass the proposal.\n  Otherwise:\n    hold the proposal.`;
  const yes = await run(src, { signedIn: true, votes: 3 });
  const no = await run(src, { signedIn: true, votes: 1 });
  (JSON.stringify(yes.laid) === '["do:pass"]' && JSON.stringify(no.laid) === '["do:hold"]')
    ? ok("`signedIn and the votes is at least 2` → all-combinator: (T,3)→pass, (T,1)→hold") : bad("all/compare", { yes: yes.laid, no: no.laid });
}

// 7. COMPOSITE: a cherub-connect-shaped slice (op-trigger + foreach + if-test +
// mark + break + post-loop if → refuse/return). The whole branching/looping/refusing
// shape end to end, all from prose.
{
  const src = [
    "When Cherub connects with a name and a password:",
    "  For each candidate in candidates:",
    "    If the candidate's local equals true:",
    "      the being is found.",
    "      stop.",
    "  If no being was found:",
    "    refuse with \"Invalid credentials\".",
    "  Return token.",
  ].join("\n");
  const found = await run(src, { candidates: [{ local: false }, { local: true }], token: "sess" });
  const none = await run(src, { candidates: [{ local: false }] });
  (found.result && found.result.token === "sess" && !found.refused && none.refused && none.refused.message === "Invalid credentials")
    ? ok("composite connect: foreach finds a local candidate → marks+breaks+returns; none → refuse")
    : bad("composite", { found: { result: found.result, refused: !!found.refused }, none: { refused: none.refused && none.refused.message } });
}

// 8. §9 match: value dispatch on a path, label cases + a default (the matter-type 5-way)
{
  const src = [
    "When matter is brought:",
    "  Match the matter's type:",
    "    For file:",
    "      save the bytes.",
    "    For model:",
    "      render the glb.",
    "    Otherwise:",
    "      show the text.",
  ].join("\n");
  const flow = parse(src)[0];
  const node = flow.effects[0];
  const dispatch = async (type) => {
    const ctx = { dryRun: true, branch: "main", moment: { actId: "<a>" }, identity: { nameId: "t" }, env: {}, bindings: { matter: { type } }, deltaF: [], flows: [] };
    await evaluate(flow, ctx);
    return ctx.deltaF.map((f) => f.act);
  };
  const file = await dispatch("file"), model = await dispatch("model"), other = await dispatch("zzz");
  (node.kind === "match" && node.on === "matter.type" && node.cases.length === 3 &&
   JSON.stringify(file) === '["save"]' && JSON.stringify(model) === '["render"]' && JSON.stringify(other) === '["show"]')
    ? ok("§9 match: `Match the matter's type:` → file→save, model→render, default→show") : bad("match", { on: node.on, file, model, other });
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
