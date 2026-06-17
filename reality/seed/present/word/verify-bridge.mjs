// Sanity check for the bridge registry: it resolves the first converted slice
// (cherub birth -> cherub.word, parsed) and falls through (null) for everything
// else. No DB; just proves the lookup + parse work. Run:
//   node reality/seed/present/word/verify-bridge.mjs

import { resolveRoleWord } from "./roleWordRegistry.js";

let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d) console.log(`      ${d}`); };

console.log("\n  verify-bridge\n");

const ir = resolveRoleWord("cherub", "birth");
ir ? ok(`cherub:birth resolves to a .word program (${ir.length} clauses)`)
   : bad("cherub:birth resolves to a .word program", "got null");

const flow = ir?.find((n) => n.kind === "flow");
flow ? ok(`it carries the birth flow with ${flow.effects?.length ?? 0} effects`)
     : bad("it carries a birth flow", JSON.stringify(ir).slice(0, 200));

(flow?.effects?.length === 5)
  ? ok("the birth flow has the five world acts (home, form, owner, role, lineage)")
  : bad("the birth flow has five effects", `got ${flow?.effects?.length}`);

resolveRoleWord("cherub", "connect") === null
  ? ok("cherub:connect falls through to the JS handler (null)")
  : bad("cherub:connect falls through", "expected null");

resolveRoleWord("dancer", "step") === null
  ? ok("an unregistered (role, op) falls through (null)")
  : bad("unregistered falls through", "expected null");

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
