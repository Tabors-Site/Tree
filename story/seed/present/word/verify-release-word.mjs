#!/usr/bin/env node
// verify-release-word . be:release is authored by a .word (release.word) for its FACT; the SESSION
// effects (lockSigning + seatHistory) stay in the JS handler — the FIRST verb-op with a fact-vs-
// session split. Proves: (1) cherub:release folds as ableword + resolveAbleWord returns IR (the word
// is the live path); (2) be:release via beVerb returns released + seatHistory (the handler's session
// effect ran — the .word can't author it); (3) THE PROOF — the emitted fact carries verb:"be"
// act:"release" of:{kind:"being"}, params.byActor === the caller, result.released (the word's
// sentinel) — the WORD authored the fact params, the dispatcher stamped. story_*/getStoryDomain.
// Uses I as the self-releasing caller (authorize short-circuits; lockSigning(i-am) is harmless —
// I signs with the story key, not the latch).
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const DB = path.join(os.tmpdir(), "story_releaseword-" + process.pid);
process.env.PORT = "3838";
process.env.TREEOS_STORE_BASE = DB;
fs.rmSync(DB, { recursive: true, force: true });
delete process.env.MONGODB_URI;
process.env.JWT_SECRET = process.env.JWT_SECRET || "releaseword-0123456789";
process.env.STORY_KEY_DIR = path.join(
  os.tmpdir(),
  "releaseword-keys-" + process.pid,
);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
// (scratch file store fresh-wiped above; no DB to drop)
await import(`${R}/begin.js`);
const { findByName } = await import(`${R}/seed/materials/projections.js`);
const { withIAmAct } = await import(`${R}/seed/sprout.js`);
const { beVerb } = await import(`${R}/seed/ibp/verbs/be.js`);
const { I } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { getStoryDomain } = await import(`${R}/seed/ibp/address.js`);
const { getWordSync } = await import(`${R}/seed/present/word/wordStore.js`);
const { resolveAbleWord } = await import(
  `${R}/seed/present/word/ableWordRegistry.js`
);
const { factFind, factFindOne, factCount } = await import(
  `${R}/seed/present/word/_factStoreTest.mjs`
);
const pollFor = async (fn, pred, t = 16000, e = 250) => {
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
  `\n  verify-release-word (be:release: the word authors the fact, the handler keeps the session effects)\n`,
);
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
  const story = getStoryDomain();

  // (1) the word is the live path
  const w = getWordSync("cherub:release");
  const ir = resolveAbleWord("cherub", "release", "0");
  w?.kind === "ableword" && !!ir
    ? ok(
        `cherub:release folds as kind:"ableword" + resolveAbleWord returns its IR (the word is the live path)`,
      )
    : bad(`release word folded`, { kind: w?.kind, hasIR: !!ir });

  // (2) be:release via beVerb — the .word lays the fact, the handler returns the session effect
  let res = null;
  await withIAmAct("be:release", async (ctx) => {
    res = await beVerb(
      "release",
      {},
      {
        address: `${story}/.@cherub`,
        addressKind: "stance",
        identity: { beingId: I, name: I },
        moment: ctx,
        currentHistory: "0",
      },
    );
  });
  res?.released === true && res?.seatHistory != null
    ? ok(
        `beVerb returns released:true + seatHistory="${res.seatHistory}" (the HOST session effect the word can't author)`,
      )
    : bad(`release result`, {
        released: res?.released,
        seatHistory: res?.seatHistory,
      });

  // (3) THE PROOF: the emitted be:release fact carries the WORD's factParams + sentinel
  const f = await pollFor(
    () => factFindOne({ verb: "be", act: "release", "of.id": String(I) }),
    (v) => !!v,
  );
  f &&
  f.params?.byActor === String(I) &&
  f.of?.kind === "being" &&
  f.result?.released === true
    ? ok(
        `be:release fact: params.byActor === caller, of:{kind:"being"}, result.released (the WORD authored the params; the dispatcher stamped)`,
      )
    : bad(`the fact's authored params`, {
        params: f?.params,
        of: f?.of,
        resultReleased: f?.result?.released,
      });

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
