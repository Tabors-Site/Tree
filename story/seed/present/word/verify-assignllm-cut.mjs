#!/usr/bin/env node
// assign-llm-slot (assign-llm-slot.word) — POLYMORPHIC being/space, LIVE through runWordToStore.
// The branch picks the op (being→set-being / space→set-space), so the .word issues a CONDITIONAL
// DEED; the chosen deed is its own moment via runWordToStore (ranAsMoments → the op stamps none of
// its own). Proves (being branch): a REAL assign via doVerb runs the .word, the being's main slot
// rebinds (the isBeing deed: do set-being at beingLlm.slots.main), a clear (connectionId:null)
// unsets it, and the no-actor gate refuses. Host floor = resolve-slot-assignment. Full begin.js boot.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = "mongodb://localhost:27017/story_word_assignllm_cut";
process.env.PORT = "3794";
process.env.MONGODB_URI = SCRATCH_DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "assignllm-secret-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "assignllmcut-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "assignllmcut-src");
fs.rmSync(SRC, { recursive: true, force: true });
fs.mkdirSync(SRC, { recursive: true });
fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;
process.env.CUSTOM_LLM_API_SECRET_KEY = process.env.CUSTOM_LLM_API_SECRET_KEY || "assignllm-llm-encryption-key-0123456789ab";

{
  const mongoose = (await import(`${R}/node_modules/mongoose/index.js`)).default;
  const conn = await mongoose.createConnection(SCRATCH_DB).asPromise();
  await conn.dropDatabase();
  await conn.close();
}

await import(`${R}/begin.js`);

const { findByName, loadOrFold } = await import(`${R}/seed/materials/projections.js`);
const { sealFacts } = await import(`${R}/seed/past/fact/facts.js`);
const { I_AM } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { doVerb } = await import(`${R}/seed/ibp/verbs/do.js`);
const { resolveAbleWord } = await import(`${R}/seed/present/word/ableWordRegistry.js`);

let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d !== undefined) console.log(`      ${typeof d === "string" ? d : JSON.stringify(d)}`); };
const poll = async (fn, t = 60000, e = 250) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, e)); } return null; };
const ident = { beingId: I_AM, name: "i-am", nameId: "i-am" };

const cherub = await poll(() => findByName("being", "cherub", "0"));
const did = async (op, target, params, who = ident) => {
  const sc = { actId: randomUUID(), actorAct: { history: "0", by: who?.nameId || null }, identity: who, deltaF: [], foldedSeqs: new Map(), afterSeal: [] };
  try {
    const res = await doVerb(target, op, params, { identity: who, moment: sc, currentHistory: "0" });
    if (sc.deltaF.length) await sealFacts(sc.deltaF);
    for (const cb of (sc.afterSeal || [])) { try { await cb(); } catch {} }
    return { result: res?.result ?? res, deltaF: sc.deltaF, refused: null };
  } catch (e) { for (const cb of (sc.afterSeal || [])) { try { await cb(); } catch {} } if (e && (e.name === "IbpError" || e.code)) return { result: null, deltaF: sc.deltaF, refused: e }; throw e; }
};
const being = async () => (await loadOrFold("being", String(I_AM), "0"))?.state;
const mainSlot = (st) => { const q = st?.qualities; const m = q instanceof Map ? q.get("beingLlm") : q?.beingLlm; return m?.slots?.main; };

console.log(`\n  verify-assignllm-cut (REAL assign-llm-slot op via doVerb → conditional deed, runWordToStore)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`);
try {
  if (!cherub) { console.log("  FATAL: genesis failed"); process.exit(1); }
  const { setStoryConfigValue } = await import(`${R}/seed/storyConfig.js`);
  await setStoryConfigValue("allowedLlmDomains", ["example.com"], { identity: ident });

  resolveAbleWord("being", "assign-llm-slot") ? ok(`assign-llm-slot.word resolves (being)`) : bad(`resolves`, "null");

  const T = { kind: "being", id: String(I_AM) };
  const addA = await did("add-llm-connection", T, { name: "A", baseUrl: "https://example.com/a", model: "m", apiKey: "sk-a" });
  const idA = addA.result?.connectionId ?? addA.result?.connection?._id;
  await poll(async () => (mainSlot(await being()) === idA ? "y" : null), 8000);
  const addB = await did("add-llm-connection", T, { name: "B", baseUrl: "https://example.com/b", model: "m", apiKey: "sk-b" });
  const idB = addB.result?.connectionId ?? addB.result?.connection?._id;
  (idA && idB) ? ok(`seeded A (main) + B`) : bad(`seed`, { idA, idB });

  // ── 1. assign main → B through the .word (the isBeing conditional deed fires) ──
  const asg = await did("assign-llm-slot", T, { slot: "main", connectionId: idB });
  const m = await poll(async () => (mainSlot(await being()) === idB ? "y" : null), 8000);
  asg.result && m
    ? ok(`assign main → B: being-branch deed fired (do set-being at beingLlm.slots.main), main now B`)
    : bad(`assign`, asg.refused?.message || { main: mainSlot(await being()), want: idB });

  // ── 2. clear the slot (connectionId omitted → null) unsets it ──
  const clr = await did("assign-llm-slot", T, { slot: "main" });
  const cleared = await poll(async () => (mainSlot(await being()) == null ? "y" : null), 8000);
  clr.result && cleared
    ? ok(`assign main → (null) clears the slot (set-being value:null unsets)`)
    : bad(`clear`, clr.refused?.message || mainSlot(await being()));

  // ── 3. the no-actor gate refuses ──
  const n = await did("assign-llm-slot", T, { slot: "main", connectionId: idA }, {});
  n.refused ? ok(`no actor → refuse "${n.refused.message?.slice(0, 44)}..."`) : bad(`actor gate`, n.result);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
