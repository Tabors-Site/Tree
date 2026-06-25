#!/usr/bin/env node
// set-space (set-space.word), LIVE through the bridge with ZERO stubs. The CONTROL strand (the
// `field`-required gate + the return) is .word; the substrate READS + read-after-write hygiene
// (name availability, heaven-row immutability, coord-bounds, size cap, ancestor-cache invalidate)
// are the host see-op resolve-set-space-spec (setSpaceHost.js). Proves: each field write lands ONE
// do:set-space fact carrying { field, value(, merge) } on the SPACE reel, the @space fold reflects
// it, and the refuses carry their messages. Drives the REAL set-space op via doVerb → runOpWord.
// Full begin.js boot. Scratch DB, wiped.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = path.join(os.tmpdir(), "story_word_setspace_cut-" + process.pid);
process.env.PORT = "3793";
process.env.TREEOS_STORE_BASE = SCRATCH_DB;
fs.rmSync(SCRATCH_DB, { recursive: true, force: true });
process.env.JWT_SECRET = process.env.JWT_SECRET || "setspace-secret-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "setspacecut-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "setspacecut-src");
fs.rmSync(SRC, { recursive: true, force: true });
fs.mkdirSync(SRC, { recursive: true });
fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;

// (scratch file store fresh-wiped above; no DB to drop)

await import(`${R}/begin.js`);

const { loadOrFold } = await import(`${R}/seed/materials/projections.js`);
const { sealFacts } = await import(`${R}/seed/past/fact/facts.js`);
const { I } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { doVerb } = await import(`${R}/seed/ibp/verbs/do.js`);
const { getSpaceRootId } = await import(`${R}/seed/sprout.js`);
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

// Run any DO op in a fresh moment, seal its deltaF, return { result, deltaF, refused }.
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
    // Any throw from the op is a refusal outcome here — IbpError (a .word `refuse`) OR a plain
    // Error (a host gate throw, e.g. unknown field), both of which the handler also threw raw.
    return { result: null, deltaF: sc.deltaF, refused: e };
  }
}
// The lone do:set-space fact in a deltaF (the auto-Fact the dispatcher stamped).
const setFact = (deltaF) => (deltaF || []).find((f) => f.act === "set-space");

console.log(
  `\n  verify-setspace-cut (REAL set-space op via doVerb → runOpWord → set-space.word)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`,
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

  resolveAbleWord("space", "set-space")
    ? ok("set-space.word resolves through the bridge (self-registered)")
    : bad("resolves", "null");

  // a fresh space to write on
  const made = await doOp({ kind: "space", id: String(rootId) }, "create-space", {
    name: "alpha",
    size: { x: 50, y: 50 },
  });
  const spaceId = made.result?.spaceId || made.result?._factTarget?.id || null;
  spaceId
    ? ok(`created space "alpha" under root → ${String(spaceId).slice(0, 8)}`)
    : bad("create", made.refused?.message || made.result);
  const target = { kind: "space", id: String(spaceId) };

  // ── 1. set type → one do:set-space fact { field:"type", value } ──
  const a = await doOp(target, "set-space", { field: "type", value: "2d" });
  const fa = setFact(a.deltaF);
  fa && fa.params?.field === "type" && fa.params?.value === "2d"
    ? ok(`set type=2d → one do:set-space { field:"type", value:"2d" }`)
    : bad("type fact", a.refused?.message || (a.deltaF || []).map((f) => `${f.act}:${f.params?.field}`));
  {
    const slot = await loadOrFold("space", String(spaceId), "0");
    slot?.state?.type === "2d" ? ok("@space fold: type=2d") : bad("type fold", slot?.state?.type);
  }

  // ── 2. set a qualities namespace (object, merge default) ──
  const b = await doOp(target, "set-space", {
    field: "qualities.app",
    value: { theme: "dark" },
  });
  const fb = setFact(b.deltaF);
  fb && fb.params?.field === "qualities.app" && fb.params?.value?.theme === "dark"
    ? ok(`set qualities.app={theme:dark} → do:set-space carries the namespace object`)
    : bad("qualities fact", b.refused?.message || fb?.params);
  {
    const slot = await loadOrFold("space", String(spaceId), "0");
    slot?.state?.qualities?.app?.theme === "dark"
      ? ok("@space fold: qualities.app.theme=dark")
      : bad("qualities fold", slot?.state?.qualities?.app);
  }

  // ── 3. set a deep qualities path ──
  const c = await doOp(target, "set-space", {
    field: "qualities.app.lang",
    value: "en",
  });
  const fc = setFact(c.deltaF);
  fc && fc.params?.field === "qualities.app.lang" && fc.params?.value === "en"
    ? ok(`set qualities.app.lang=en → do:set-space deep path`)
    : bad("deep fact", c.refused?.message || fc?.params);
  {
    const slot = await loadOrFold("space", String(spaceId), "0");
    slot?.state?.qualities?.app?.lang === "en" && slot?.state?.qualities?.app?.theme === "dark"
      ? ok("@space fold: deep set merged (lang=en, theme still dark)")
      : bad("deep fold", slot?.state?.qualities?.app);
  }

  // ── 4. set coord (bounds-checked against parent root size) ──
  const d = await doOp(target, "set-space", { field: "coord", value: { x: 3, y: 4 } });
  const fd = setFact(d.deltaF);
  fd && fd.params?.field === "coord" && fd.params?.value?.x === 3
    ? ok(`set coord={x:3,y:4} → do:set-space`)
    : bad("coord fact", d.refused?.message || fd?.params);

  // ── 5. set size ──
  const e = await doOp(target, "set-space", { field: "size", value: { x: 20, y: 20 } });
  const fe = setFact(e.deltaF);
  fe && fe.params?.field === "size" && fe.params?.value?.x === 20
    ? ok(`set size={x:20,y:20} → do:set-space`)
    : bad("size fact", e.refused?.message || fe?.params);

  // ── 6. refuse: no field ──
  const g = await doOp(target, "set-space", { value: "x" });
  g.refused && /field.*required/i.test(g.refused.message) && !setFact(g.deltaF)
    ? ok(`no field → refuse "field is required", NO fact`)
    : bad("no-field refuse", g.refused?.message || g.result);

  // ── 7. refuse: unknown field ──
  const h = await doOp(target, "set-space", { field: "bogus", value: 1 });
  h.refused && /unknown field/i.test(h.refused.message) && !setFact(h.deltaF)
    ? ok(`unknown field → refuse "unknown field", NO fact`)
    : bad("unknown-field refuse", h.refused?.message || h.result);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
