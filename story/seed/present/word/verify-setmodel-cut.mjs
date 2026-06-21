#!/usr/bin/env node
// set-model (model.word), LIVE through the bridge with ZERO stubs. The clear-vs-set fork +
// the modelMatterId gate are .word; assert-may-set-model (the per-kind auth gate),
// resolve-model-block (the content-store snapshot), and write-model / clear-model (the
// set-<kind> param-ENRICHMENT, field/value/merge) are host escapes wired by modelHost.js.
// Proves: a REAL set-model via doVerb runs the .word, ENRICHES params, the auto-fact folds
// qualities.render.model on a being; clear nulls it; a non-owner is refused FORBIDDEN.
// CALLER mode, param-enrichment (NO skipAudit). Full begin.js boot. Scratch DB, wiped.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = "mongodb://localhost:27017/story_word_setmodel_cut";
process.env.PORT = "3801";
process.env.MONGODB_URI = SCRATCH_DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "setmodel-secret-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "setmodelcut-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "setmodelcut-src");
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
const { putContent } = await import(`${R}/seed/materials/matter/contentStore.js`);
const { ensureSkinsSpace } = await import(`${R}/seed/store/words/model/index.js`);

let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d !== undefined) console.log(`      ${typeof d === "string" ? d : JSON.stringify(d)}`); };
const poll = async (fn, t = 60000, e = 250) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, e)); } return null; };
const ident = { beingId: I_AM, name: "i-am", nameId: "i-am" };

const cherub = await poll(() => findByName("being", "cherub", "0"));

// birth a being as a fresh body to dress (parented to cherub, like grantrole-cut)
const birth = async (name) => {
  let bid = null;
  await withIAmAct(`birth ${name}`, async (ctx) => {
    const b = await birthBeing({ spec: { name, parentBeingId: cherub.id, homeId: cherub.state?.homeSpace, cognition: "scripted", defaultRole: "global" }, identity: I_AM, moment: ctx, branch: "0" });
    bid = b.beingId;
  });
  return bid;
};

// run a DO op through doVerb in a real moment (the cut path), threading branch "0".
const doOp = async (target, op, params, who = ident) => {
  const sc = { actId: randomUUID(), actorAct: { branch: "0", history: "0", by: who?.nameId || null }, identity: who, deltaF: [], foldedSeqs: new Map(), afterSeal: [] };
  try {
    const res = await doVerb(target, op, params, { identity: who, moment: sc, currentHistory: "0" });
    if (sc.deltaF.length) await sealFacts(sc.deltaF);
    return { result: res?.result ?? res, deltaF: sc.deltaF, refused: null };
  } catch (e) { if (e && (e.name === "IbpError" || e.code)) return { result: null, deltaF: sc.deltaF, refused: e }; throw e; }
};

console.log(`\n  verify-setmodel-cut (REAL set-model op via doVerb → the cut)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`);
try {
  if (!cherub) { console.log("  FATAL: genesis failed"); process.exit(1); }
  resolveRoleWord("render", "set-model", "0") ? ok(`model.word resolves through the bridge (self-registered)`) : bad(`resolves`, "null");

  // ── the skins catalog space (ensureSkinsSpace ran at genesis; resolve/ensure it) ──
  const skins = await ensureSkinsSpace("0", null);
  skins ? ok(`skins space resolves: ${String(skins).slice(0, 8)}…`) : bad(`skins`, "no skins space");

  // ── upload a model matter: putContent .glb-ish bytes → cas ref, then create-matter ──
  const bytes = Buffer.from("glTF\x02\x00\x00\x00setmodel-cut-test-bytes", "binary");
  const ref = await putContent(bytes, { encoding: "binary", mimeType: "model/gltf-binary", name: "body.glb" });
  const cm = await doOp({ kind: "space", id: String(skins) }, "create-matter", { type: "model", content: ref });
  const modelMatterId = cm.result?.matterId || null;
  modelMatterId
    ? ok(`upload: create-matter {type:model} → matterId ${String(modelMatterId).slice(0, 8)}… in /skins`)
    : bad(`upload`, cm.refused?.message || cm.result);

  // ── 1. set-model on a freshly-birthed being (the actor sets its OWN body) ──
  const me = await birth("modelbearer");
  const meIdent = { beingId: String(me), name: "modelbearer", nameId: "modelbearer" };
  const s = await doOp({ kind: "being", id: String(me) }, "set-model", { modelMatterId }, meIdent);
  // the .word's §7 returns the lean {set:true}; the resolved model block is proven by the
  // enriched fact (test 2) + the fold (test 3) below.
  s.result?.set === true
    ? ok(`set-model {modelMatterId} → set:true (the .word assert-may-set-model + resolve-model-block + write-model ran)`)
    : bad(`set`, s.refused?.message || s.result);

  // ── 2. the set-model auto-fact carries the ENRICHED params (field/value/merge) ──
  const sf = (s.deltaF || []).find((f) => f.act === "set-model");
  sf && sf.params?.field === "qualities.render" && sf.params?.value?.model?.matterId === String(modelMatterId) && sf.params?.merge === true
    ? ok(`the set-model fact carries field="qualities.render", value.model + merge:true (the .word param-enrichment reached the auto-fact)`)
    : bad(`fact params`, sf?.params);

  // ── 3. the being's qualities.render.model folds {matterId,hash,url} ──
  const slot = await loadOrFold("being", String(me), "0");
  const model = slot?.state?.qualities?.render?.model;
  model && String(model.matterId) === String(modelMatterId) && typeof model.hash === "string" && model.url === `/api/v1/content/${model.hash}`
    ? ok(`@being qualities.render.model folds {matterId, hash, url:"${model.url.slice(0, 24)}…"} — the body is worn`)
    : bad(`fold`, slot?.state?.qualities?.render);

  // ── 4. set-model {clear:true} → the model is nulled ──
  const c = await doOp({ kind: "being", id: String(me) }, "set-model", { clear: true }, meIdent);
  c.result?.cleared === true
    ? ok(`set-model {clear:true} → cleared:true (the .word clear fork + clear-model ran)`)
    : bad(`clear result`, c.refused?.message || c.result);
  const cf = (c.deltaF || []).find((f) => f.act === "set-model");
  cf && cf.params?.field === "qualities.render.model" && cf.params?.value === null && cf.params?.merge === false
    ? ok(`the clear fact carries field="qualities.render.model", value:null, merge:false`)
    : bad(`clear fact`, cf?.params);
  const slot2 = await loadOrFold("being", String(me), "0");
  (slot2?.state?.qualities?.render?.model == null)
    ? ok(`@being qualities.render.model cleared (folded to ${String(slot2?.state?.qualities?.render?.model)})`)
    : bad(`clear fold`, slot2?.state?.qualities?.render);

  // ── 5. a non-owner setting a model on SOMEONE ELSE's being → refuse FORBIDDEN ──
  const other = await birth("other-body");
  const stranger = await birth("stranger");
  const strangerIdent = { beingId: String(stranger), name: "stranger", nameId: "stranger" };
  const n = await doOp({ kind: "being", id: String(other) }, "set-model", { modelMatterId }, strangerIdent);
  n.refused && n.refused.code === "FORBIDDEN"
    ? ok(`non-owner set-model on another's being → refuse [FORBIDDEN] "${(n.refused.message || "").slice(0, 48)}…"`)
    : bad(`owner gate`, n.refused ? { code: n.refused.code, message: n.refused.message } : n.result);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
