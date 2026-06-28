#!/usr/bin/env node
// verify-kill-word . be:kill is authored by a .word (kill.word); the BE dispatcher stamps the one
// be:kill fact from the word's factParams (rung-3 verb-op #2 — a pure fact-lay). The kill AUTHORITY
// is be.js's verb-level authorize() (NOT in the word). Proves: (1) cherub:kill folds as ableword +
// resolveAbleWord returns IR (the word is the live path); (2) be:kill via beVerb closes a being
// (applyKill folds qualities.dead); (3) THE PROOF — the emitted fact carries verb:"be" act:"kill"
// of:{kind:"being"}, params.byActor === the caller, result.closed (the word's sentinel) — the WORD
// authored the params, the dispatcher stamped; (4) gate-equivalence: a missing target being →
// BEING_NOT_FOUND (an authorized caller passes authorize() first, so the .word's target-exists gate
// is what refuses), no fact. story_*/getStoryDomain. Twin of verify-truename-word.
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const DB = path.join(os.tmpdir(), "story_deathword-" + process.pid);
process.env.PORT = "3837";
process.env.TREEOS_STORE_BASE = DB;
fs.rmSync(DB, { recursive: true, force: true });
process.env.JWT_SECRET = process.env.JWT_SECRET || "deathword-0123456789";
process.env.STORY_KEY_DIR = path.join(
  os.tmpdir(),
  "deathword-keys-" + process.pid,
);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
// (scratch file store fresh-wiped above; no DB to drop)
await import(`${R}/begin.js`);
const { findByName, loadProjection } = await import(
  `${R}/seed/materials/projections.js`
);
const { withIAmAct } = await import(`${R}/seed/sprout.js`);
const { beVerb } = await import(`${R}/seed/ibp/verbs/be.js`);
const { birthBeing } = await import(
  `${R}/seed/materials/being/identity/birth.js`
);
const { I } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { getStoryDomain } = await import(`${R}/seed/ibp/address.js`);
const { getWordSync } = await import(`${R}/seed/present/word/wordStore.js`);
const { resolveAbleWord } = await import(
  `${R}/seed/present/word/ableWordRegistry.js`
);
const { factFind, factFindOne, factCount } = await import(`${R}/seed/present/word/_factStoreTest.mjs`);
const { IBP_ERR } = await import(`${R}/seed/ibp/protocol.js`);
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
  `\n  verify-kill-word (be:kill authored by a .word; the dispatcher stamps from factParams)\n`,
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
  const w = getWordSync("cherub:kill");
  const ir = resolveAbleWord("cherub", "kill", "0");
  w?.kind === "ableword" && !!ir
    ? ok(
        `cherub:kill folds as kind:"ableword" + resolveAbleWord returns its IR (the word is the live path)`,
      )
    : bad(`kill word folded`, { kind: w?.kind, hasIR: !!ir });

  // (2) birth a being to death
  let beingId = null;
  await withIAmAct("birth dyingbeing", async (ctx) => {
    const r = await birthBeing({
      spec: {
        name: "dyingbeing",
        parentBeingId: cherub.id,
        homeId: cherub.state.homeSpace,
        cognition: "scripted",
        defaultAble: "global",
      },
      identity: I,
      moment: ctx,
      branch: "0",
    });
    beingId = r.beingId;
  });
  const before = await pollFor(
    () => loadProjection("being", beingId, "0"),
    (s) => !!s?.state,
  );
  before?.state && !before.state.qualities?.dead
    ? ok(`birthed @dyingbeing, alive (no qualities.dead yet)`)
    : bad(`birth alive`, before?.state?.qualities?.dead);

  // (3) be:kill via beVerb — the .word runs, the dispatcher stamps, applyKill folds
  await withIAmAct("be:kill", async (ctx) => {
    await beVerb(
      "kill",
      {},
      {
        address: `${story}/.@dyingbeing`,
        addressKind: "stance",
        identity: { beingId: I, name: I },
        moment: ctx,
        currentHistory: "0",
      },
    );
  });
  const after = await pollFor(
    () => loadProjection("being", beingId, "0"),
    (s) => !!s?.state?.qualities?.dead,
  );
  after?.state?.qualities?.dead
    ? ok(
        `be:kill folded qualities.dead (applyKill ran — the being is closed; the FACT's existence IS the cease, no clock)`,
      )
    : bad(`kill folded`, after?.state?.qualities?.dead);

  // (4) THE PROOF: the emitted be:kill fact carries the WORD's factParams (byActor) + sentinel
  const f = await pollFor(
    () =>
      factFindOne({
        verb: "be",
        act: "kill",
        "of.id": String(beingId),
      }),
    (v) => !!v,
  );
  f &&
  f.params?.byActor === String(I) &&
  f.of?.kind === "being" &&
  f.result?.closed === true
    ? ok(
        `be:kill fact: params.byActor === caller, of:{kind:"being"}, result.closed (the WORD authored the params; the dispatcher stamped)`,
      )
    : bad(`the fact's authored params`, {
        params: f?.params,
        of: f?.of,
        resultClosed: f?.result?.closed,
      });

  // (5) gate-equivalence: a missing target being → BEING_NOT_FOUND (authorize() short-circuits for
  //     I, so the .word's target-exists gate is what refuses), no fact.
  let threw = false,
    code = null;
  await withIAmAct("be:kill a ghost", async (ctx) => {
    try {
      await beVerb(
        "kill",
        {},
        {
          address: `${story}/.@ghostbeing404`,
          addressKind: "stance",
          identity: { beingId: I, name: I },
          moment: ctx,
          currentHistory: "0",
        },
      );
    } catch (e) {
      threw = true;
      code = e?.code || null;
    }
  });
  const ghostFact = factFindOne({
    verb: "be",
    act: "kill",
    "of.id": "ghostbeing404",
  });
  threw && code === IBP_ERR.BEING_NOT_FOUND && !ghostFact
    ? ok(
        `gate: missing target being → ${IBP_ERR.BEING_NOT_FOUND}, no fact (the .word If-no-targetId gate, be.js-equivalent)`,
      )
    : bad(`being-not-found gate`, {
        threw,
        code,
        want: IBP_ERR.BEING_NOT_FOUND,
        fact: !!ghostFact,
      });

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
