#!/usr/bin/env node
// verify-matterword-dispatch . the verb-lane half of P5: a do-op whose BODY is MATTER (a content-
// addressed blob, NOT a host handler) dispatches through runMatterWord, not a JS handler. Binds a
// do-op with matter:{hash,type} (no do.ref), stores its blob in CAS, then doVerbs it: resolveDoOpFromFold
// surfaces the matter body, do.js routes to runMatterWord (matterWord.js), the matter TYPE's run-op
// executes the bytes over the op's params, and the result feeds the normal do auto-Fact. There is NO
// host handler, so a correct computed result PROVES the bytes ran through the matter executor — the
// native-word dispatch seam. (The binding-ref side — bindWord carrying matter:{…} — is the engine
// lane's; this proves the dispatch side composes with the matter-type registry + CAS they shipped.)
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const DB = path.join(os.tmpdir(), "story_matterworddispatch-" + process.pid);
process.env.PORT = "3839";
process.env.TREEOS_STORE_BASE = DB;
fs.rmSync(DB, { recursive: true, force: true });
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "matterworddispatch-0123456789";
process.env.STORY_KEY_DIR = path.join(
  os.tmpdir(),
  "matterworddispatch-keys-" + process.pid,
);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
// (scratch file store fresh-wiped above; no DB to drop)
await import(`${R}/begin.js`);
const { findByName } = await import(`${R}/seed/materials/projections.js`);
const { bindWord, resolveDoOpFromFold } = await import(
  `${R}/seed/present/word/wordStore.js`
);
const { doVerb } = await import(`${R}/seed/ibp/verbs/do.js`);
const { getOperation } = await import(`${R}/seed/ibp/operations.js`);
const { putContent } = await import(
  `${R}/seed/materials/matter/contentStore.js`
);
const { withIAmAct } = await import(`${R}/seed/sprout.js`);
const { I } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { factFind, factFindOne, factCount } = await import(`${R}/seed/present/word/_factStoreTest.mjs`);
const pollFor = async (fn, pred, t = 12000, e = 250) => {
  const t0 = Date.now();
  while (Date.now() - t0 < t) {
    const v = await fn();
    if (pred(v)) return v;
    await new Promise((r) => setTimeout(r, e));
  }
  return await fn();
};
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
console.log(
  `\n  verify-matterword-dispatch (a do-op whose body is MATTER runs through runMatterWord)\n`,
);

// A `js` matter word: source that defines `run(params)`, run by the js driver. It DOUBLES params.x and
// authors its own fact params — exactly what a native word does (compute → result + _factParams).
const BLOB = `function run(p){ var x = (p && typeof p.x === "number") ? p.x : 0; return { computed: x * 2, _factParams: { computed: x * 2 } }; }`;

try {
  const cherub = await pollFor(
    () => findByName("being", "cherub", "0"),
    (v) => !!v,
  );
  if (!cherub) {
    console.log("  FATAL: genesis failed");
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 1200));

  // (0) store the blob in CAS → content hash
  const ref = await putContent(BLOB, {
    mimeType: "application/javascript",
    name: "double.js",
  });
  const hash = ref?.hash || ref;
  hash
    ? ok(`stored the matter blob in CAS (hash ${String(hash).slice(0, 10)}…)`)
    : bad(`CAS put`, ref);

  // (1) bind a do-op whose BODY is matter — NO do.ref handler, just matter:{hash,type}
  await bindWord("matterword-double", {
    ownerExtension: "seed",
    kind: "op",
    matter: { hash: String(hash), type: "js", entry: "run" },
    targets: ["being"],
    factAction: "matterword-double",
  });
  await new Promise((r) => setTimeout(r, 500));

  // (2) it is absent from the operations Map (fold-only) AND resolveDoOpFromFold surfaces the matter body
  !getOperation("matterword-double")
    ? ok(`"matterword-double" is absent from the operations Map (fold-only)`)
    : bad(`should be Map-absent`, "found in Map");
  const spec = resolveDoOpFromFold("matterword-double");
  spec &&
  spec.matter &&
  spec.matter.hash === String(hash) &&
  spec.matter.type === "js" &&
  !spec.handler
    ? ok(
        `resolveDoOpFromFold surfaces the matter body {hash,type:js} and NO host handler`,
      )
    : bad(`matter body surfaced`, {
        matter: spec?.matter,
        hasHandler: !!spec?.handler,
      });

  // (3) doVerb it: do.js sees op.matter, routes to runMatterWord, the js driver runs the blob over params
  const iId = String(I);
  const targetId = String(cherub.id ?? cherub._id);
  let result;
  await withIAmAct("run the matter word", async (moment) => {
    result = await doVerb(
      targetId,
      "matterword-double",
      { x: 21 },
      {
        moment,
        identity: { name: "i-am", beingId: iId, nameId: iId },
        currentHistory: "0",
      },
    );
  });
  result && result.computed === 42
    ? ok(
        `the matter blob RAN through runMatterWord (computed 21*2=42, no host handler exists)`,
      )
    : bad(`matter word executed`, result);

  // (4) it laid its fact through the normal do auto-Fact path (params from the word's _factParams)
  const f = await pollFor(
    () => factFindOne({ verb: "do", act: "matterword-double" }),
    (v) => !!v,
  );
  f && f.params && f.params.computed === 42
    ? ok(
        `the native word laid its do:matterword-double fact (params.computed=42, the word authored it)`,
      )
    : bad(
        `fact laid with authored params`,
        f ? { params: f.params } : "no fact",
      );

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
