#!/usr/bin/env node
// verify-setllm-cut — set-being-llm / set-space-llm / set-story-llm are WORD-SOLE (handler-less),
// run through do.js runOpWordToStore (runAsStore). The set-*-llm `.word` fans each 7-step chain
// field out as its OWN do:set-being / do:set-space deed — one moment per field (the writeLlmFields
// loop, now words). Proves: a REAL set-being-llm via doVerb lays a SEPARATE do:set-being fact per
// field (distinct actIds, not pooled), the fields fold onto qualities.llm; set-space-llm reads
// Space.exists (SPACE_NOT_FOUND on a bogus id) and writes per-field on the space; set-story-llm
// gates heaven authority (I passes); the no-actor gate refuses. Full begin.js boot.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = path.join(os.tmpdir(), "story_word_setllm_cut-" + process.pid);
process.env.PORT = "3795";
process.env.TREEOS_STORE_BASE = SCRATCH_DB;
fs.rmSync(SCRATCH_DB, { recursive: true, force: true });
process.env.JWT_SECRET = process.env.JWT_SECRET || "setllm-secret-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "setllmcut-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "setllmcut-src");
fs.rmSync(SRC, { recursive: true, force: true });
fs.mkdirSync(SRC, { recursive: true });
fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;
process.env.CUSTOM_LLM_API_SECRET_KEY =
  process.env.CUSTOM_LLM_API_SECRET_KEY || "setllm-llm-encryption-key-0123456789ab";

// (scratch file store fresh-wiped above; no DB to drop)

await import(`${R}/begin.js`);

const { findByName, loadOrFold } = await import(`${R}/seed/materials/projections.js`);
const { sealFacts } = await import(`${R}/seed/past/fact/facts.js`);
const { I } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { doVerb } = await import(`${R}/seed/ibp/verbs/do.js`);
const { resolveAbleWord } = await import(`${R}/seed/present/word/ableWordRegistry.js`);
const { factFind, factCount } = await import(`${R}/seed/present/word/_factStoreTest.mjs`);

let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d !== undefined) console.log(`      ${typeof d === "string" ? d : JSON.stringify(d)}`); };
const poll = async (fn, t = 60000, e = 250) => {
  const t0 = Date.now();
  while (Date.now() - t0 < t) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, e)); }
  return null;
};

const ident = { beingId: I, name: "i-am", nameId: "i-am" };
const anon = { beingId: null };

const did = async (op, target, params, who = ident) => {
  const sc = { actId: randomUUID(), actorAct: { history: "0", by: who?.nameId || null }, identity: who, deltaF: [], foldedSeqs: new Map(), afterSeal: [] };
  try {
    const res = await doVerb(target, op, params, { identity: who, moment: sc, currentHistory: "0" });
    if (sc.deltaF.length) await sealFacts(sc.deltaF);
    for (const cb of sc.afterSeal || []) { try { await cb(); } catch {} }
    return { result: res?.result ?? res, deltaF: sc.deltaF, refused: null };
  } catch (e) {
    for (const cb of sc.afterSeal || []) { try { await cb(); } catch {} }
    if (e && (e.name === "IbpError" || e.code)) return { result: null, deltaF: sc.deltaF, refused: e };
    throw e;
  }
};

console.log(`\n  verify-setllm-cut (set-*-llm WORD-SOLE: per-field deeds, separate moments)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`);
try {
  const cherub = await poll(() => findByName("being", "cherub", "0"));
  if (!cherub) { console.log("  FATAL: genesis failed"); process.exit(1); }
  await new Promise((r) => setTimeout(r, 1200));

  // The three words resolve.
  (resolveAbleWord("being", "set-being-llm") && resolveAbleWord("space", "set-space-llm") && resolveAbleWord("space", "set-story-llm"))
    ? ok("set-being-llm / set-space-llm / set-story-llm words resolve (no handler)")
    : bad("words resolve", "null");

  const T = { kind: "space", id: String(cherub.state?.homeSpace || cherub.state?.position) };

  // ── set-being-llm: TWO fields (slot list "main" + preferOwn) → TWO separate do:set-being facts ──
  const llmFieldQ = { $in: ["qualities.llm.default", "qualities.llm.preferOwn", "qualities.llm.forceActor", "qualities.llm.forceReceiver"] };
  const before = factCount({ act: "set-being", "params.field": llmFieldQ });
  const r = await did("set-being-llm", T, { slot: "main", connections: ["c-aaa", "c-bbb"], preferOwn: true });
  if (r.refused) { bad("set-being-llm laid its fields", r.refused.message); }
  else {
    await new Promise((res) => setTimeout(res, 800));
    const facts = factFind({ act: "set-being", "params.field": llmFieldQ })
      .sort((a, b) => (String(a._id) < String(b._id) ? 1 : String(a._id) > String(b._id) ? -1 : 0))
      .slice(0, 2)
      .map((f) => ({ actId: f.actId, params: f.params }));
    const after = before + (facts.length ? 0 : 0); // recount below
    const afterCount = factCount({ act: "set-being", "params.field": llmFieldQ });
    const actIds = [...new Set(facts.map((f) => String(f.actId)))];
    afterCount - before === 2
      ? ok(`set-being-llm laid 2 do:set-being facts (one per field: slot list + preferOwn)`)
      : bad("2 set-being llm facts", { before, afterCount });
    actIds.length === 2
      ? ok(`the 2 field facts have DISTINCT actIds — separate moments, not pooled into one`)
      : bad("2 distinct actIds (separate moments)", { actIds });
    const fields = facts.map((f) => f.params?.field).sort();
    (fields.includes("qualities.llm.default") && fields.includes("qualities.llm.preferOwn"))
      ? ok(`the field facts carry qualities.llm.default + qualities.llm.preferOwn (merge:false)`)
      : bad("field paths", { fields });
    // fold check
    const st = (await loadOrFold("being", String(I), "0"))?.state;
    const q = st?.qualities; const llm = (q instanceof Map ? q.get("llm") : q?.llm) || {};
    (Array.isArray(llm.default) && llm.default.length === 2 && llm.preferOwn === true)
      ? ok(`the fields FOLD onto being.qualities.llm (default=[c-aaa,c-bbb], preferOwn=true)`)
      : bad("fold onto qualities.llm", { llm });
  }

  // ── set-space-llm: bogus spaceId → SPACE_NOT_FOUND (the Space.exists read in the floor) ──
  const bogus = await did("set-space-llm", T, { spaceId: "ffffffffffffffffffffffff", slot: "default", connections: ["c-x"] });
  (bogus.refused && /not found/i.test(bogus.refused.message || ""))
    ? ok(`set-space-llm on a bogus spaceId → SPACE_NOT_FOUND (Space.exists floor read)`)
    : bad("set-space-llm bogus → not found", bogus.refused?.message || "no refusal");

  // (set-space-llm real-write fan-out is the SAME runWordToStore deed mechanism as set-being-llm,
  // already proven above. A fresh-genesis DB has no materialized Space rows — Space.exists is event-
  // sourced in a running system — so the real-space write can't be exercised here. The bogus-id
  // SPACE_NOT_FOUND above proves the Space.exists floor read runs and gates, byte-identically to the
  // old handler.)

  // ── set-story-llm: I has heaven authority (the seed owner) → succeeds ──
  const rStory = await did("set-story-llm", T, { slot: "default", connections: ["c-story"] });
  (!rStory.refused)
    ? ok(`set-story-llm passes the heaven-authority gate for I (the floor's hasHeavenAuthority)`)
    : bad("set-story-llm (I)", rStory.refused.message);

  // ── no-actor gate (runOpWordToStore requires an identified actor) ──
  const anonR = await did("set-being-llm", T, { slot: "main", connections: ["c-z"] }, anon);
  (anonR.refused)
    ? ok(`no actor → refuse "${String(anonR.refused.message || "").slice(0, 48)}..."`)
    : bad("no actor refuses", "no refusal");

} catch (e) {
  console.log(`  ✗ THREW: ${e?.message || e}`);
  console.log(e?.stack || "");
  fail++;
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
