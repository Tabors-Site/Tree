#!/usr/bin/env node
// purge-content (purge-content.word), LIVE via doVerb with ZERO stubs. WORD-SOLE: the .word's
// CONTROL strand (caller gate + return) + the host see resolve-purge (load + hash resolve +
// author/owner auth + the SHARED-FATE refcount gate + the FACT-FIRST afterSeal content delete).
// Proves: a do:purge-content fact lands carrying { hash, force, referents } on the matter's reel; the
// shared-fate gate refuses without force and passes with it; a content-less matter refuses. (The
// physical deleteContent runs on afterSeal — the full sealAct flow — so this harness asserts the
// FACT + gates, not the byte deletion.) Acts as I. Full begin.js boot. Scratch DB, wiped.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = "mongodb://localhost:27017/story_word_purge_cut";
process.env.PORT = "3799";
process.env.MONGODB_URI = SCRATCH_DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "purge-secret-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "purgecut-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "purgecut-src");
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

const { sealFacts } = await import(`${R}/seed/past/fact/facts.js`);
const { I } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { doVerb } = await import(`${R}/seed/ibp/verbs/do.js`);
const { getSpaceRootId } = await import(`${R}/seed/sprout.js`);
const { putContent } = await import(`${R}/seed/materials/matter/contentStore.js`);
const { resolveAbleWord } = await import(`${R}/seed/present/word/ableWordRegistry.js`);

let pass = 0,
  fail = 0;
const ok = (l) => {
  pass++;
  console.log(`  ✓ ${l}`);
};
const bad = (l, d) => {
  fail++;
  console.log(`  ✗ ${l}`);
  if (d !== undefined) console.log(`      ${typeof d === "string" ? d : JSON.stringify(d)}`);
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

async function doOp(target, op, params, who = ident) {
  const sc = {
    actId: randomUUID(),
    actorAct: { history: "0", by: who?.nameId || "i-am" },
    identity: who,
    deltaF: [],
    foldedSeqs: new Map(),
    afterSeal: [],
  };
  try {
    const res = await doVerb(target, op, params, { identity: who, moment: sc, currentHistory: "0" });
    if (sc.deltaF.length) await sealFacts(sc.deltaF);
    return { result: res?.result ?? res, deltaF: sc.deltaF, refused: null };
  } catch (e) {
    return { result: null, deltaF: sc.deltaF, refused: e };
  }
}
const fact = (deltaF) => (deltaF || []).find((f) => f.act === "purge-content");

console.log(`\n  verify-purgecontent-cut (REAL purge-content via doVerb → runOpWord)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`);
try {
  const rootId = await poll(() => {
    try {
      return getSpaceRootId();
    } catch {
      return null;
    }
  });
  if (!rootId) {
    console.log("  FATAL: genesis failed (no story root)");
    process.exit(1);
  }
  const sp = await doOp({ kind: "space", id: String(rootId) }, "create-space", { name: "purgeroom" });
  const spaceId = sp.result?.spaceId || sp.result?._factTarget?.id;
  const space = { kind: "space", id: String(spaceId) };
  // No owner workaround needed: resolveRootSpace now returns the reality root `/` (heavenSpace=
  // "space-root") instead of throwing "heaven boundary", so an I-authored matter under root purges
  // via the isAuthor gate. (`/` is reality root, NOT heaven `/.` — the fix this test also covers.)

  resolveAbleWord("matter", "purge-content")
    ? ok("purge-content.word resolves through the bridge (self-registered)")
    : bad("resolve", "null");

  // helper: create a matter holding the given CAS ref
  const mkMatter = async (name, ref) => {
    const r = await doOp(space, "create-matter", { name, type: "file", content: ref });
    return r.result?.matterId || r.result?._factTarget?.id || null;
  };

  // ── 1. a matter with UNIQUE content → purge → do:purge-content { hash, referents:0 } ──
  const refA = await putContent("purge-test-unique-" + randomUUID());
  const mA = await mkMatter("docA", refA);
  mA ? ok(`created matter docA with stored content`) : bad("create docA", refA);
  const a = await doOp({ kind: "matter", id: String(mA) }, "purge-content", {});
  const fa = fact(a.deltaF);
  fa && fa.params?.hash === refA.hash && fa.params?.referents === 0 && String(fa.of?.id) === String(mA)
    ? ok(`purge docA → do:purge-content { hash, force:false, referents:0 } on the matter reel`)
    : bad("purge fact", a.refused?.message || (fa && { params: fa.params, of: fa.of }));

  // ── 2. SHARED-FATE: two matter on the SAME bytes → purge one without force → RESOURCE_CONFLICT ──
  const refB = await putContent("purge-test-shared-" + randomUUID());
  const mB1 = await mkMatter("docB1", refB);
  const mB2 = await mkMatter("docB2", refB);
  const b = await doOp({ kind: "matter", id: String(mB1) }, "purge-content", {});
  b.refused && /other matter|deduplicated|force=true/i.test(b.refused.message) && !fact(b.deltaF)
    ? ok(`purge shared bytes (no force) → refuse RESOURCE_CONFLICT, NO fact`)
    : bad("shared refuse", b.refused?.message || b.result);
  void mB2;

  // ── 3. with force → the shared purge passes (referents:1 recorded) ──
  const c = await doOp({ kind: "matter", id: String(mB1) }, "purge-content", { force: true });
  const fc = fact(c.deltaF);
  fc && fc.params?.force === true && fc.params?.referents === 1
    ? ok(`purge shared bytes (force:true) → do:purge-content { force:true, referents:1 }`)
    : bad("force fact", c.refused?.message || (fc && fc.params));

  // ── 4. a content-less matter → refuse "no stored content" ──
  const mEmpty = await doOp(space, "create-matter", { name: "empty" });
  const mE = mEmpty.result?.matterId || mEmpty.result?._factTarget?.id;
  const d = await doOp({ kind: "matter", id: String(mE) }, "purge-content", {});
  d.refused && /no stored content/i.test(d.refused.message) && !fact(d.deltaF)
    ? ok(`content-less matter → refuse "no stored content", NO fact`)
    : bad("no-content refuse", d.refused?.message || d.result);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
