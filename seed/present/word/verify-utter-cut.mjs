// verify-utter-cut.mjs — the 623/12.md collapse: `[address] "quoted word"` parses to ONE `call`
// node; the TARGET decides self (fold) vs other (await); the LENS is the peeled interrogative
// (what = the narrative / no lens; the other five name a column). The existing keyword rules
// (set / `call X to …`) still win first — no false-match by the broad quote rule. Parse-shape
// only (no boot): the routing is exercised live by verify-call-live (await) + verify-recall-live
// (fold via evalRecall). Run: node seed/present/word/verify-utter-cut.mjs

import { parse } from "./parser.js";

let pass = 0,
  fail = 0;
function firstEffect(src) {
  const ir = parse(`When a being thinks:\n  ${src}`);
  return (ir?.[0]?.effects || [])[0];
}
function check(label, src, fn) {
  try {
    const e = firstEffect(src);
    const ok = !!fn(e);
    console.log(`  ${ok ? "✓" : "✗"} ${label}${ok ? "" : ` → got ${JSON.stringify(e)}`}`);
    ok ? pass++ : fail++;
  } catch (err) {
    console.log(`  ✗ ${label} → ERR ${err.message}`);
    fail++;
  }
}

console.log("\n  verify-utter-cut (623/12: CALL is the one verb; the target decides)\n");

check(
  'bare quote → SELF call (of:null), no lens (what = the narrative)',
  '"what from?".',
  (e) => e.kind === "call" && e.of === null && e.saying === "what from?" && e.lens === undefined,
);
check(
  'named → OTHER call (of:{ref}); the full quote rides as the message',
  'salem "what from?".',
  (e) => e.kind === "call" && e.of?.ref === "salem" && e.saying === "what from?",
);
check(
  'lens peeled: where → lens:"where", bind carried',
  '"where from?" as facets.',
  (e) => e.kind === "call" && e.of === null && e.lens === "where" && e.bind === "facets",
);
check('lens peeled: who → lens:"who"', '"who from?".', (e) => e.kind === "call" && e.lens === "who");
check(
  '"world" address → the whole story (of:"world")',
  'the world "what from?".',
  (e) => e.kind === "call" && e.of === "world",
);
check(
  'set rule WINS over the quote rule (no false-match)',
  `set the being's name to "bob".`,
  (e) => e.kind === "act" && e.act === "set-being",
);
check(
  'ask-able call alias preserved (call X to …)',
  "call the owner to able-request, with $found as queued.",
  (e) => e.kind === "call" && e.of?.ref === "owner" && e.to === "able-request",
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
