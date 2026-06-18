// Phase 2 demo: run the harmony pulse for a bounded number of beats.
// Run:  node reality/seed/present/word/harmony-demo.js
//
// Shows rule 6 (flows fire on completion) and rule 12 (the choq: each beat begets
// the next, the dancer coupled to the drummer) with no clock anywhere, only
// completion advancing the reel, bounded by maxBeats so it terminates.

import { evaluate, register, pump } from "./evaluator.js";
import { harmony, firstStrike } from "./harmony.ir.js";

const ctx = {
  dryRun: true,
  branch: "main",
  moment: { actId: "<actId>" },
  bindings: {},
  deltaF: [],
  flows: [],
  beats: 0,
  maxBeats: 4, // observe four beats of an endless rhythm
  env: {},
};

register(harmony, ctx);     // register the watches (the drummer's and dancer's flows)
await evaluate([firstStrike], ctx); // kick: the drummer's opening strike (beat 1)
await pump(ctx);            // the choq runs: each beat begets the next, bounded

console.log(`\nharmony (dry-run), ${ctx.beats} beats observed:\n`);
let beat = 0;
for (const f of ctx.deltaF) {
  if (f._event === "beat") {
    if (++beat > ctx.maxBeats) { console.log("  ... (the rhythm continues, unobserved)"); break; }
    console.log(`  beat ${beat}:  ${f.beingId} strikes the drum`);
  } else if (f.action === "step") {
    console.log(`           ${f.beingId} steps`);
  }
}
console.log("");
