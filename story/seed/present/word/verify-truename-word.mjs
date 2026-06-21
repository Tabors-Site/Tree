#!/usr/bin/env node
// verify-truename-word . be:truename is now authored by a .word (truename.word); the BE dispatcher
// stamps the one fact from the word's factParams (rung-3 worked example: a verb-op IS a Word). Proves:
//  (1) cherub:truename folds as kind:"roleword" + resolveRoleWord returns its IR (the word is the
//      live path, not the inert JS summary);
//  (2) a being births with trueName = i-am;
//  (3) be:truename via beVerb re-points its trueName + the _id survives (reel intact);
//  (4) THE PROOF — the emitted fact carries verb:"be", act:"truename", of:{kind:"being"}, with
//      params.trueName === the RESOLVED nameId AND result.trued === true (the word's sentinel) — i.e.
//      the .word authored the fact params and the dispatcher stamped (not the old writeBeFact);
//  (5) a refusal (a non-resolving Name) lays NO fact.
// Twin of verify-be-ops-fold; story_*/getStoryDomain (NOT the dead reality_*/getRealityDomain of
// the stale .test/e2e/truename-e2e.mjs).
import fs from "fs"; import os from "os"; import path from "path"; import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const DB = "mongodb://localhost:27017/story_truenameword";
process.env.PORT = "3836"; process.env.MONGODB_URI = DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "truenameword-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "truenameword-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
{ const mongoose = (await import(`${R}/node_modules/mongoose/index.js`)).default; const conn = await mongoose.createConnection(DB).asPromise(); await conn.dropDatabase(); await conn.close(); }
await import(`${R}/begin.js`);
const { findByName, loadProjection } = await import(`${R}/seed/materials/projections.js`);
const { withIAmAct } = await import(`${R}/seed/sprout.js`);
const { nameVerb } = await import(`${R}/seed/ibp/verbs/name.js`);
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
console.log(`\n  verify-truename-word (be:truename authored by a .word; the dispatcher stamps from factParams)\n`);
try {
  const cherub = await pollFor(() => findByName("being", "cherub", "0"), (v) => !!v);
  if (!cherub) { console.log("  FATAL: genesis failed"); process.exit(1); }
  await new Promise((r) => setTimeout(r, 1200));
  const story = getStoryDomain();

  // (1) the word is the live path
  const w = getWordSync("cherub:truename");
  const ir = resolveRoleWord("cherub", "truename", "0");
  (w?.kind === "roleword" && !!ir)
    ? ok(`cherub:truename folds as kind:"roleword" + resolveRoleWord returns its IR (the word is the live path)`)
    : bad(`truename word folded`, { kind: w?.kind, hasIR: !!ir });

  // (2) declare a Name + birth a being (trueName = i-am)
  let nameId = null;
  await withIAmAct("declare a name", async (ctx) => {
    const r = await nameVerb("declare", { soulType: "scripted" }, { identity: I_AM, moment: ctx, currentHistory: "0" });
    nameId = r.nameId;
  });
  await pollFor(() => loadProjection("name", nameId, "0"), (s) => !!s?.state?.privateKeyEnc);
  let beingId = null;
  await withIAmAct("birth tnbeing", async (ctx) => {
    const r = await birthBeing({ spec: { name: "tnbeing", parentBeingId: cherub.id, homeId: cherub.state.homeSpace, cognition: "scripted", defaultRole: "global" }, identity: I_AM, moment: ctx, branch: "0" });
    beingId = r.beingId;
  });
  const before = await pollFor(() => loadProjection("being", beingId, "0"), (s) => !!s?.state?.trueName);
  (before?.state?.trueName === I_AM)
    ? ok(`birthed @tnbeing with trueName = i-am (the mother's)`)
    : bad(`birth trueName`, before?.state?.trueName);

  // (3) be:truename via beVerb — the .word runs, the dispatcher stamps
  await withIAmAct("be:truename", async (ctx) => {
    await beVerb("truename", { trueName: nameId }, {
      address: `${story}/.@tnbeing`, addressKind: "stance",
      identity: { beingId: I_AM, name: I_AM }, moment: ctx, currentHistory: "0",
    });
  });
  const after = await pollFor(() => loadProjection("being", beingId, "0"), (s) => s?.state?.trueName === nameId);
  (after?.state?.trueName === nameId)
    ? ok(`be:truename folded @tnbeing.trueName to the declared Name (applyTrueName ran)`)
    : bad(`trueName folded`, { got: after?.state?.trueName, want: nameId });
  (after?.id === beingId)
    ? ok(`being _id UNCHANGED by the transfer (reel survives)`)
    : bad(`_id stable`, { got: after?.id, want: beingId });

  // (4) THE PROOF: the emitted be:truename fact carries the WORD's factParams + sentinel
  const f = await pollFor(() => Fact.findOne({ verb: "be", act: "truename", "of.id": String(beingId) }).lean(), (v) => !!v);
  (f && f.params?.trueName === nameId && f.of?.kind === "being" && f.result?.trued === true)
    ? ok(`be:truename fact: params.trueName === resolved nameId, of:{kind:"being"}, result.trued (the WORD authored the params; the dispatcher stamped)`)
    : bad(`the fact's authored params`, { params: f?.params, of: f?.of, resultTrued: f?.result?.trued, wantName: nameId });

  // (6) GATE-EQUIVALENCE: be.js's inline validation is DELETED, so truename.word's gates are the
  // sole gate. Each must refuse with be.js's EXACT IbpError code (a different code would be a silent
  // regression). Three distinct codes the old inline raised: INVALID_INPUT, BEING_NOT_FOUND, FORBIDDEN.
  const expectRefusal = async (label, payload, addr) => {
    let threw = false, code = null;
    await withIAmAct(label, async (ctx) => {
      try {
        await beVerb("truename", payload, {
          address: addr, addressKind: "stance",
          identity: { beingId: I_AM, name: I_AM }, moment: ctx, currentHistory: "0",
        });
      } catch (e) { threw = true; code = e?.code || null; }
    });
    return { threw, code };
  };
  const bogus = "z6Mkbogus000000000000000000000000000000000000";
  const r1 = await expectRefusal("truename to a bogus name", { trueName: bogus }, `${story}/.@tnbeing`);
  const f1 = await Fact.findOne({ verb: "be", act: "truename", "params.trueName": bogus }).lean();
  (r1.threw && r1.code === IBP_ERR.INVALID_INPUT && !f1)
    ? ok(`gate: non-resolving Name → ${IBP_ERR.INVALID_INPUT}, no fact (the .word If-no-nameId gate, be.js-equivalent)`)
    : bad(`bogus-name gate`, { ...r1, want: IBP_ERR.INVALID_INPUT, fact: !!f1 });

  const r2 = await expectRefusal("truename to a ghost being", { trueName: nameId }, `${story}/.@ghostbeing404`);
  (r2.threw && r2.code === IBP_ERR.BEING_NOT_FOUND)
    ? ok(`gate: missing target being → ${IBP_ERR.BEING_NOT_FOUND} (the .word If-no-targetId gate, be.js-equivalent)`)
    : bad(`being-not-found gate`, { ...r2, want: IBP_ERR.BEING_NOT_FOUND });

  // banished: declare a Name, banish it, truename to it → FORBIDDEN
  let banishedName = null;
  await withIAmAct("declare banishable name", async (ctx) => {
    const r = await nameVerb("declare", { soulType: "scripted" }, { identity: I_AM, moment: ctx, currentHistory: "0" });
    banishedName = r.nameId;
  });
  await pollFor(() => loadProjection("name", banishedName, "0"), (s) => !!s?.state?.privateKeyEnc);
  await withIAmAct("banish it", async (ctx) => {
    await nameVerb("banish", {}, { identity: I_AM, address: `${banishedName}@${story}`, moment: ctx, currentHistory: "0" });
  });
  await pollFor(() => loadProjection("name", banishedName, "0"), (s) => !!s?.state?.closedAt);
  const r3 = await expectRefusal("truename to a banished name", { trueName: banishedName }, `${story}/.@tnbeing`);
  const f3 = await Fact.findOne({ verb: "be", act: "truename", "params.trueName": banishedName }).lean();
  (r3.threw && r3.code === IBP_ERR.FORBIDDEN && !f3)
    ? ok(`gate: banished Name → ${IBP_ERR.FORBIDDEN}, no fact (the .word If-banished gate, be.js-equivalent)`)
    : bad(`banished gate`, { ...r3, want: IBP_ERR.FORBIDDEN, fact: !!f3 });

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) { console.log(`\n  ! crashed: ${err.stack || err.message}`); process.exit(3); }
