#!/usr/bin/env node
// set-matter, LIVE via doVerb with ZERO stubs. Drives the REAL set-matter op (handler today; this
// is the GROUND-TRUTH harness that proves behavior-preservation when set-matter converts to
// set-matter.word). Proves: each field write lands ONE do:set-matter fact carrying
// { field, value(, merge) } on the MATTER reel, the @matter fold reflects it, and the refuses
// carry their messages. Full begin.js boot. Scratch DB, wiped.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = "mongodb://localhost:27017/story_word_setmatter_cut";
process.env.PORT = "3795";
process.env.MONGODB_URI = SCRATCH_DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "setmatter-secret-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "setmattercut-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "setmattercut-src");
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

const { loadOrFold } = await import(`${R}/seed/materials/projections.js`);
const { sealFacts } = await import(`${R}/seed/past/fact/facts.js`);
const { I } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { doVerb } = await import(`${R}/seed/ibp/verbs/do.js`);
const { getSpaceRootId } = await import(`${R}/seed/sprout.js`);

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

async function doOp(target, op, params) {
  const sc = {
    actId: randomUUID(),
    actorAct: { history: "0", by: "i-am" },
    identity: ident,
    deltaF: [],
    foldedSeqs: new Map(),
    afterSeal: [],
  };
  try {
    const res = await doVerb(target, op, params, { identity: ident, moment: sc, currentHistory: "0" });
    if (sc.deltaF.length) await sealFacts(sc.deltaF);
    return { result: res?.result ?? res, deltaF: sc.deltaF, refused: null };
  } catch (e) {
    return { result: null, deltaF: sc.deltaF, refused: e };
  }
}
const setFact = (deltaF) => (deltaF || []).find((f) => f.act === "set-matter");

console.log(
  `\n  verify-setmatter-cut (REAL set-matter op via doVerb)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`,
);
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

  // a space + a matter to write on
  const sp = await doOp({ kind: "space", id: String(rootId) }, "create-space", {
    name: "matterroom",
    size: { x: 50, y: 50 },
  });
  const spaceId = sp.result?.spaceId || sp.result?._factTarget?.id;
  const mk = await doOp({ kind: "space", id: String(spaceId) }, "create-matter", { name: "doc" });
  const matterId = mk.result?.matterId || mk.result?._factTarget?.id || null;
  matterId
    ? ok(`created matter "doc" in matterroom → ${String(matterId).slice(0, 8)}`)
    : bad("create-matter", mk.refused?.message || mk.result);
  const target = { kind: "matter", id: String(matterId) };

  // ── 1. name ──
  const a = await doOp(target, "set-matter", { field: "name", value: "renamed" });
  const fa = setFact(a.deltaF);
  fa && fa.params?.field === "name" && fa.params?.value === "renamed"
    ? ok(`set name=renamed → one do:set-matter { field, value }`)
    : bad("name fact", a.refused?.message || (a.deltaF || []).map((f) => `${f.act}:${f.params?.field}`));
  {
    const slot = await loadOrFold("matter", String(matterId), "0");
    slot?.state?.name === "renamed" ? ok("@matter fold: name=renamed") : bad("name fold", slot?.state?.name);
  }

  // ── 2. qualities namespace (object) ──
  const b = await doOp(target, "set-matter", { field: "qualities.app", value: { tag: "x" } });
  const fb = setFact(b.deltaF);
  fb && fb.params?.field === "qualities.app" && fb.params?.value?.tag === "x"
    ? ok(`set qualities.app={tag:x} → do:set-matter carries the namespace object`)
    : bad("qualities fact", b.refused?.message || fb?.params);
  {
    const slot = await loadOrFold("matter", String(matterId), "0");
    slot?.state?.qualities?.app?.tag === "x"
      ? ok("@matter fold: qualities.app.tag=x")
      : bad("qualities fold", slot?.state?.qualities?.app);
  }

  // ── 3. deep qualities path (merges) ──
  const c = await doOp(target, "set-matter", { field: "qualities.app.n", value: 2 });
  const fc = setFact(c.deltaF);
  fc && fc.params?.field === "qualities.app.n" && fc.params?.value === 2
    ? ok(`set qualities.app.n=2 → do:set-matter deep path`)
    : bad("deep fact", c.refused?.message || fc?.params);
  {
    const slot = await loadOrFold("matter", String(matterId), "0");
    slot?.state?.qualities?.app?.n === 2 && slot?.state?.qualities?.app?.tag === "x"
      ? ok("@matter fold: deep set merged (n=2, tag still x)")
      : bad("deep fold", slot?.state?.qualities?.app);
  }

  // ── 4. coord (in-bounds of the 50x50 space) ──
  const d = await doOp(target, "set-matter", { field: "coord", value: { x: 5, y: 6 } });
  const fd = setFact(d.deltaF);
  fd && fd.params?.field === "coord" && fd.params?.value?.x === 5
    ? ok(`set coord={x:5,y:6} → do:set-matter`)
    : bad("coord fact", d.refused?.message || fd?.params);

  // ── 5. refuse: no field ──
  const e = await doOp(target, "set-matter", { value: "x" });
  e.refused && /field.*required/i.test(e.refused.message) && !setFact(e.deltaF)
    ? ok(`no field → refuse "field is required", NO fact`)
    : bad("no-field refuse", e.refused?.message || e.result);

  // ── 6. refuse: beingId non-DELETED (creator fixed at birth) ──
  const g = await doOp(target, "set-matter", { field: "beingId", value: "someone" });
  g.refused && /beingId|DELETED|fixed at birth/i.test(g.refused.message) && !setFact(g.deltaF)
    ? ok(`beingId=<non-DELETED> → refuse (creator fixed at birth), NO fact`)
    : bad("beingId refuse", g.refused?.message || g.result);

  // ── 7. refuse: unknown field ──
  const h = await doOp(target, "set-matter", { field: "bogus", value: 1 });
  h.refused && /unknown field/i.test(h.refused.message) && !setFact(h.deltaF)
    ? ok(`unknown field → refuse "unknown field", NO fact`)
    : bad("unknown-field refuse", h.refused?.message || h.result);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
