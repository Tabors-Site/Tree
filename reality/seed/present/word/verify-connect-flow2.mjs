#!/usr/bin/env node
// cherub-connect.word FLOW 2 (a signed-in Name reconnecting to a being it OWNS, no
// password), LIVE through the bridge with ZERO stubs. Proves the flow-selection + the
// ownerTrueName host primitive + the `caller` bind: a being whose trueName === the
// connecting Name's id connects ownerlessly (owned:true); a being owned by a DIFFERENT
// name does not. Full begin.js boot. Scratch DB, wiped.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = "mongodb://localhost:27017/reality_word_connect_flow2";
process.env.PORT = "3793";
process.env.MONGODB_URI = SCRATCH_DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "connectflow2-secret-0123456789";
process.env.REALITY_KEY_DIR = path.join(os.tmpdir(), "connectflow2-keys-" + process.pid);
fs.rmSync(process.env.REALITY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "connectflow2-src");
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

const { findByName, loadProjection } = await import(`${R}/seed/materials/projections.js`);
const { sealFacts } = await import(`${R}/seed/past/fact/facts.js`);
const { nameVerb } = await import(`${R}/seed/ibp/verbs/name.js`);
const { cherubBeOps } = await import(`${R}/seed/present/roles/cherub/role.js`);
const { resolveRoleWord, runRoleWord } = await import(`${R}/seed/present/word/roleWordRegistry.js`);
const { connectHostEnv, selectConnectFlow } = await import(`${R}/seed/present/roles/cherub/connectHost.js`);

let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d !== undefined) console.log(`      ${typeof d === "string" ? d : JSON.stringify(d)}`); };
const poll = async (fn, t = 60000, e = 250) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, e)); } return null; };

async function register({ name, password, nameId }) {
  const branch = "0";
  const moment = { actId: randomUUID(), actorAct: { branch, by: nameId || "i-am" }, identity: { beingId: "i-am", name: "i-am", nameId: nameId || "i-am" }, deltaF: [], foldedSeqs: new Map(), afterSeal: [], _inOp: true };
  const res = await cherubBeOps.birth.handler({ payload: { name, password }, ctx: { nameId: nameId || null, moment, req: {} } });
  await sealFacts(moment.deltaF);
  for (const fn of moment.afterSeal || []) { try { await fn(); } catch { /* angel grant; tolerated */ } }
  return res;
}

async function declareName(name, password) {
  const branch = "0";
  const sc = { actId: randomUUID(), actorAct: { branch, by: "i-am" }, identity: { beingId: "i-am", name: "I_AM", nameId: "i-am" }, deltaF: [], foldedSeqs: new Map(), afterSeal: [] };
  const r = await nameVerb("declare", { name, password, soulType: "human" }, { identity: sc.identity, moment: sc, currentBranch: branch });
  await sealFacts(sc.deltaF);
  return r.nameId;
}

// drive flow 2 through the bridge: a signed-in Name (caller) connects to a being it owns
async function connectOwned(name, caller) {
  const branch = "0";
  const moment = { actId: randomUUID(), actorAct: { branch }, identity: { beingId: "arrival", name: "arrival" }, deltaF: [], foldedSeqs: new Map(), afterSeal: [] };
  const flow = selectConnectFlow(resolveRoleWord("cherub", "connect"), "owned");
  const { result } = await runRoleWord([flow], { moment, branch, trigger: { name, caller }, env: { host: connectHostEnv() } });
  return result;
}

console.log(`\n  verify-connect-flow2 (signed-in Name → a being it owns, ZERO stubs)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`);
try {
  const branch = "0";
  if (!(await poll(() => findByName("being", "cherub", branch)))) { console.log("  FATAL: genesis failed"); process.exit(1); }

  // the owned flow is distinct from the credential flow
  const ownedFlow = selectConnectFlow(resolveRoleWord("cherub", "connect"), "owned");
  const credFlow = selectConnectFlow(resolveRoleWord("cherub", "connect"), "credential");
  ownedFlow && credFlow && ownedFlow !== credFlow ? ok(`selectConnectFlow picks the owned flow, distinct from credential`) : bad(`flow selection`, "same/missing");

  // a founder (first being), then a NAME that will own a vessel
  await register({ name: "founder", password: "founderpw1" });
  const ownerNameId = await declareName("tabor", "ownerpw12345");
  const otherNameId = await declareName("mallory", "otherpw12345");
  console.log(`  owner=${String(ownerNameId).slice(0, 12)}… other=${String(otherNameId).slice(0, 12)}…`);

  // a being OWNED by tabor (its trueName = tabor's nameId), birthed through cherub
  await register({ name: "myvessel", password: "vesselpw1234", nameId: String(ownerNameId) });
  const vessel = await poll(() => findByName("being", "myvessel", branch));
  const proj = vessel ? await loadProjection("being", String(vessel.id), branch) : null;
  String(proj?.state?.trueName) === String(ownerNameId)
    ? ok(`@myvessel is owned by tabor (trueName = tabor's nameId)`) : bad(`vessel trueName`, proj?.state?.trueName);

  // ── 1. tabor connects to @myvessel (no password) → owned:true + token + seat ──
  const owned = await connectOwned("myvessel", String(ownerNameId));
  owned?.owned === true ? ok(`tabor connects to @myvessel → owned:true (no password)`) : bad(`owned:true`, owned);
  owned?.token ? ok(`returns a session token`) : bad(`token`, owned);
  ("seat" in (owned || {})) ? ok(`returns seat (${owned.seat})`) : bad(`seat`, owned);

  // ── 2. mallory connects to @myvessel → NOT owned (no result, the flow falls through) ──
  const notOwned = await connectOwned("myvessel", String(otherNameId));
  (!notOwned || notOwned.owned !== true)
    ? ok(`mallory connects to @myvessel → NOT owned (the owned branch never fires)`) : bad(`not owned`, notOwned);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
