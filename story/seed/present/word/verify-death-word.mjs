#!/usr/bin/env node
// verify-death-word . be:death is authored by a .word (death.word); the BE dispatcher stamps the one
// be:death fact from the word's factParams (rung-3 verb-op #2 — a pure fact-lay). The kill AUTHORITY
// is be.js's verb-level authorize() (NOT in the word). Proves: (1) cherub:death folds as roleword +
// resolveRoleWord returns IR (the word is the live path); (2) be:death via beVerb closes a being
// (applyDeath folds qualities.death); (3) THE PROOF — the emitted fact carries verb:"be" act:"death"
// of:{kind:"being"}, params.byActor === the caller, result.closed (the word's sentinel) — the WORD
// authored the params, the dispatcher stamped; (4) gate-equivalence: a missing target being →
// BEING_NOT_FOUND (an authorized caller passes authorize() first, so the .word's target-exists gate
// is what refuses), no fact. story_*/getStoryDomain. Twin of verify-truename-word.
import fs from "fs"; import os from "os"; import path from "path"; import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const DB = "mongodb://localhost:27017/story_deathword";
process.env.PORT = "3837"; process.env.MONGODB_URI = DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "deathword-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "deathword-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
{ const mongoose = (await import(`${R}/node_modules/mongoose/index.js`)).default; const conn = await mongoose.createConnection(DB).asPromise(); await conn.dropDatabase(); await conn.close(); }
await import(`${R}/begin.js`);
const { findByName, loadProjection } = await import(`${R}/seed/materials/projections.js`);
const { withIAmAct } = await import(`${R}/seed/sprout.js`);
const { beVerb } = await import(`${R}/seed/ibp/verbs/be.js`);
const { birthBeing } = await import(`${R}/seed/materials/being/identity/birth.js`);
const { I_AM } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { getStoryDomain } = await import(`${R}/seed/ibp/address.js`);
const { getWordSync } = await import(`${R}/seed/present/word/wordStore.js`);
const { resolveRoleWord } = await import(`${R}/seed/present/word/roleWordRegistry.js`);
const { default: Fact } = await import(`${R}/seed/past/fact/fact.js`);
const { IBP_ERR } = await import(`${R}/seed/ibp/protocol.js`);
const pollFor = async (fn, pred, t = 16000, e = 250) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (pred(v)) return v; await new Promise((r) => setTimeout(r, e)); } return await fn(); };
let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d !== undefined) console.log(`      ${typeof d === "string" ? d : JSON.stringify(d)}`); };
console.log(`\n  verify-death-word (be:death authored by a .word; the dispatcher stamps from factParams)\n`);
try {
  const cherub = await pollFor(() => findByName("being", "cherub", "0"), (v) => !!v);
  if (!cherub) { console.log("  FATAL: genesis failed"); process.exit(1); }
  await new Promise((r) => setTimeout(r, 1200));
  const story = getStoryDomain();

  // (1) the word is the live path
  const w = getWordSync("cherub:death");
  const ir = resolveRoleWord("cherub", "death", "0");
  (w?.kind === "roleword" && !!ir)
    ? ok(`cherub:death folds as kind:"roleword" + resolveRoleWord returns its IR (the word is the live path)`)
    : bad(`death word folded`, { kind: w?.kind, hasIR: !!ir });

  // (2) birth a being to death
  let beingId = null;
  await withIAmAct("birth dyingbeing", async (ctx) => {
    const r = await birthBeing({ spec: { name: "dyingbeing", parentBeingId: cherub.id, homeId: cherub.state.homeSpace, cognition: "scripted", defaultRole: "global" }, identity: I_AM, moment: ctx, branch: "0" });
    beingId = r.beingId;
  });
  const before = await pollFor(() => loadProjection("being", beingId, "0"), (s) => !!s?.state);
  (before?.state && !before.state.qualities?.death?.time)
    ? ok(`birthed @dyingbeing, alive (no qualities.death yet)`)
    : bad(`birth alive`, before?.state?.qualities?.death);

  // (3) be:death via beVerb — the .word runs, the dispatcher stamps, applyDeath folds
  await withIAmAct("be:death", async (ctx) => {
    await beVerb("death", {}, {
      address: `${story}/.@dyingbeing`, addressKind: "stance",
      identity: { beingId: I_AM, name: I_AM }, moment: ctx, currentHistory: "0",
    });
  });
  const after = await pollFor(() => loadProjection("being", beingId, "0"), (s) => !!s?.state?.qualities?.death?.time);
  (after?.state?.qualities?.death?.time)
    ? ok(`be:death folded qualities.death (applyDeath ran — the being is closed)`)
    : bad(`death folded`, after?.state?.qualities?.death);

  // (4) THE PROOF: the emitted be:death fact carries the WORD's factParams (byActor) + sentinel
  const f = await pollFor(() => Fact.findOne({ verb: "be", act: "death", "of.id": String(beingId) }).lean(), (v) => !!v);
  (f && f.params?.byActor === String(I_AM) && f.of?.kind === "being" && f.result?.closed === true)
    ? ok(`be:death fact: params.byActor === caller, of:{kind:"being"}, result.closed (the WORD authored the params; the dispatcher stamped)`)
    : bad(`the fact's authored params`, { params: f?.params, of: f?.of, resultClosed: f?.result?.closed });

  // (5) gate-equivalence: a missing target being → BEING_NOT_FOUND (authorize() short-circuits for
  //     I_AM, so the .word's target-exists gate is what refuses), no fact.
  let threw = false, code = null;
  await withIAmAct("be:death a ghost", async (ctx) => {
    try {
      await beVerb("death", {}, {
        address: `${story}/.@ghostbeing404`, addressKind: "stance",
        identity: { beingId: I_AM, name: I_AM }, moment: ctx, currentHistory: "0",
      });
    } catch (e) { threw = true; code = e?.code || null; }
  });
  const ghostFact = await Fact.findOne({ verb: "be", act: "death", "of.id": "ghostbeing404" }).lean();
  (threw && code === IBP_ERR.BEING_NOT_FOUND && !ghostFact)
    ? ok(`gate: missing target being → ${IBP_ERR.BEING_NOT_FOUND}, no fact (the .word If-no-targetId gate, be.js-equivalent)`)
    : bad(`being-not-found gate`, { threw, code, want: IBP_ERR.BEING_NOT_FOUND, fact: !!ghostFact });

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) { console.log(`\n  ! crashed: ${err.stack || err.message}`); process.exit(3); }
