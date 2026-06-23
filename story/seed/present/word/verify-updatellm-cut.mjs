#!/usr/bin/env node
// update-llm-connection (update-llm-connection.word), LIVE through the bridge. The host see
// resolve-connection-update (connect.js resolveConnectionUpdate: validate / SSRF / re-encrypt
// the changed fields / merge) is the floor; the dispatcher lays ONE do:set-being fact (no
// skipAudit, no self-emit). Proves: a REAL update via doVerb runs the .word, lands one
// set-being fact carrying the merged connection, the fold updates the row, and the no-actor
// gate refuses. Seeds the connection via add-llm-connection (also exercises E6 resolveConnectionSpec).
// allowedLlmDomains opt-in keeps the SSRF gate offline-robust. Full begin.js boot. Scratch DB.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = "mongodb://localhost:27017/story_word_updatellm_cut";
process.env.PORT = "3797";
process.env.MONGODB_URI = SCRATCH_DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "updatellm-secret-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "updatellmcut-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "updatellmcut-src");
fs.rmSync(SRC, { recursive: true, force: true });
fs.mkdirSync(SRC, { recursive: true });
fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;
process.env.CUSTOM_LLM_API_SECRET_KEY = process.env.CUSTOM_LLM_API_SECRET_KEY || "updatellm-llm-encryption-key-0123456789";

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
const readConn = async (connId) => {
  const slot = await loadOrFold("being", String(I_AM), "0");
  const q = slot?.state?.qualities;
  const conns = q instanceof Map ? q.get("llmConnections") : q?.llmConnections;
  const c = conns instanceof Map ? conns.get(connId) : conns?.[connId];
  return c || null;
};

console.log(`\n  verify-updatellm-cut (REAL update-llm-connection op via doVerb → the cut)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`);
try {
  if (!cherub) { console.log("  FATAL: genesis failed"); process.exit(1); }

  // Opt-in the test domain so the SSRF gate bypasses DNS (offline-robust).
  const { setStoryConfigValue } = await import(`${R}/seed/storyConfig.js`);
  await setStoryConfigValue("allowedLlmDomains", ["example.com"], { identity: ident });

  resolveAbleWord("being", "update-llm-connection") ? ok(`update-llm-connection.word resolves through the bridge`) : bad(`resolves`, "null");

  // Seed: add a connection (exercises E6 resolveConnectionSpec on the add path too).
  const add = await did("add-llm-connection", { kind: "being", id: String(I_AM) }, { name: "conn-a", baseUrl: "https://example.com/v1", model: "m1", apiKey: "sk-aaa" });
  const connId = add.result?.connection?._id;
  connId ? ok(`seeded a connection via add (E6 resolveConnectionSpec ran): ${String(connId).slice(0, 8)}…`) : bad(`add`, add.refused?.message || add.result);

  // ── 1. update it through the .word → ONE do:set-being fact ──
  const up = await did("update-llm-connection", { kind: "being", id: String(I_AM) }, { connectionId: connId, name: "conn-a2", baseUrl: "https://example.com/v2", model: "m2" });
  const sf = (up.deltaF || []).filter((f) => f.act === "set-being");
  up.result && sf.length === 1
    ? ok(`update → exactly ONE do:set-being fact (the spacebar lift; no skipAudit double-stamp)`)
    : bad(`one-fact`, up.refused?.message || { facts: sf.length, result: up.result });

  // ── 2. the fact carries the merged connection at the right path, attributed to the caller ──
  const f = sf[0];
  f && f.params?.field === `qualities.llmConnections.${connId}` && f.params?.value?.model === "m2" && String(f.through) === String(I_AM)
    ? ok(`do:set-being: field = llmConnections.<id>, value.model = "m2" (merged), through = caller`)
    : bad(`fact`, f ? { field: f.params?.field, model: f.params?.value?.model, through: f.through } : "no fact");

  // ── 3. the connection folds: model + name updated, baseUrl updated ──
  const c = await readConn(connId);
  c && c.model === "m2" && c.name === "conn-a2" && c.baseUrl === "https://example.com/v2"
    ? ok(`@being folds: connection model "m2", name "conn-a2", baseUrl updated`)
    : bad(`fold`, c);

  // ── 4. encryptedApiKey preserved (unchanged key rides the merged value as ciphertext) ──
  c && typeof c.encryptedApiKey === "string" && c.encryptedApiKey.includes(":")
    ? ok(`encryptedApiKey preserved as ciphertext in the merged value (redact strips it on the wire)`)
    : bad(`key`, c?.encryptedApiKey);

  // ── 5. the no-actor gate refuses ──
  const n = await did("update-llm-connection", { kind: "being", id: String(I_AM) }, { connectionId: connId, baseUrl: "https://example.com/v2", model: "m2" }, {});
  n.refused
    ? ok(`no actor → refuse "${n.refused.message?.slice(0, 48)}..."`)
    : bad(`actor gate`, n.result);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
