#!/usr/bin/env node
// cherub-connect.word FLOW 3 (inherit-connect / father-admit, connectHandler Mode-3),
// LIVE through the bridge with ZERO stubs. Proves: ancestor inhabit, local father-admit,
// LEGIT cross-story father (proven name + verified sig), the SECURITY property (a cross
// caller presenting the victim father's beingId but the WRONG name is REFUSED — the
// vessel-takeover attack the JS guards, which the .word's old conds would have allowed),
// and a non-relative refusal. Full begin.js boot. Scratch DB, wiped.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = "mongodb://localhost:27017/story_word_connect_flow3";
process.env.PORT = "3792";
process.env.MONGODB_URI = SCRATCH_DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "connectflow3-secret-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "connectflow3-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "connectflow3-src");
fs.rmSync(SRC, { recursive: true, force: true });
fs.mkdirSync(SRC, { recursive: true });
fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;

{
  const mongoose = (await import(`${R}/node_modules/mongoose/index.js`)).default;
  const conn = await mongoose.createConnection(SCRATCH_DB).asPromise();
  await conn.dropDatabase();
  await conn.close();
}

await import(`${R}/begin.js`);

const { findByName } = await import(`${R}/seed/materials/projections.js`);
const { withIAmAct } = await import(`${R}/seed/sprout.js`);
const { birthBeing } = await import(`${R}/seed/materials/being/identity/birth.js`);
const { I_AM } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { getStoryDomain } = await import(`${R}/seed/ibp/address.js`);
const { resolveRoleWord, runRoleWord } = await import(`${R}/seed/present/word/roleWordRegistry.js`);
const { connectHostEnv, selectConnectFlow } = await import(`${R}/seed/store/words/cherub/connectHost.js`);
const localDomain = getStoryDomain();

let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d !== undefined) console.log(`      ${typeof d === "string" ? d : JSON.stringify(d)}`); };
const poll = async (fn, t = 60000, e = 250) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, e)); } return null; };

const cherub = await poll(() => findByName("being", "cherub", "0"));
const birth = async (name, extraSpec = {}) => {
  let bid = null;
  await withIAmAct(`birth ${name}`, async (ctx) => {
    const b = await birthBeing({ spec: { name, parentBeingId: cherub.id, homeId: cherub.state?.homeSpace, cognition: "scripted", defaultRole: "global", ...extraSpec }, identity: I_AM, moment: ctx, branch: "0" });
    bid = b.beingId;
  });
  return bid;
};

// drive flow 3 (inherit) through the bridge
async function inherit(targetName, caller) {
  const branch = "0";
  const moment = { actId: randomUUID(), actorAct: { branch }, identity: { beingId: caller?.beingId || "x" }, deltaF: [], foldedSeqs: new Map(), afterSeal: [] };
  const flow = selectConnectFlow(resolveRoleWord("cherub", "connect"), "inherit");
  try {
    const { result, deltaF } = await runRoleWord([flow], { moment, branch, trigger: { address: `${localDomain}/@${targetName}`, caller }, env: { host: connectHostEnv() } });
    return { result, deltaF, refused: null };
  } catch (e) { if (e && e.__wordRefusal) return { result: null, deltaF: moment.deltaF, refused: e }; throw e; }
}

console.log(`\n  verify-connect-flow3 (inherit / father-admit, ZERO stubs, + the security property)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`);
try {
  if (!cherub) { console.log("  FATAL: genesis failed"); process.exit(1); }
  const inheritFlow = selectConnectFlow(resolveRoleWord("cherub", "connect"), "inherit");
  inheritFlow ? ok(`selectConnectFlow("inherit") finds flow 3`) : bad(`flow 3 selection`, "null");

  const daddy = await birth("daddy");
  const descendant = await birth("childbeing", { parentBeingId: daddy });
  const localVessel = await birth("localvessel", { father: { story: localDomain, beingId: daddy } });
  const FOREIGN = "did:web:foreign.example.com";
  const crossVessel = await birth("crossvessel", { father: { story: FOREIGN, beingId: "F-foreign-being", nameId: "z6MkVictimName" } });
  console.log(`  daddy=${String(daddy).slice(0,10)} descendant/localvessel/crossvessel born\n`);

  // ── 1. ANCESTOR path: daddy inhabits a being it birthed ──
  const anc = await inherit("childbeing", { beingId: daddy });
  anc.result?.inherited === true && !anc.result?.asFather && anc.result?.token
    ? ok(`ancestor: daddy inherits @childbeing → inherited:true, asFather:false, token`) : bad(`ancestor`, anc.refused?.message || anc.result);

  // ── 2. LOCAL FATHER: daddy is the local father of the vessel (beingId is the credential) ──
  const lf = await inherit("localvessel", { beingId: daddy, story: localDomain });
  lf.result?.asFather === true && lf.result?.token
    ? ok(`local father: daddy admits @localvessel → asFather:true, token`) : bad(`local father`, lf.refused?.message || lf.result);

  // ── 3. LEGIT CROSS-STORY FATHER: proven NAME + verified sig ──
  const xf = await inherit("crossvessel", { beingId: "F-foreign-being", story: FOREIGN, nameId: "z6MkVictimName", beingSigVerified: true });
  xf.result?.asFather === true
    ? ok(`cross father (proven name + verified sig) → asFather:true`) : bad(`cross father legit`, xf.refused?.message || xf.result);

  // ── 4. THE SECURITY PROPERTY: a cross caller with the victim's beingId but the WRONG
  // name (and no matching sig) must be REFUSED. The OLD .word local cond would have let
  // this in on the beingId match; fatherMatch closes it (cross path needs nameId+sig). ──
  const attack = await inherit("crossvessel", { beingId: "F-foreign-being", story: FOREIGN, nameId: "z6MkAttackerName", beingSigVerified: true });
  attack.refused
    ? ok(`SECURITY: cross caller with victim's beingId but wrong name → REFUSED (no beingId-takeover)`) : bad(`SECURITY HOLE`, `attacker got in: ${JSON.stringify(attack.result)}`);

  // ── 5. NEGATIVE: a stranger (neither ancestor nor father) → refuse ──
  const stranger = await inherit("localvessel", { beingId: "nobody-unrelated", story: localDomain });
  stranger.refused
    ? ok(`stranger (not ancestor, not father) → refused`) : bad(`stranger refused`, stranger.result);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
