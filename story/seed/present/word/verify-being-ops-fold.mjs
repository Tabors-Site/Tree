#!/usr/bin/env node
// verify-being-ops-fold . concept one (being): its ops mirror into the fold via declareOpsToFold.
// Additive: the operations Map is untouched; the fold gains the same ops as coin facts,
// so each resolves from the fold too (resolveDoOpFromFold), the bridge for the do-ops migration.
import fs from "fs"; import os from "os"; import path from "path"; import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const DB = path.join(os.tmpdir(), "story_beingopsfold-" + process.pid);
process.env.PORT = "3833"; process.env.TREEOS_STORE_BASE = DB;
fs.rmSync(DB, { recursive: true, force: true });
delete process.env.MONGODB_URI;
process.env.JWT_SECRET = process.env.JWT_SECRET || "beingopsfold-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "beingopsfold-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "beingopsfold-src"); fs.rmSync(SRC, { recursive: true, force: true }); fs.mkdirSync(SRC, { recursive: true }); fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;
// (scratch file store fresh-wiped above; no DB to drop)
await import(`${R}/begin.js`);
const { findByName } = await import(`${R}/seed/materials/projections.js`);
const { declareOpsToFold, getWord, resolveHostHandler } = await import(`${R}/seed/present/word/wordStore.js`);
const { getOperation } = await import(`${R}/seed/ibp/operations.js`);
const pollFor = async (fn, pred, t = 12000, e = 250) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (pred(v)) return v; await new Promise((r) => setTimeout(r, e)); } return await fn(); };
let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d !== undefined) console.log(`      ${typeof d === "string" ? d : JSON.stringify(d)}`); };
console.log(`\n  verify-being-ops-fold (concept one: being's ops mirror into the fold)\n`);
try {
  const cherub = await pollFor(() => findByName("being", "cherub", "0"), (v) => !!v);
  if (!cherub) { console.log("  FATAL: genesis failed"); process.exit(1); }
  await new Promise((r) => setTimeout(r, 1200));

  // a known being op exists in the Map (the source we mirror from)
  const probe = "grant-able";
  (getOperation(probe)?.handler) ? ok(`"${probe}" is a registered being op in the Map (the source)`) : bad(`Map has ${probe}`, "missing");

  // declare being's ops (target: being) into the fold
  const n = await declareOpsToFold({ filter: { target: "being" } });
  (n > 0) ? ok(`declared ${n} being ops into the fold (coin facts)`) : bad(`declared > 0`, { n });

  // the op now reconstructs from the fold, do-answer points at its handler ref
  const w = await pollFor(() => getWord(probe), (v) => v && v.do?.ref === probe);
  (w && w.do?.ref === probe && Array.isArray(w.targets) && w.targets.includes("being"))
    ? ok(`"${probe}" reconstructs from the fold (do.ref + targets), like a Being`) : bad(`fold reconstruct`, w);

  // and its bundled handler is resolvable by ref (the host side, the bottom turtle)
  (typeof resolveHostHandler(probe) === "function") ? ok(`the handler resolves by ref from the host table`) : bad(`handler ref`, "not a function");

  // the Map is untouched (additive): the op is still in the Map too
  (getOperation(probe)?.handler) ? ok(`the operations Map is untouched (additive bridge, no cutover yet)`) : bad(`Map intact`, "gone");

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) { console.log(`\n  ! crashed: ${err.stack || err.message}`); process.exit(3); }
