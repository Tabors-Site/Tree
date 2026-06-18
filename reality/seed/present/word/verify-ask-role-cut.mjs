#!/usr/bin/env node
// ask-role.word (the asked-policy acquisition slice), LIVE through the bridge with ZERO
// stubs. The CONTROL strand (the gate chain + idempotency + the §9 Match on the asked
// policy) is .word; the acquisition lookups, the grant emit, and the queue-path owner
// summon are host: escapes wired by acquisitionHost.js. Proves: the AUTO policy grants
// immediately (a real grant-role fact, the asker holds it), the idempotent re-ask
// (already:true, no new grant), the QUEUE policy summons the host owner (granted:false,
// path:queue, no grant), and the refusals (asked:false / not installed). Full begin.js
// boot. Scratch DB, wiped.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = "mongodb://localhost:27017/reality_word_askrole_cut";
process.env.PORT = "3789";
process.env.MONGODB_URI = SCRATCH_DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "askrole-secret-0123456789";
process.env.REALITY_KEY_DIR = path.join(os.tmpdir(), "askrolecut-keys-" + process.pid);
fs.rmSync(process.env.REALITY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "askrolecut-src");
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
const { resolveRoleWord } = await import(`${R}/seed/present/word/roleWordRegistry.js`);

let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d !== undefined) console.log(`      ${typeof d === "string" ? d : JSON.stringify(d)}`); };
const poll = async (fn, t = 60000, e = 250) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, e)); } return null; };

const cherub = await poll(() => findByName("being", "cherub", "0"));
const birth = async (name) => {
  let bid = null;
  await withIAmAct(`birth ${name}`, async (ctx) => {
    const b = await birthBeing({ spec: { name, parentBeingId: cherub.id, homeId: cherub.state?.homeSpace, cognition: "scripted", defaultRole: "global" }, identity: I_AM, summonCtx: ctx, branch: "0" });
    bid = b.beingId;
  });
  return bid;
};

// drive the REAL ask-role op via doVerb → the cut handler → ask-role.word; seal here
async function askRole(caller, role, space) {
  const branch = "0";
  const sc = { actId: randomUUID(), actorAct: { branch, nameId: "i-am" }, identity: { beingId: String(caller) }, deltaF: [], foldedSeqs: new Map(), afterSeal: [] };
  try {
    const res = await doVerb({ kind: "space", id: String(space) }, "ask-role", { role }, { identity: { beingId: String(caller) }, summonCtx: sc });
    if (sc.deltaF.length) await sealFacts(sc.deltaF);
    const result = res?.result ?? res;
    return { result, deltaF: sc.deltaF, refused: null };
  } catch (e) { if (e && (e.name === "IbpError" || e.code)) return { result: null, deltaF: sc.deltaF, refused: e }; throw e; }
}

console.log(`\n  verify-ask-role-cut (REAL ask-role op via doVerb → the cut)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`);
try {
  if (!cherub) { console.log("  FATAL: genesis failed"); process.exit(1); }
  const ir = resolveRoleWord("acquisition", "ask-role");
  ir ? ok(`ask-role.word resolves through the bridge (self-registered)`) : bad(`ask-role resolves`, "null");

  // arena with three asked-policies: greeter=auto, member=queue, sage=false
  let arena = null;
  await withIAmAct("create arena", async (ctx) => {
    const res = await doVerb({ kind: "space", id: String(getSpaceRootId()) }, "create-space", { name: "askarena", type: "generic" }, { identity: I_AM, summonCtx: ctx });
    arena = String(res.spaceId);
  });
  const installRole = (name, acquisition) => withIAmAct(`install ${name}`, async (ctx) => {
    await doVerb({ kind: "space", id: arena }, "set-space", { field: `qualities.roles.${name}`, value: { canSee: [], canDo: [], canSummon: [], acquisition }, merge: false }, { identity: I_AM, summonCtx: ctx });
  });
  await installRole("greeter", { asked: "auto" });
  await installRole("member", { asked: "queue" });
  await installRole("sage", { asked: false });

  // an owner the queue path can address
  const owner = await birth("askowner");
  await withIAmAct("set arena owner", async (ctx) => {
    await doVerb({ kind: "space", id: arena }, "set-space", { field: "owner", value: String(owner), merge: false }, { identity: I_AM, summonCtx: ctx });
  });
  const asker = await birth("asker");
  arena ? ok(`arena: greeter(auto) + member(queue) + sage(false), owner @askowner`) : bad(`arena`, "no space");
  console.log(`  arena=${arena.slice(0,10)} asker=${String(asker).slice(0,10)} owner=${String(owner).slice(0,10)}\n`);

  // ── 1. AUTO policy → granted immediately, a real grant-role fact, the asker holds it ──
  const a = await askRole(asker, "greeter", arena);
  a.result?.granted === true && a.result?.path === "auto" ? ok(`ask greeter (asked:auto) → granted:true, path:auto`) : bad(`auto granted`, a.refused?.message || a.result);
  (a.deltaF || []).some((f) => f.action === "grant-role" && f.params?.role === "greeter") ? ok(`a real grant-role fact laid (the lone WORLD fact)`) : bad(`grant fact`, a.deltaF?.map((f) => f.action));
  const slot = await loadOrFold("being", String(asker), "0");
  (slot?.state?.qualities?.rolesGranted || []).some((r) => (r.role || r) === "greeter") ? ok(`@asker now HOLDS the greeter role`) : bad(`holds`, slot?.state?.qualities?.rolesGranted);

  // ── 2. idempotent re-ask → already:true, NO second grant ──
  const a2 = await askRole(asker, "greeter", arena);
  a2.result?.already === true && !(a2.deltaF || []).some((f) => f.action === "grant-role") ? ok(`re-ask greeter → already:true, NO new grant`) : bad(`idempotent`, a2.result || a2.deltaF?.map((f) => f.action));

  // ── 3. QUEUE policy → summon the owner, granted:false, NO grant fact ──
  const a3 = await askRole(asker, "member", arena);
  a3.result?.granted === false && a3.result?.path === "queue" && /Requested/i.test(a3.result?.message || "") && !(a3.deltaF || []).some((f) => f.action === "grant-role")
    ? ok(`ask member (asked:queue) → granted:false, path:queue, owner summoned ("${a3.result.message}"), NO grant`)
    : bad(`queue`, a3.refused?.message || a3.result);

  // ── 4. asked:false → refuse "not ask-acquirable" ──
  const a4 = await askRole(asker, "sage", arena);
  a4.refused && /not ask-acquirable/i.test(a4.refused.message) ? ok(`ask sage (asked:false) → refuse "not ask-acquirable"`) : bad(`asked false`, a4.refused?.message || a4.result);

  // ── 5. a role NOT installed → refuse "not installed" ──
  const a5 = await askRole(asker, "ghostrole", arena);
  a5.refused && /not installed/i.test(a5.refused.message) ? ok(`ask an uninstalled role → refuse "not installed"`) : bad(`not installed`, a5.refused?.message || a5.result);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
