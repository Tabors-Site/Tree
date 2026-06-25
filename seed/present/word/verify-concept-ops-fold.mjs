#!/usr/bin/env node
// verify-concept-ops-fold . one concept's ops mirror into the fold via declareOpsToFold (additive).
// CONCEPT_TARGET selects the kind (being|space|matter|name|...). The operations Map is untouched;
// each op also reconstructs from the fold and its handler resolves by ref. The do-ops migration,
// one concept at a time, before the global cutover.
import fs from "fs"; import os from "os"; import path from "path"; import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const TARGET = process.env.CONCEPT_TARGET || "space";
const DB = path.join(os.tmpdir(), `story_conceptfold_${TARGET}-` + process.pid);
process.env.PORT = String(3840 + (TARGET.charCodeAt(0) % 50)); process.env.TREEOS_STORE_BASE = DB;
fs.rmSync(DB, { recursive: true, force: true });
process.env.JWT_SECRET = process.env.JWT_SECRET || "conceptfold-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), `conceptfold-keys-${TARGET}-` + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), `conceptfold-src-${TARGET}`); fs.rmSync(SRC, { recursive: true, force: true }); fs.mkdirSync(SRC, { recursive: true }); fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;
// (scratch file store fresh-wiped above; no DB to drop)
await import(`${R}/begin.js`);
const { findByName } = await import(`${R}/seed/materials/projections.js`);
const { declareOpsToFold, getWord, resolveHostHandler } = await import(`${R}/seed/present/word/wordStore.js`);
const { listOperations, getOperation } = await import(`${R}/seed/ibp/operations.js`);
const pollFor = async (fn, pred, t = 12000, e = 250) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (pred(v)) return v; await new Promise((r) => setTimeout(r, e)); } return await fn(); };
let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d !== undefined) console.log(`      ${typeof d === "string" ? d : JSON.stringify(d)}`); };
console.log(`\n  verify-concept-ops-fold [${TARGET}] (a concept's ops mirror into the fold)\n`);
try {
  const cherub = await pollFor(() => findByName("being", "cherub", "0"), (v) => !!v);
  if (!cherub) { console.log("  FATAL: genesis failed"); process.exit(1); }
  await new Promise((r) => setTimeout(r, 1200));

  const opsBefore = listOperations({ target: TARGET });
  (opsBefore.length > 0) ? ok(`${opsBefore.length} ops target "${TARGET}" in the Map (the source)`) : bad(`Map has ${TARGET} ops`, opsBefore.length);
  const probe = opsBefore[0]?.name;

  const n = await declareOpsToFold({ filter: { target: TARGET } });
  (n > 0) ? ok(`declared ${n} "${TARGET}" ops into the fold (coin facts)`) : bad(`declared > 0`, { n });

  const w = await pollFor(() => getWord(probe), (v) => v && v.do?.ref === probe);
  (w && w.do?.ref === probe) ? ok(`"${probe}" reconstructs from the fold (do.ref), like a Being`) : bad(`fold reconstruct`, w);

  (typeof resolveHostHandler(probe) === "function") ? ok(`"${probe}" handler resolves by ref from the host table`) : bad(`handler ref`, "not a function");

  (getOperation(probe)?.handler) ? ok(`the operations Map is untouched (additive, no cutover)`) : bad(`Map intact`, "gone");

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) { console.log(`\n  ! crashed: ${err.stack || err.message}`); process.exit(3); }
