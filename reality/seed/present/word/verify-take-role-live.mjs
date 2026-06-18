#!/usr/bin/env node
// take-role.word (the acquisition walk-in slice), LIVE through the bridge with ZERO
// stubs. The CONTROL strand (the gate chain + idempotency) is .word; the acquisition
// lookups + the grant emit are host: escapes wired by acquisitionHost.js. Proves a being
// takes a grabbable role (a real grant-role fact lands, the being holds the role), the
// idempotent re-take (already:true), and the refusals (not installed / not grabbable).
// Full begin.js boot. Scratch DB, wiped.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = "mongodb://localhost:27017/reality_word_takerole_live";
process.env.PORT = "3789";
process.env.MONGODB_URI = SCRATCH_DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "takerole-secret-0123456789";
process.env.REALITY_KEY_DIR = path.join(os.tmpdir(), "takerole-keys-" + process.pid);
fs.rmSync(process.env.REALITY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "takerole-src");
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

const { findByName, loadOrFold } = await import(`${R}/seed/materials/projections.js`);
const { sealFacts } = await import(`${R}/seed/past/fact/facts.js`);
const { withIAmAct } = await import(`${R}/seed/sprout.js`);
const { birthBeing } = await import(`${R}/seed/materials/being/identity/birth.js`);
const { I_AM } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { getSpaceRootId } = await import(`${R}/seed/sprout.js`);
const { doVerb } = await import(`${R}/seed/ibp/verbs/do.js`);
const { resolveRoleWord, runRoleWord } = await import(`${R}/seed/present/word/roleWordRegistry.js`);
const { acquisitionHostEnv } = await import(`${R}/seed/present/roles/acquisitionHost.js`);

let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d !== undefined) console.log(`      ${typeof d === "string" ? d : JSON.stringify(d)}`); };
const poll = async (fn, t = 60000, e = 250) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, e)); } return null; };

const cherub = await poll(() => findByName("being", "cherub", "0"));
const birth = async (name) => {
  let bid = null;
  await withIAmAct(`birth ${name}`, async (ctx) => {
    const b = await birthBeing({ spec: { name, parentBeingId: cherub.id, homeId: cherub.state?.homeSpace, cognition: "scripted", defaultRole: "global" }, identity: I_AM, moment: ctx, branch: "0" });
    bid = b.beingId;
  });
  return bid;
};

// run take-role.word LIVE; the grant lands on the moment, sealed here
async function takeRole(caller, role, space) {
  const branch = "0";
  const sc = { actId: randomUUID(), actorAct: { branch }, identity: { beingId: String(caller) }, deltaF: [], foldedSeqs: new Map(), afterSeal: [] };
  const ir = resolveRoleWord("acquisition", "take-role");
  try {
    const { result } = await runRoleWord(ir, { moment: sc, branch, trigger: { caller: String(caller), role, space: String(space), branch }, env: { host: acquisitionHostEnv() } });
    if (sc.deltaF.length) await sealFacts(sc.deltaF);
    return { result, deltaF: sc.deltaF, refused: null };
  } catch (e) { if (e && e.__wordRefusal) return { result: null, deltaF: sc.deltaF, refused: e }; throw e; }
}

console.log(`\n  verify-take-role-live (acquisition walk-in, ZERO stubs)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`);
try {
  if (!cherub) { console.log("  FATAL: genesis failed"); process.exit(1); }
  const ir = resolveRoleWord("acquisition", "take-role");
  ir ? ok(`take-role.word resolves through the bridge (self-registered)`) : bad(`take-role resolves`, "null");

  // a space with a GRABBABLE role (warrior) + a NON-grabbable role (sage)
  let arena = null;
  await withIAmAct("create arena", async (ctx) => {
    const res = await doVerb({ kind: "space", id: String(getSpaceRootId()) }, "create-space", { name: "arena", type: "generic" }, { identity: I_AM, moment: ctx });
    arena = String(res.spaceId);
  });
  // real install path (host.js): one role per do:set-space at qualities.roles.<name>
  await withIAmAct("install warrior", async (ctx) => {
    await doVerb({ kind: "space", id: arena }, "set-space", { field: "qualities.roles.warrior", value: { canSee: [], canDo: [], canSummon: [], acquisition: { grabbed: true } }, merge: false }, { identity: I_AM, moment: ctx });
  });
  await withIAmAct("install sage", async (ctx) => {
    await doVerb({ kind: "space", id: arena }, "set-space", { field: "qualities.roles.sage", value: { canSee: [], canDo: [], canSummon: [], acquisition: { grabbed: false } }, merge: false }, { identity: I_AM, moment: ctx });
  });
  arena ? ok(`arena space created with a grabbable role (warrior) + a non-grabbable (sage)`) : bad(`arena`, "no space");

  const taker = await birth("taker");
  // (set-space now invalidates the ancestor cache itself — no manual force-fresh needed.)
  console.log(`  arena=${arena.slice(0,10)} taker=${String(taker).slice(0,10)}\n`);

  // ── 1. take a grabbable role → granted, a real grant-role fact, the being holds it ──
  const t = await takeRole(taker, "warrior", arena);
  t.result?.granted === true && t.result?.role === "warrior" ? ok(`take warrior → granted:true`) : bad(`granted`, t.refused?.message || t.result);
  (t.deltaF || []).some((f) => f.act === "grant-role" && f.params?.role === "warrior") ? ok(`a real grant-role fact laid (the lone WORLD fact)`) : bad(`grant fact`, t.deltaF?.map((f) => f.act));
  const slot = await loadOrFold("being", String(taker), "0");
  (slot?.state?.qualities?.rolesGranted || []).some((r) => (r.role || r) === "warrior") ? ok(`@taker now HOLDS the warrior role (rolesGranted)`) : bad(`holds role`, slot?.state?.qualities?.rolesGranted);

  // ── 2. idempotent re-take → already:true, NO second grant ──
  const t2 = await takeRole(taker, "warrior", arena);
  t2.result?.already === true && (t2.deltaF || []).length === 0 ? ok(`re-take warrior → already:true, NO new fact (idempotent)`) : bad(`idempotent`, t2.result || t2.deltaF);

  // ── 3. a NON-grabbable role → refuse ──
  const t3 = await takeRole(taker, "sage", arena);
  t3.refused && /not take-acquirable/i.test(t3.refused.message) ? ok(`take sage (grabbed:false) → refuse "not take-acquirable"`) : bad(`not grabbable`, t3.refused?.message || t3.result);

  // ── 4. a role NOT installed → refuse ──
  const t4 = await takeRole(taker, "ghostrole", arena);
  t4.refused && /not installed/i.test(t4.refused.message) ? ok(`take an uninstalled role → refuse "not installed"`) : bad(`not installed`, t4.refused?.message || t4.result);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
