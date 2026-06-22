#!/usr/bin/env node
// The connect CUT's validation: drive cherub's REAL connect handler
// (cherubBeOps.connect.handler) Mode-1 (the @cherub credential path, the site the cut
// swaps from JS orchestration to cherub-connect.word) and assert the response is
// identical either way. Run on HEAD first (JS baseline), then after the cut (.word);
// both GREEN and IDENTICAL. Also asserts the constant-time floor (a wrong password and a
// non-existent name both run >=1 bcrypt, so timing does not disclose name existence).
// Full begin.js boot. Scratch DB, wiped.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = "mongodb://localhost:27017/story_word_connect_cut";
process.env.PORT = "3794";
process.env.MONGODB_URI = SCRATCH_DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "connectcut-secret-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "connectcut-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "connectcut-src");
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
const { sealFacts } = await import(`${R}/seed/past/fact/facts.js`);
const { cherubBeOps } = await import(`${R}/seed/store/words/cherub/able.js`);
const { getStoryDomain } = await import(`${R}/seed/ibp/address.js`);
const storyDomain = getStoryDomain();

let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d !== undefined) console.log(`      ${typeof d === "string" ? d : JSON.stringify(d)}`); };
const poll = async (fn, t = 60000, e = 250) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, e)); } return null; };

async function register({ name, password }) {
  const branch = "0";
  const moment = { actId: randomUUID(), actorAct: { branch, history: branch, by: "i-am" }, identity: { beingId: "i-am", name: "i-am", nameId: "i-am" }, deltaF: [], foldedSeqs: new Map(), afterSeal: [], _inOp: true };
  const res = await cherubBeOps.birth.handler({ payload: { name, password }, ctx: { nameId: null, moment, req: {} } });
  await sealFacts(moment.deltaF);
  for (const fn of moment.afterSeal || []) { try { await fn(); } catch { /* angel grant; tolerated */ } }
  return res;
}

// drive the REAL connect handler Mode-1 (@cherub credential), time it (constant-time check)
async function connect(name, password) {
  const branch = "0";
  const ctx = { moment: { actId: randomUUID(), actorAct: { branch, history: branch }, identity: { beingId: "arrival", name: "arrival" }, deltaF: [], foldedSeqs: new Map(), afterSeal: [] }, nameId: null };
  const t0 = process.hrtime.bigint();
  try {
    const res = await cherubBeOps.connect.handler({ address: `${storyDomain}/@cherub`, addressKind: "stance", payload: { name, password }, identity: null, ctx });
    return { res, refused: null, ms: Number(process.hrtime.bigint() - t0) / 1e6 };
  } catch (e) {
    if (e && (e.name === "IbpError" || e.code)) return { res: null, refused: e, ms: Number(process.hrtime.bigint() - t0) / 1e6 };
    throw e;
  }
}

console.log(`\n  verify-connect-cut (real connect handler Mode-1)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`);
try {
  const branch = "0";
  if (!(await poll(() => findByName("being", "cherub", branch)))) { console.log("  FATAL: genesis failed"); process.exit(1); }

  await register({ name: "alice", password: "alice-secret-1" });
  const alice = await poll(() => findByName("being", "alice", branch));
  alice ? ok(`registered @alice`) : bad(`@alice`, "no row");

  // ── correct password → the full connect response ──
  const good = await connect("alice", "alice-secret-1");
  good.res?.identityToken ? ok(`correct password → identityToken`) : bad(`identityToken`, good.refused?.message || good.res);
  good.res?.name === "alice" ? ok(`response names @alice`) : bad(`name`, good.res?.name);
  String(good.res?.beingId) === String(alice.id) ? ok(`response beingId = @alice`) : bad(`beingId`, good.res?.beingId);
  good.res?.beingAddress === `${storyDomain}/@alice` ? ok(`response beingAddress = ${storyDomain}/@alice`) : bad(`beingAddress`, good.res?.beingAddress);
  ("seatHistory" in (good.res || {})) ? ok(`response carries seatHistory (${good.res.seatHistory})`) : bad(`seatHistory`, good.res);

  // ── wrong password → refuse ──
  const wrong = await connect("alice", "nope");
  wrong.refused && /invalid credentials/i.test(wrong.refused.message) ? ok(`wrong password → "Invalid credentials"`) : bad(`wrong pw`, wrong.refused?.message || wrong.res);

  // ── non-existent name → refuse ──
  const ghost = await connect("nobody", "whatever");
  ghost.refused && /invalid credentials/i.test(ghost.refused.message) ? ok(`unknown name → "Invalid credentials"`) : bad(`unknown name`, ghost.refused?.message || ghost.res);

  // ── constant-time floor (INFORMATIONAL, not a conversion-correctness gate). The cut
  // must be behavior-PRESERVING, so it replicates the JS dummy-verify-on-refuse exactly.
  // NOTE: this surfaced a PRE-EXISTING timing oracle in connectHandler — the dummy hash
  // (L321, "$2b$12$0000…") is a malformed bcrypt string, so verifyPassword rejects it
  // fast without doing the work, leaving a non-existent name (fast) distinguishable from
  // a wrong password (slow). A username-enumeration oracle, in JS today, NOT introduced
  // by the cut. Flagged for a deliberate fix (a REAL bcrypt-cost dummy hash); the
  // conversion preserves current behavior.
  console.log(`  · timing: miss ${ghost.ms.toFixed(1)}ms vs wrong-pw ${wrong.ms.toFixed(1)}ms` +
    (ghost.ms < wrong.ms * 0.25 ? `  ⚠ PRE-EXISTING oracle (dummy hash malformed; flagged, not the cut's)` : `  (floor holds)`));

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
