#!/usr/bin/env node
// delete-llm-connection (delete-llm-connection.word), LIVE through the bridge. The host see
// resolve-connection-removal (connect.js resolveConnectionRemoval: confirm exists, bake the
// unset) is the floor; the dispatcher lays ONE do:set-being fact (value:null), no skipAudit,
// no self-emit. Proves: a REAL delete via doVerb runs the .word, lands ONE unset fact (the
// slot-clears run-on is DROPPED), the connection folds away, and the isFirst-liveness holds
// (delete the main conn → a re-add auto-assigns to main, the dangling main folds to empty).
// Seeds via add (E6 resolveConnectionSpec). Full begin.js boot. Scratch DB.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = "mongodb://localhost:27017/story_word_deletellm_cut";
process.env.PORT = "3796";
process.env.MONGODB_URI = SCRATCH_DB;
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "deletellm-secret-0123456789";
process.env.STORY_KEY_DIR = path.join(
  os.tmpdir(),
  "deletellmcut-keys-" + process.pid,
);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "deletellmcut-src");
fs.rmSync(SRC, { recursive: true, force: true });
fs.mkdirSync(SRC, { recursive: true });
fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;
process.env.CUSTOM_LLM_API_SECRET_KEY =
  process.env.CUSTOM_LLM_API_SECRET_KEY ||
  "deletellm-llm-encryption-key-0123456789";

{
  const mongoose = (await import(`${R}/node_modules/mongoose/index.js`))
    .default;
  const conn = await mongoose.createConnection(SCRATCH_DB).asPromise();
  await conn.dropDatabase();
  await conn.close();
}

await import(`${R}/begin.js`);

const { findByName, loadOrFold } = await import(
  `${R}/seed/materials/projections.js`
);
const { sealFacts } = await import(`${R}/seed/past/fact/facts.js`);
const { I } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { doVerb } = await import(`${R}/seed/ibp/verbs/do.js`);
const { resolveAbleWord } = await import(
  `${R}/seed/present/word/ableWordRegistry.js`
);

let pass = 0,
  fail = 0;
const ok = (l) => {
  pass++;
  console.log(`  ✓ ${l}`);
};
const bad = (l, d) => {
  fail++;
  console.log(`  ✗ ${l}`);
  if (d !== undefined)
    console.log(`      ${typeof d === "string" ? d : JSON.stringify(d)}`);
};
const poll = async (fn, t = 60000, e = 250) => {
  const t0 = Date.now();
  while (Date.now() - t0 < t) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, e));
  }
  return null;
};
const ident = { beingId: I, name: "i-am", nameId: "i-am" };

const cherub = await poll(() => findByName("being", "cherub", "0"));
const did = async (op, target, params, who = ident) => {
  const sc = {
    actId: randomUUID(),
    actorAct: { history: "0", by: who?.nameId || null },
    identity: who,
    deltaF: [],
    foldedSeqs: new Map(),
    afterSeal: [],
  };
  try {
    const res = await doVerb(target, op, params, {
      identity: who,
      moment: sc,
      currentHistory: "0",
    });
    if (sc.deltaF.length) await sealFacts(sc.deltaF);
    for (const cb of sc.afterSeal || []) {
      try {
        await cb();
      } catch {}
    }
    return { result: res?.result ?? res, deltaF: sc.deltaF, refused: null };
  } catch (e) {
    for (const cb of sc.afterSeal || []) {
      try {
        await cb();
      } catch {}
    }
    if (e && (e.name === "IbpError" || e.code))
      return { result: null, deltaF: sc.deltaF, refused: e };
    throw e;
  }
};
const being = async () => (await loadOrFold("being", String(I), "0"))?.state;
const conns = (st) => {
  const q = st?.qualities;
  const c = q instanceof Map ? q.get("llmConnections") : q?.llmConnections;
  return c instanceof Map ? Object.fromEntries(c) : c || {};
};
const mainSlot = (st) => {
  const q = st?.qualities;
  const m = q instanceof Map ? q.get("beingLlm") : q?.beingLlm;
  return m?.slots?.main;
};

console.log(
  `\n  verify-deletellm-cut (REAL delete-llm-connection op via doVerb → the cut)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`,
);
try {
  if (!cherub) {
    console.log("  FATAL: genesis failed");
    process.exit(1);
  }
  const { setStoryConfigValue } = await import(`${R}/seed/storyConfig.js`);
  await setStoryConfigValue("allowedLlmDomains", ["example.com"], {
    identity: ident,
  });

  resolveAbleWord("being", "delete-llm-connection")
    ? ok(`delete-llm-connection.word resolves through the bridge`)
    : bad(`resolves`, "null");

  const T = { kind: "being", id: String(I) };
  const addA = await did("add-llm-connection", T, {
    name: "A",
    baseUrl: "https://example.com/a",
    model: "m",
    apiKey: "sk-a",
  });
  const idA = addA.result?.connection?._id;
  idA
    ? ok(`seeded conn A (auto-assigned to main): ${String(idA).slice(0, 8)}…`)
    : bad(`add A`, addA.refused?.message || addA.result);
  // Point main at A directly (its own sealed moment). The add op's auto-assign relies on a
  // mid-moment read this harness can't seal — not what we test here; we test delete + the fold.
  await did("set-being", T, {
    field: `qualities.beingLlm.slots.main`,
    value: idA,
  });
  mainSlot(await being()) === idA
    ? ok(`main → A (seeded directly)`)
    : bad(`set main`, mainSlot(await being()));

  // ── 1. delete A through the .word → exactly ONE do:set-being fact (slot-clears DROPPED) ──
  const del = await did("delete-llm-connection", T, { connectionId: idA });
  const sf = (del.deltaF || []).filter((f) => f.act === "set-being");
  del.result && sf.length === 1
    ? ok(
        `delete → exactly ONE do:set-being fact (slot-clears run-on dropped; no 2nd slot fact)`,
      )
    : bad(
        `one-fact`,
        del.refused?.message || { facts: sf.length, result: del.result },
      );

  // ── 2. the fact unsets the connection (value:null at the right path) ──
  const f = sf[0];
  f &&
  f.params?.field === `qualities.llmConnections.${idA}` &&
  f.params?.value === null &&
  String(f.through) === String(I)
    ? ok(
        `do:set-being: field = llmConnections.<id>, value = null (unset), through = caller`,
      )
    : bad(
        `fact`,
        f ? { field: f.params?.field, value: f.params?.value } : "no fact",
      );

  // ── 3. the connection folds away ──
  const after = await being();
  !conns(after)[idA]
    ? ok(`@being folds: connection A is gone (the leaf deleted)`)
    : bad(`fold`, conns(after)[idA]);

  // ── 4. main still points at the dead A (dangling — slot-clears DROPPED, not eagerly cleared) ──
  mainSlot(after) === idA
    ? ok(
        `main still points at the deleted A (dangling — slot-clears run-on dropped, the spacebar)`,
      )
    : bad(`dangling`, mainSlot(after));

  // ── 5. isFirst-liveness: the dangling main folds to empty → resolveConnectionSpec.isFirst = true ──
  const { resolveConnectionSpec } = await import(
    `${R}/seed/present/cognition/llm/connect.js`
  );
  const spec = await resolveConnectionSpec(
    String(I),
    { name: "C", baseUrl: "https://example.com/c", model: "m", apiKey: "sk-c" },
    { moment: { actorAct: { history: "0" } } },
  );
  spec.isFirst === true
    ? ok(
        `isFirst-liveness: dangling main folds to empty (so a re-add auto-assigns to main)`,
      )
    : bad(`isFirst`, spec.isFirst);

  // ── 6. no-actor gate refuses ──
  const n = await did("delete-llm-connection", T, { connectionId: idA }, {});
  n.refused
    ? ok(`no actor → refuse "${n.refused.message?.slice(0, 44)}..."`)
    : bad(`actor gate`, n.result);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
