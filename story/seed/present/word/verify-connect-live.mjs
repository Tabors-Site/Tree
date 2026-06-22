#!/usr/bin/env node
// cherub-connect.word flow 1 (anonymous credential), LIVE through the bridge with ZERO
// stubs. Proves the parser↔evaluator loop holds for a real branching/looping/refusing
// slice: searchByName → foreach candidates → if local → verifyPassword → mark found +
// break → if none refuse, else generateToken/seatHistory/return. The host: escapes hit
// the REAL connect primitives (connectHost.js); the CONTROL strand is the .word.
// Full begin.js boot (real beings + password hashes). Scratch DB, wiped.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = "mongodb://localhost:27017/story_word_connect_live";
process.env.PORT = "3795";
process.env.MONGODB_URI = SCRATCH_DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "connectlive-secret-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "connectlive-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "connectlive-src");
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

await import(`${R}/begin.js`); // full genesis

const { findByName } = await import(`${R}/seed/materials/projections.js`);
const { sealFacts } = await import(`${R}/seed/past/fact/facts.js`);
const { cherubBeOps } = await import(`${R}/seed/store/words/cherub/able.js`);
const { resolveAbleWord, runAbleWord } = await import(`${R}/seed/present/word/ableWordRegistry.js`);
const { connectHostEnv } = await import(`${R}/seed/store/words/cherub/connectHost.js`);
const { decodeToken } = await import(`${R}/seed/materials/being/identity/credentials.js`);

let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d !== undefined) console.log(`      ${typeof d === "string" ? d : JSON.stringify(d)}`); };
const poll = async (fn, t = 60000, e = 250) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, e)); } return null; };

async function register({ name, password }) {
  const branch = "0";
  const moment = { actId: randomUUID(), actorAct: { branch, by: "i-am" }, identity: { beingId: "i-am", name: "i-am", nameId: "i-am" }, deltaF: [], foldedSeqs: new Map(), afterSeal: [], _inOp: true };
  const res = await cherubBeOps.birth.handler({ payload: { name, password }, ctx: { nameId: null, moment, req: {} } });
  await sealFacts(moment.deltaF);
  for (const fn of moment.afterSeal || []) { try { await fn(); } catch { /* angel grant; tolerated */ } }
  return res;
}

// drive cherub-connect.word flow 1 through the bridge with the REAL host env
async function connect(name, password) {
  const branch = "0";
  const moment = { actId: randomUUID(), actorAct: { branch }, identity: { beingId: "arrival", name: "arrival" }, deltaF: [], foldedSeqs: new Map(), afterSeal: [] };
  const ir = resolveAbleWord("cherub", "connect");
  try {
    const { deltaF, result } = await runAbleWord(ir, { moment, branch, trigger: { name, password }, env: { host: connectHostEnv() } });
    return { result, deltaF, refused: null };
  } catch (e) {
    if (e && e.__wordRefusal) return { result: null, deltaF: moment.deltaF, refused: e };
    throw e;
  }
}

console.log(`\n  verify-connect-live (cherub-connect.word flow 1, ZERO stubs)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`);
try {
  const branch = "0";
  const cherub = await poll(() => findByName("being", "cherub", branch));
  if (!cherub) { console.log("  FATAL: genesis failed"); process.exit(1); }

  // ir present + parses (the other agent's parse gate, now resolved through the bridge)
  const ir = resolveAbleWord("cherub", "connect");
  ir ? ok(`cherub-connect.word resolves + parses through the bridge`) : bad(`cherub-connect.word resolves`, "null IR");

  // register a real being WITH a password (Mode 1 = a shared being you password-connect to)
  await register({ name: "alice", password: "alice-secret-1" });
  const alice = await poll(() => findByName("being", "alice", branch));
  alice ? ok(`registered @alice (a real being with a password hash)`) : bad(`@alice registered`, "no row");
  const aliceId = String(alice.id);

  // ── 1. correct password → token + seat, NO refusal, NO fact ──
  const good = await connect("alice", "alice-secret-1");
  !good.refused && good.result?.token ? ok(`correct password → returns a token (real generateToken, no stub)`) : bad(`correct password token`, good.refused?.message || good.result);
  good.result?.seat === (alice.state?.homeHistory ?? "0") || good.result?.seat === "0"
    ? ok(`returns seat = the being's homeHistory (${good.result?.seat})`) : bad(`seat = homeHistory`, good.result?.seat);
  (good.deltaF || []).length === 0 ? ok(`connect lays NO fact (CONTROL is private; only the session rides the return)`) : bad(`no fact`, good.deltaF);

  // the token is REAL: decode it back to alice's being id
  try {
    const decoded = decodeToken(good.result.token);
    String(decoded?.beingId || decoded?.sub || decoded?.id) === aliceId
      ? ok(`the returned token decodes to @alice's being id (end-to-end real)`) : bad(`token decodes to alice`, decoded);
  } catch (e) { bad(`token decodes`, e.message); }

  // ── 2. WRONG password → refuse "Invalid credentials", NO token, NO fact ──
  const wrong = await connect("alice", "wrong-password");
  wrong.refused && /invalid credentials/i.test(wrong.refused.message) && !wrong.result
    ? ok(`wrong password → refuse "Invalid credentials" (no token)`) : bad(`wrong password refuses`, wrong.refused?.message || wrong.result);
  (wrong.deltaF || []).length === 0 ? ok(`refused connect lays NO fact`) : bad(`refuse no fact`, wrong.deltaF);

  // ── 3. NON-EXISTENT name → refuse (the foreach finds nothing, "no being was found") ──
  const ghost = await connect("nobody-here", "whatever");
  ghost.refused && /invalid credentials/i.test(ghost.refused.message)
    ? ok(`unknown name → foreach finds nothing → refuse`) : bad(`unknown name refuses`, ghost.refused?.message || ghost.result);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
