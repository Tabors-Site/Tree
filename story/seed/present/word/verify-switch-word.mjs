#!/usr/bin/env node
// verify-switch-word . be:switch is authored by a .word (switch.word); the BE dispatcher stamps the
// CROSS-HISTORY be:switch fact (on result.toHistory) from the word's factParams {fromHistory,toHistory}.
// No authorize() (changing your OWN session's history needs no role gate). The SESSION seat
// (socket.currentHistory) is the transport's job (stamp-then-seat) — the word/handler only hand back
// seatHistory. The handler's six checks simplified to FOUR gates (no-caller, no-history,
// destination-missing[found+deleted], destination-paused, being-lives-on[born+alive]). Proves: (1)
// cherub:switch folds as roleword + IR; (2) be:switch via beVerb stamps the fact with params
// {fromHistory,toHistory} + result.switched + seatHistory (the .word authored it; dispatcher stamped on
// toHistory); (3) gate: no history → INVALID_INPUT; (4) gate: missing destination history →
// INVALID_INPUT (the destination-missing floor read), no fact. A birthed being self-switches to main —
// exercises the dispatcher + the cross-history emit path. story_*/getStoryDomain.
import fs from "fs"; import os from "os"; import path from "path"; import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const DB = "mongodb://localhost:27017/story_switchword";
process.env.PORT = "3839"; process.env.MONGODB_URI = DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "switchword-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "switchword-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
{ const mongoose = (await import(`${R}/node_modules/mongoose/index.js`)).default; const conn = await mongoose.createConnection(DB).asPromise(); await conn.dropDatabase(); await conn.close(); }
await import(`${R}/begin.js`);
const { findByName } = await import(`${R}/seed/materials/projections.js`);
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
const optsFor = (story, beingId, beingName, ctx) => ({ address: `${story}/.@${beingName}`, addressKind: "stance", identity: { beingId, name: beingName }, moment: ctx, currentHistory: "0" });
console.log(`\n  verify-switch-word (be:switch authored by a .word; cross-history fact; no authorize)\n`);
try {
  const cherub = await pollFor(() => findByName("being", "cherub", "0"), (v) => !!v);
  if (!cherub) { console.log("  FATAL: genesis failed"); process.exit(1); }
  await new Promise((r) => setTimeout(r, 1200));
  const story = getStoryDomain();

  // (1) the word is the live path
  const w = getWordSync("cherub:switch");
  const ir = resolveRoleWord("cherub", "switch", "0");
  (w?.kind === "roleword" && !!ir)
    ? ok(`cherub:switch folds as kind:"roleword" + resolveRoleWord returns its IR (the word is the live path)`)
    : bad(`switch word folded`, { kind: w?.kind, hasIR: !!ir });

  // birth a being to switch (guaranteed state.name)
  let beingId = null, beingName = null;
  await withIAmAct("birth switcher", async (ctx) => {
    const r = await birthBeing({ spec: { name: "switcher", parentBeingId: cherub.id, homeId: cherub.state.homeSpace, cognition: "scripted", defaultRole: "global" }, identity: I_AM, moment: ctx, branch: "0" });
    beingId = r.beingId; beingName = r.name;
  });
  await pollFor(() => findByName("being", "switcher", "0"), (v) => !!v?.state?.name);

  // (2) be:switch via beVerb (self-switch to main) — the .word lays the fact, the dispatcher stamps it
  let res = null;
  await withIAmAct("be:switch", async (ctx) => {
    res = await beVerb("switch", { history: "0" }, optsFor(story, beingId, beingName, ctx));
  });
  (res?.switched === true && res?.seatHistory === "0" && res?.toHistory === "0")
    ? ok(`beVerb returns switched:true + seatHistory="0" + toHistory (the seat inputs the transport reads)`)
    : bad(`switch result`, { switched: res?.switched, seatHistory: res?.seatHistory, toHistory: res?.toHistory });
  const f = await pollFor(() => Fact.findOne({ verb: "be", act: "switch", "of.id": String(beingId) }).lean(), (v) => !!v);
  (f && f.params?.fromHistory === "0" && f.params?.toHistory === "0" && f.of?.kind === "being" && f.result?.switched === true)
    ? ok(`be:switch fact: params {fromHistory,toHistory}, of:{kind:"being"}, result.switched (the WORD authored the params; the dispatcher stamped on toHistory)`)
    : bad(`the fact's authored params`, { params: f?.params, of: f?.of, switched: f?.result?.switched });

  // (3) gate: no history → INVALID_INPUT
  let threw3 = false, code3 = null;
  await withIAmAct("be:switch no-history", async (ctx) => {
    try { await beVerb("switch", {}, optsFor(story, beingId, beingName, ctx)); }
    catch (e) { threw3 = true; code3 = e?.code || null; }
  });
  (threw3 && code3 === IBP_ERR.INVALID_INPUT)
    ? ok(`gate: no history → ${IBP_ERR.INVALID_INPUT} (the .word If-no-history gate)`)
    : bad(`no-history gate`, { threw: threw3, code: code3, want: IBP_ERR.INVALID_INPUT });

  // (4) gate: missing destination history → INVALID_INPUT (destination-missing floor read), no fact
  let threw4 = false, code4 = null;
  await withIAmAct("be:switch ghost-history", async (ctx) => {
    try { await beVerb("switch", { history: "ghost404" }, optsFor(story, beingId, beingName, ctx)); }
    catch (e) { threw4 = true; code4 = e?.code || null; }
  });
  const ghostFact = await Fact.findOne({ verb: "be", act: "switch", "params.toHistory": "ghost404" }).lean();
  (threw4 && code4 === IBP_ERR.INVALID_INPUT && !ghostFact)
    ? ok(`gate: missing destination history → ${IBP_ERR.INVALID_INPUT} (destination-missing floor read), no fact`)
    : bad(`missing-history gate`, { threw: threw4, code: code4, want: IBP_ERR.INVALID_INPUT, fact: !!ghostFact });

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) { console.log(`\n  ! crashed: ${err.stack || err.message}`); process.exit(3); }
