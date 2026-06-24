#!/usr/bin/env node
// set-being (set-being.word), LIVE through the bridge with ZERO stubs. The CONTROL strand (the
// `field`-required gate + the return) is .word; the substrate READS (load the being row, name
// uniqueness, coord-bounds) are the host see-op resolve-set-being-spec (setBeingHost.js). Proves:
// each field write lands ONE do:set-being fact carrying { field, value(, merge) } on the BEING
// reel, the @being fold reflects it, and the refuses carry their messages. Drives the REAL
// set-being op via doVerb → runOpWord. Full begin.js boot. Scratch DB, wiped.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = "mongodb://localhost:27017/story_word_setbeing_cut";
process.env.PORT = "3794";
process.env.MONGODB_URI = SCRATCH_DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "setbeing-secret-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "setbeingcut-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "setbeingcut-src");
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
const { I } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { doVerb } = await import(`${R}/seed/ibp/verbs/do.js`);
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
    const res = await doVerb(target, op, params, {
      identity: ident,
      moment: sc,
      currentHistory: "0",
    });
    if (sc.deltaF.length) await sealFacts(sc.deltaF);
    return { result: res?.result ?? res, deltaF: sc.deltaF, refused: null };
  } catch (e) {
    // Any throw is a refusal outcome: IbpError (a .word `refuse`) OR a plain Error (a host gate).
    return { result: null, deltaF: sc.deltaF, refused: e };
  }
}
const setFact = (deltaF) => (deltaF || []).find((f) => f.act === "set-being");

console.log(
  `\n  verify-setbeing-cut (REAL set-being op via doVerb → runOpWord → set-being.word)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`,
);
try {
  const cherub = await poll(() => findByName("being", "cherub", "0"));
  if (!cherub) {
    console.log("  FATAL: genesis failed (no cherub being)");
    process.exit(1);
  }
  const target = { kind: "being", id: String(cherub.id) };

  resolveAbleWord("being", "set-being")
    ? ok("set-being.word resolves through the bridge (self-registered)")
    : bad("resolves", "null");

  // ── 1. scalar: defaultAble ──
  const a = await doOp(target, "set-being", { field: "defaultAble", value: "greeter" });
  const fa = setFact(a.deltaF);
  fa && fa.params?.field === "defaultAble" && fa.params?.value === "greeter"
    ? ok(`set defaultAble=greeter → one do:set-being { field, value }`)
    : bad("defaultAble fact", a.refused?.message || (a.deltaF || []).map((f) => `${f.act}:${f.params?.field}`));
  {
    const slot = await loadOrFold("being", String(cherub.id), "0");
    slot?.state?.defaultAble === "greeter"
      ? ok("@being fold: defaultAble=greeter")
      : bad("defaultAble fold", slot?.state?.defaultAble);
  }

  // ── 2. qualities namespace (object) ──
  const b = await doOp(target, "set-being", { field: "qualities.app", value: { theme: "dark" } });
  const fb = setFact(b.deltaF);
  fb && fb.params?.field === "qualities.app" && fb.params?.value?.theme === "dark"
    ? ok(`set qualities.app={theme:dark} → do:set-being carries the namespace object`)
    : bad("qualities fact", b.refused?.message || fb?.params);
  {
    const slot = await loadOrFold("being", String(cherub.id), "0");
    slot?.state?.qualities?.app?.theme === "dark"
      ? ok("@being fold: qualities.app.theme=dark")
      : bad("qualities fold", slot?.state?.qualities?.app);
  }

  // ── 3. deep qualities path (merges) ──
  const c = await doOp(target, "set-being", { field: "qualities.app.lang", value: "en" });
  const fc = setFact(c.deltaF);
  fc && fc.params?.field === "qualities.app.lang" && fc.params?.value === "en"
    ? ok(`set qualities.app.lang=en → do:set-being deep path`)
    : bad("deep fact", c.refused?.message || fc?.params);
  {
    const slot = await loadOrFold("being", String(cherub.id), "0");
    slot?.state?.qualities?.app?.lang === "en" && slot?.state?.qualities?.app?.theme === "dark"
      ? ok("@being fold: deep set merged (lang=en, theme still dark)")
      : bad("deep fold", slot?.state?.qualities?.app);
  }

  // ── 4. parentBeingId = null (clear) ──
  const d = await doOp(target, "set-being", { field: "parentBeingId", value: null });
  const fd = setFact(d.deltaF);
  fd && fd.params?.field === "parentBeingId" && fd.params?.value === null
    ? ok(`set parentBeingId=null → do:set-being { value:null }`)
    : bad("parent fact", d.refused?.message || fd?.params);

  // ── 5. refuse: no field ──
  const e = await doOp(target, "set-being", { value: "x" });
  e.refused && /field.*required/i.test(e.refused.message) && !setFact(e.deltaF)
    ? ok(`no field → refuse "field is required", NO fact`)
    : bad("no-field refuse", e.refused?.message || e.result);

  // ── 6. refuse: reserved namespace (inbox has its own verb) ──
  const g = await doOp(target, "set-being", { field: "qualities.inbox", value: { x: 1 } });
  g.refused && /inbox|not writable|dedicated verb/i.test(g.refused.message) && !setFact(g.deltaF)
    ? ok(`qualities.inbox → refuse (reserved namespace), NO fact`)
    : bad("reserved refuse", g.refused?.message || g.result);

  // ── 7. refuse: unknown field ──
  const h = await doOp(target, "set-being", { field: "bogus", value: 1 });
  h.refused && /unknown field/i.test(h.refused.message) && !setFact(h.deltaF)
    ? ok(`unknown field → refuse "unknown field", NO fact`)
    : bad("unknown-field refuse", h.refused?.message || h.result);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
