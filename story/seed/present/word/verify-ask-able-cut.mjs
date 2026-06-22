#!/usr/bin/env node
// ask-able.word (the asked-policy acquisition slice), LIVE through the bridge with ZERO
// stubs. The CONTROL strand (the gate chain + idempotency + the §9 Match on the asked
// policy) is .word; the acquisition lookups, the grant emit, and the queue-path owner
// summon are host: escapes wired by acquisitionHost.js. Proves: the AUTO policy grants
// immediately (a real grant-able fact, the asker holds it), the idempotent re-ask
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
const SCRATCH_DB = "mongodb://localhost:27017/story_word_askable_cut";
process.env.PORT = "3789";
process.env.MONGODB_URI = SCRATCH_DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "askable-secret-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "askablecut-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "askablecut-src");
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
const { resolveAbleWord } = await import(`${R}/seed/present/word/ableWordRegistry.js`);

let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d !== undefined) console.log(`      ${typeof d === "string" ? d : JSON.stringify(d)}`); };
const poll = async (fn, t = 60000, e = 250) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, e)); } return null; };

const cherub = await poll(() => findByName("being", "cherub", "0"));
const birth = async (name) => {
  let bid = null;
  await withIAmAct(`birth ${name}`, async (ctx) => {
    const b = await birthBeing({ spec: { name, parentBeingId: cherub.id, homeId: cherub.state?.homeSpace, cognition: "scripted", defaultAble: "global" }, identity: I_AM, moment: ctx, history: "0" });
    bid = b.beingId;
  });
  return bid;
};

// drive the REAL ask-able op via doVerb → the cut handler → ask-able.word; seal here
async function askAble(caller, able, space) {
  const branch = "0";
  const sc = { actId: randomUUID(), actorAct: { history: branch, by: "i-am" }, identity: { beingId: String(caller) }, deltaF: [], foldedSeqs: new Map(), afterSeal: [] };
  try {
    const res = await doVerb({ kind: "space", id: String(space) }, "ask-able", { able }, { identity: { beingId: String(caller) }, moment: sc });
    if (sc.deltaF.length) await sealFacts(sc.deltaF);
    const result = res?.result ?? res;
    return { result, deltaF: sc.deltaF, refused: null };
  } catch (e) { if (e && (e.name === "IbpError" || e.code)) return { result: null, deltaF: sc.deltaF, refused: e }; throw e; }
}

console.log(`\n  verify-ask-able-cut (REAL ask-able op via doVerb → the cut)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`);
try {
  if (!cherub) { console.log("  FATAL: genesis failed"); process.exit(1); }
  const ir = resolveAbleWord("acquisition", "ask-able");
  ir ? ok(`ask-able.word resolves through the bridge (self-registered)`) : bad(`ask-able resolves`, "null");

  // arena with three asked-policies: greeter=auto, member=queue, sage=false
  let arena = null;
  await withIAmAct("create arena", async (ctx) => {
    const res = await doVerb({ kind: "space", id: String(getSpaceRootId()) }, "create-space", { name: "askarena", type: "generic" }, { identity: I_AM, moment: ctx });
    arena = String(res.spaceId);
  });
  const installAble = (name, acquisition) => withIAmAct(`install ${name}`, async (ctx) => {
    await doVerb({ kind: "space", id: arena }, "set-space", { field: `qualities.ables.${name}`, value: { canSee: [], canDo: [], canSummon: [], acquisition }, merge: false }, { identity: I_AM, moment: ctx });
  });
  await installAble("greeter", { asked: "auto" });
  await installAble("member", { asked: "queue" });
  await installAble("sage", { asked: false });

  // an owner the queue path can address
  const owner = await birth("askowner");
  await withIAmAct("set arena owner", async (ctx) => {
    await doVerb({ kind: "space", id: arena }, "set-space", { field: "owner", value: String(owner), merge: false }, { identity: I_AM, moment: ctx });
  });
  const asker = await birth("asker");
  arena ? ok(`arena: greeter(auto) + member(queue) + sage(false), owner @askowner`) : bad(`arena`, "no space");
  console.log(`  arena=${arena.slice(0,10)} asker=${String(asker).slice(0,10)} owner=${String(owner).slice(0,10)}\n`);

  // ── 1. AUTO policy → granted immediately, a do:ask-able fact carries the grant, asker holds it ──
  const a = await askAble(asker, "greeter", arena);
  a.result?.granted === true && a.result?.path === "auto" ? ok(`ask greeter (asked:auto) → granted:true, path:auto`) : bad(`auto granted`, a.refused?.message || a.result);
  const askFact = (a.deltaF || []).find((f) => f.act === "ask-able" && f.params?.able === "greeter");
  (askFact && askFact.params?.grantedBy) ? ok(`a do:ask-able fact laid carrying the grant record (applyAbleGrants folds the grant from the ask)`) : bad(`ask fact + grant record`, a.deltaF?.map((f) => f.act));
  const slot = await loadOrFold("being", String(asker), "0");
  (slot?.state?.qualities?.ablesGranted || []).some((r) => (r.able || r) === "greeter") ? ok(`@asker now HOLDS the greeter able`) : bad(`holds`, slot?.state?.qualities?.ablesGranted);

  // ── 2. idempotent re-ask → the ask IS stamped (every act makes a fact), no duplicate grant ──
  const a2 = await askAble(asker, "greeter", arena);
  const reAsk = (a2.deltaF || []).find((f) => f.act === "ask-able" && f.params?.able === "greeter");
  (a2.result?.already === true && reAsk && !reAsk.params?.grantedBy) ? ok(`re-ask → already:true; the ask IS stamped (do:ask-able, outcome:already) but no grant record → nothing re-folds`) : bad(`idempotent re-ask`, { already: a2.result?.already, fact: reAsk?.params });

  // ── 3. QUEUE policy → the ask IS stamped (outcome:queue, no grant), AND the owner is summoned ──
  const a3 = await askAble(asker, "member", arena);
  const queueAsk = (a3.deltaF || []).find((f) => f.act === "ask-able" && f.params?.able === "member");
  (a3.result?.granted === false && a3.result?.path === "queue" && /Requested/i.test(a3.result?.message || "") && queueAsk && !queueAsk.params?.grantedBy)
    ? ok(`ask member (asked:queue) → granted:false, path:queue, owner summoned; the ask IS stamped (do:ask-able, outcome:queue) but folds no grant`)
    : bad(`queue`, a3.refused?.message || a3.result || queueAsk?.params);

  // ── 4. asked:false → refuse "not ask-acquirable" ──
  const a4 = await askAble(asker, "sage", arena);
  a4.refused && /not ask-acquirable/i.test(a4.refused.message) ? ok(`ask sage (asked:false) → refuse "not ask-acquirable"`) : bad(`asked false`, a4.refused?.message || a4.result);

  // ── 5. a able NOT installed → refuse "not installed" ──
  const a5 = await askAble(asker, "ghostable", arena);
  a5.refused && /not installed/i.test(a5.refused.message) ? ok(`ask an uninstalled able → refuse "not installed"`) : bad(`not installed`, a5.refused?.message || a5.result);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
