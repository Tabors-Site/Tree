#!/usr/bin/env node
// verify-substrate-see — boots the full system and confirms the see-sweep on the four
// substrate .words (move, set-render, portal, matter) is live: a clean genesis boot proves
// all four parse + register (a malformed .word fails boot), and a real create-matter drive
// exercises matter.word's `see resolve-birth-spec` end to end through the see-op runner.
// move/set-render/form-portal use the SAME runner (construction-verified: parse -> see:<op>,
// env key renamed to match); a dedicated behavior cut per op is a 7.md follow-up.
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = "mongodb://localhost:27017/story_word_substratesee";
process.env.PORT = "3799";
process.env.MONGODB_URI = SCRATCH_DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "substratesee-secret-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "substratesee-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "substratesee-src");
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
const { I_AM } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { getSpaceRootId } = await import(`${R}/seed/sprout.js`);
const { doVerb } = await import(`${R}/seed/ibp/verbs/do.js`);

let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d !== undefined) console.log(`      ${typeof d === "string" ? d : JSON.stringify(d)}`); };
const poll = async (fn, t = 60000, e = 250) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, e)); } return null; };
const ident = { beingId: I_AM, name: "i-am", nameId: "i-am" };

async function drive(target, op, params) {
  const sc = { actId: randomUUID(), actorAct: { history: "0", by: "i-am" }, identity: ident, deltaF: [], foldedSeqs: new Map(), afterSeal: [] };
  try {
    const res = await doVerb(target, op, params, { identity: ident, moment: sc });
    if (sc.deltaF.length) await sealFacts(sc.deltaF);
    return { result: res?.result ?? res, deltaF: sc.deltaF, refused: null };
  } catch (e) { if (e && (e.name === "IbpError" || e.code)) return { result: null, deltaF: sc.deltaF, refused: e }; throw e; }
}

console.log(`\n  verify-substrate-see (boot-load of move/set-render/portal/matter + a live create-matter)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`);
try {
  // ── 1. clean genesis boot → all four converted .words parsed + registered (a malformed
  //       .word would have failed begin.js above). ──
  const cherub = await poll(() => findByName("being", "cherub", "0"));
  cherub ? ok(`genesis booted with the 4 converted .words loaded (cherub present)`) : bad(`genesis`, "no cherub — a converted .word failed to load");
  if (!cherub) { console.log(`\n  ${pass} passed, ${fail} failed`); process.exit(1); }
  const root = String(getSpaceRootId());

  // ── 2. create-matter LIVE → matter.word's `see resolve-birth-spec` dispatches through the
  //       see-op runner, then the held emitBirth lays the do:create-matter fact. ──
  const cm = await drive({ kind: "space", id: root }, "create-matter", { name: "note-see", content: "hello from the see-sweep" });
  cm.result?.matterId && cm.result?.spaceId === root
    ? ok(`create-matter → matterId ${String(cm.result.matterId).slice(0, 12)}…, spaceId=root (see:resolve-birth-spec dispatched, emitBirth laid)`)
    : bad(`create-matter`, cm.refused?.message || cm.result);

  // ── 3. the do:create-matter fact landed (the held emitBirth still emits). ──
  (cm.deltaF || []).some((f) => f.act === "create-matter")
    ? ok(`one do:create-matter fact on the reel`)
    : bad(`create-matter fact`, (cm.deltaF || []).map((f) => f.act));

  // ── 4. the matter folds into the space (the conversion is behavior-preserving). ──
  const m = await loadOrFold("matter", String(cm.result?.matterId), "0");
  m?.state?.name
    ? ok(`@matter folds: name="${m.state.name}" (the birth spec resolved + wrote through)`)
    : bad(`matter fold`, m?.state);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  console.log(`  (move/set-render/form-portal: construction-verified — parse→see:<op>, env key renamed to match,`);
  console.log(`   same see-op runner; dedicated behavior cuts are a 7.md follow-up.)`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
