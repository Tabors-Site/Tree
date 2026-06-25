#!/usr/bin/env node
// verify-see-floor — SEE_FLOOR is a NAMED CLOSED SET vetting every host-backed see-op, the twin of
// HOST_FLOOR. A see-op reaches a host READ/COMPUTE two ways: the block form `see <op>(args) as v`
// (an EFFECT_RULES line → node.act) and the inline predicate `<op>(args)` in a cond (parseLeaf →
// cond.seeCall). Both dispatch through the SAME ctx.env.host registry as callHost, so the SAME closed
// set must gate both. An UNKNOWN see-op is REJECTED (the door stays shut on both faces of the verb).
//
// This is a PURE-PARSER verifier (no store boot): the gate lives entirely in parse(). It proves:
//   1. an unknown BLOCK see-op (`see bogus() as x`) inside a flow body REJECTS;
//   2. an unknown INLINE see-op predicate (`If bogus(history):`) REJECTS;
//   3. every LEGIT see-op the corpus uses still PARSES (block + inline forms);
//   4. the action-sees re-typed `do <op>(args)` (write-model, clear-model: 17.md see=inert) are NOT
//      gated by SEE_FLOOR — they leave the see path entirely (they parse as do-op escapes).

import { parse } from "./parser.js";

let pass = 0,
  fail = 0;
const ok = (l) => {
  pass++;
  console.log(`  ✓ ${l}`);
};
const bad = (l, d) => {
  fail++;
  console.log(`  ✗ ${l}`);
  if (d !== undefined)
    console.log(`      ${typeof d === "string" ? d : JSON.stringify(d)}`);
};

// see-ops are BODY effects, so wrap each in a minimal flow header.
const flow = (...body) =>
  ["When a caller acts:", ...body.map((l) => "  " + l)].join("\n");
const rejects = (src, why) => {
  try {
    parse(src);
    return null;
  } catch (e) {
    return /not a recognized SEE FLOOR/.test(e.message) ? true : e.message;
  }
};

console.log(`\n  verify-see-floor (the closed see-op door, the twin of HOST_FLOOR)\n`);
try {
  // ── 1. unknown BLOCK see-op rejects ──
  rejects(flow("see bogus() as x.")) === true
    ? ok(`(1) unknown block see-op \`see bogus() as x\` → REJECTED (door shut)`)
    : bad(`(1) unknown block see-op did NOT reject`, rejects(flow("see bogus() as x.")));

  // ── 2. unknown INLINE see-op predicate rejects ──
  rejects(flow("If bogus(history):", "  refuse with \"no\".")) === true
    ? ok(`(2) unknown inline see-op predicate \`If bogus(history):\` → REJECTED (door shut)`)
    : bad(
        `(2) unknown inline see-op predicate did NOT reject`,
        rejects(flow("If bogus(history):", "  refuse with \"no\".")),
      );

  // ── 3. legit see-ops still parse (a representative spread across the floor groups) ──
  const legitBlock = [
    ["validate-render-block", "see validate-render-block(block) as ok."],
    ["resolve-source", "see resolve-source(subject, to) as fromSpace."],
    ["read-credential", "see read-credential(caller) as cred."],
    ["resolve-birth-spec", "see resolve-birth-spec(spec) as birth."],
    ["owner-of", "see owner-of(target) as owner."],
    ["able-spec-for-grant", "see able-spec-for-grant(able, space) as found."],
    ["resolve-connection", "see resolve-connection(subject, to) as conn."],
    ["find-being-parent", "see find-being-parent(being) as parent."],
    ["load-key", "see load-key(name) as key."],
    ["story-root", "see story-root() as root."],
    ["mint-credential", "see mint-credential as credential."],
    ["valid-canonical", "see valid-canonical(name) as okName."],
  ];
  let blockOk = true;
  for (const [name, line] of legitBlock) {
    try {
      const ir = parse(flow(line));
      const eff = ir[0]?.effects?.[0];
      if (!(eff?.kind === "see" && eff?.act === name)) {
        blockOk = false;
        bad(`(3) legit block see-op "${name}" parsed wrong`, eff);
      }
    } catch (e) {
      blockOk = false;
      bad(`(3) legit block see-op "${name}" threw`, e.message.split("\n")[0]);
    }
  }
  blockOk &&
    ok(`(3) every legit BLOCK see-op parses (${legitBlock.length} sampled across the floor groups)`);

  // ── 3b. legit inline see-op predicates still parse ──
  const legitInline = [
    "destination-missing(history)",
    "being-lives-on(caller, history)",
    "name-exists(name)",
    "is-grabbable(target)",
    "valid-address(address)",
  ];
  let inlineOk = true;
  for (const pred of legitInline) {
    try {
      const ir = parse(flow(`If ${pred}:`, "  refuse with \"no\"."));
      const opName = pred.slice(0, pred.indexOf("("));
      if (!JSON.stringify(ir).includes(`"seeCall":"${opName}"`)) {
        inlineOk = false;
        bad(`(3b) legit inline predicate "${pred}" not lifted to seeCall`);
      }
    } catch (e) {
      inlineOk = false;
      bad(`(3b) legit inline predicate "${pred}" threw`, e.message.split("\n")[0]);
    }
  }
  inlineOk &&
    ok(`(3b) every legit INLINE see-op predicate parses (${legitInline.length} sampled)`);

  // ── 4. the converted action-sees are NOT on the see path (they parse as do-op escapes) ──
  let doOk = true;
  for (const op of ["write-model", "clear-model"]) {
    try {
      const ir = parse(flow(`do ${op}(kind, forMatterType) as wrote.`));
      const eff = ir[0]?.effects?.[0];
      if (!(eff?.verb === "do" && eff?.host === op)) {
        doOk = false;
        bad(`(4) action-see "${op}" did not parse as a do-op escape`, eff);
      }
    } catch (e) {
      doOk = false;
      bad(`(4) action-see "${op}" threw`, e.message.split("\n")[0]);
    }
  }
  doOk &&
    ok(`(4) the converted action-sees (write-model, clear-model) parse as do-op escapes — off the see path, never SEE_FLOOR`);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
