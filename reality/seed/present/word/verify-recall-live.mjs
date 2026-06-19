#!/usr/bin/env node
// RECALL (the sixth verb) LIVE: reach back across TIME into a chain. Reading a thread lays NO
// fact (own = recalled; the world + any other thread = saw, all public). The VERDICT — `recall <X>
// that <Y> because <Z>` — is the only thing that writes: a do:verdict memory-fact carrying the
// conclusion AND the declared why (the being's authored account of its reasoning, NOT the live
// inference, which stays silent). The being's own chain is its memory. Proves read→reflect→
// record, on a FRESH being (idle chain) so the verdict doesn't fork I_AM's busy genesis chain.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = "mongodb://localhost:27017/reality_recall";
process.env.PORT = "3813";
process.env.MONGODB_URI = SCRATCH_DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "recall-secret-0123456789";
process.env.REALITY_KEY_DIR = path.join(os.tmpdir(), "recall-keys-" + process.pid);
fs.rmSync(process.env.REALITY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "recall-src");
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

const { findByName } = await import(`${R}/seed/materials/projections.js`);
const { sealFacts } = await import(`${R}/seed/past/fact/facts.js`);
const { withIAmAct, withBeingAct } = await import(`${R}/seed/sprout.js`);
const { I_AM } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { birthBeing } = await import(`${R}/seed/materials/being/identity/birth.js`);
const { evaluate } = await import(`${R}/seed/present/word/evaluator.js`);
const { assembleStory } = await import(`${R}/seed/present/book/assemble.js`);

let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d !== undefined) console.log(`      ${typeof d === "string" ? d : JSON.stringify(d)}`); };
const poll = async (fn, t = 60000, e = 250) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, e)); } return null; };

console.log(`\n  verify-recall-live (reach back across time; the verdict is the only fact)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`);
try {
  const cherub = await poll(() => findByName("being", "cherub", "0"));
  if (!cherub) { console.log("  FATAL: genesis failed"); process.exit(1); }
  await new Promise((r) => setTimeout(r, 1500));

  // a FRESH being — its chain is idle, so its verdict won't fork I_AM's busy genesis chain
  let sageId = null, sageName = null;
  await withIAmAct("birth sage", async (m) => {
    const b = await birthBeing({ spec: { name: "sage", parentBeingId: cherub.id, homeId: cherub.state?.homeSpace, cognition: "scripted", defaultRole: "global" }, identity: I_AM, moment: m, branch: "0" });
    sageId = b.beingId; sageName = b.name;
  });
  await new Promise((r) => setTimeout(r, 1500)); // let sage's birth + grants settle
  const ident = { beingId: String(sageId), nameId: String(sageId), name: sageName || "sage" };
  const reader = () => ({ dryRun: false, branch: "0", identity: ident, bindings: {}, deltaF: [], flows: [] });

  // 1. recall your OWN thread → recalled; binds the WOVEN view (the story in the Word); NO fact
  const c1 = reader(); await evaluate({ kind: "recall", of: String(sageId), as: "mine" }, c1);
  (Array.isArray(c1.bindings.mine) && c1.bindings.mine.length > 0 && c1.bindings.mine[0]?.line && c1.deltaF.length === 0)
    ? ok(`recall my own thread → recalled (${c1.bindings.mine.length} acts, woven in the Word), NO fact laid`)
    : bad(`recall own`, { len: c1.bindings.mine?.length, line: c1.bindings.mine?.[0]?.line, laid: c1.deltaF.length });

  // 2. recall the WORLD → saw; the whole branch, woven; NO fact
  const c2 = reader(); await evaluate({ kind: "recall", of: "world", as: "w" }, c2);
  (Array.isArray(c2.bindings.w) && c2.bindings.w.length > 0 && c2.deltaF.length === 0)
    ? ok(`recall the world → saw (${c2.bindings.w.length} acts), NO fact laid`)
    : bad(`recall world`, { len: c2.bindings.w?.length, laid: c2.deltaF.length });

  // 3. recall a FOREIGN thread (I_AM's) → saw (all public, no gate); NO fact
  const c3 = reader(); await evaluate({ kind: "recall", of: String(I_AM), as: "f" }, c3);
  (Array.isArray(c3.bindings.f) && c3.bindings.f.length > 0 && c3.deltaF.length === 0)
    ? ok(`recall a foreign thread → saw (${c3.bindings.f.length} acts, all public), NO fact laid`)
    : bad(`foreign saw`, { len: c3.bindings.f?.length, laid: c3.deltaF.length });

  // 4. recall my LINEAGE → recalled; the family story (sage + its descendants); NO fact
  const c4 = reader(); await evaluate({ kind: "recall", of: { lineage: String(sageId) }, as: "fam" }, c4);
  (Array.isArray(c4.bindings.fam) && c4.bindings.fam.length > 0 && c4.deltaF.length === 0)
    ? ok(`recall my lineage → recalled (${c4.bindings.fam.length} acts, the family story), NO fact laid`)
    : bad(`recall lineage`, { len: c4.bindings.fam?.length, laid: c4.deltaF.length });

  // 5. recall a MOMENT → saw; one act's cross-section (a WHEN view); NO fact
  const someAct = (c2.bindings.w || []).find((a) => a.actId)?.actId;
  const c5 = reader(); await evaluate({ kind: "recall", of: { moment: someAct }, as: "mom" }, c5);
  (Array.isArray(c5.bindings.mom) && c5.bindings.mom.length > 0 && c5.deltaF.length === 0)
    ? ok(`recall a moment → saw (${c5.bindings.mom.length} act, the cross-section), NO fact laid`)
    : bad(`recall moment`, { len: c5.bindings.mom?.length, act: someAct, laid: c5.deltaF.length });

  // 6. the VERDICT — recall + a published conclusion + the declared why → ONE do:verdict memory fact
  let verdict = null;
  await withBeingAct(String(sageId), "verdict", "0", async (m) => {
    const cv = { dryRun: false, branch: "0", moment: m, identity: ident, bindings: {}, deltaF: m.deltaF, flows: [] };
    await evaluate({ kind: "recall", of: "world", that: "it was good", because: "it served its purpose" }, cv);
    verdict = m.deltaF.find((f) => f.act === "verdict");
    if (m.deltaF.length) await sealFacts(m.deltaF);
  });
  (verdict && verdict.params?.mode === "saw" && verdict.params?.that === "it was good" && verdict.params?.because === "it served its purpose")
    ? ok(`the verdict wrote ONE memory fact (mode:saw, that + the declared why) — conclusion AND reason recorded`)
    : bad(`verdict`, verdict);

  // 7. the book renders the verdict in the Word — "sage saw the world that it was good (because …)"
  await new Promise((r) => setTimeout(r, 500));
  const world = await assembleStory("world", { branch: "0" });
  const line = world.find((a) => /saw the world that it was good \(because it served its purpose\)/.test(a.line));
  line ? ok(`the book reads the verdict-memory in the Word: "${line.line}"`) : bad(`verdict render`, world.map((a) => a.line).slice(-3));

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
