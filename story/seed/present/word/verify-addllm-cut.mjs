#!/usr/bin/env node
// add-llm-connection (add.word) — THE MULTI-MOMENT composite, LIVE through runWordToStore (the
// engine's wiring). Two deeds: `do set-being` (the connection) then `If isFirst, do assign-llm-slot`
// (auto-assign-to-main as its OWN word/moment). The op lays no own fact (ranAsMoments); the deeds
// seal to store as separate moments. Proves: a REAL add via doVerb runs add.word, the connection
// folds AND main auto-assigns (two deeds), a SECOND add does NOT re-assign main (isFirst=false →
// the conditional deed skips), and the no-actor gate refuses. Host floor = resolve-connection
// (connect.js resolveConnectionSpec + isFirst). Full begin.js boot. Scratch DB.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = "mongodb://localhost:27017/story_word_addllm_cut";
process.env.PORT = "3795";
process.env.MONGODB_URI = SCRATCH_DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "addllm-secret-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "addllmcut-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "addllmcut-src");
fs.rmSync(SRC, { recursive: true, force: true });
fs.mkdirSync(SRC, { recursive: true });
fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;
process.env.CUSTOM_LLM_API_SECRET_KEY = process.env.CUSTOM_LLM_API_SECRET_KEY || "addllm-llm-encryption-key-0123456789ab";

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
const conns = (st) => { const q = st?.qualities; const c = q instanceof Map ? q.get("llmConnections") : q?.llmConnections; return c instanceof Map ? Object.fromEntries(c) : (c || {}); };
const mainSlot = (st) => { const q = st?.qualities; const m = q instanceof Map ? q.get("beingLlm") : q?.beingLlm; return m?.slots?.main; };

console.log(`\n  verify-addllm-cut (REAL add-llm-connection op via doVerb → runWordToStore, two deeds)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`);
try {
  if (!cherub) { console.log("  FATAL: genesis failed"); process.exit(1); }
  const { setStoryConfigValue } = await import(`${R}/seed/storyConfig.js`);
  await setStoryConfigValue("allowedLlmDomains", ["example.com"], { identity: ident });

  resolveAbleWord("being", "add-llm-connection") ? ok(`add-llm-connection.word resolves through the bridge`) : bad(`resolves`, "null");

  const T = { kind: "being", id: String(I_AM) };

  // ── 1. add conn A → it folds (deed 1) ──
  const addA = await did("add-llm-connection", T, { name: "A", baseUrl: "https://example.com/a", model: "m", apiKey: "sk-a" });
  const idA = addA.result?.connectionId ?? addA.result?.connection?._id;
  const cA = await poll(async () => (conns(await being())[idA] ? conns(await being())[idA] : null), 8000);
  idA && cA && cA.name === "A"
    ? ok(`add A → connection folds (deed 1: do set-being): "${cA.name}", id ${String(idA).slice(0, 8)}…`)
    : bad(`add A`, addA.refused?.message || { idA, cA });

  // ── 2. main AUTO-ASSIGNED to A (deed 2: If isFirst, do assign-llm-slot — its own moment) ──
  const m1 = await poll(async () => (mainSlot(await being()) === idA ? "y" : null), 8000);
  m1
    ? ok(`main auto-assigned to A (deed 2 ran as its OWN moment — the multi-moment composite)`)
    : bad(`auto-assign`, mainSlot(await being()));

  // ── 3. add conn B → folds, but main UNCHANGED (isFirst=false → the conditional deed skips) ──
  const addB = await did("add-llm-connection", T, { name: "B", baseUrl: "https://example.com/b", model: "m", apiKey: "sk-b" });
  const idB = addB.result?.connectionId ?? addB.result?.connection?._id;
  const cB = await poll(async () => (conns(await being())[idB] ? "y" : null), 8000);
  cB && idB !== idA
    ? ok(`add B → connection folds (deed 1 again), distinct id`)
    : bad(`add B`, { idB, cB });
  (mainSlot(await being()) === idA)
    ? ok(`main STILL A after adding B (isFirst=false → the conditional assign deed skipped — not a run-on)`)
    : bad(`no re-assign`, mainSlot(await being()));

  // ── 4. no-actor gate refuses ──
  const n = await did("add-llm-connection", T, { name: "C", baseUrl: "https://example.com/c", model: "m", apiKey: "sk-c" }, {});
  n.refused ? ok(`no actor → refuse "${n.refused.message?.slice(0, 44)}..."`) : bad(`actor gate`, n.result);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
