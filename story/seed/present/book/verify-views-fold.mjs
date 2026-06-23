#!/usr/bin/env node
// Half B — the 6 lens VIEWS are WORDS, folded at genesis (kind:"view"), and readTrail resolves the
// column-puller FROM THE FOLD (not the hardcoded LENSES map). The JS map stays as the boot buffer;
// this proves the fold path is live. Run: node seed/present/book/verify-views-fold.mjs

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = "mongodb://localhost:27017/story_views_fold";
process.env.PORT = "3815";
process.env.MONGODB_URI = SCRATCH_DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "views-fold-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "views-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "views-src");
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
const { getWord } = await import(`${R}/seed/present/word/wordStore.js`);
const { readTrail, resolveViewFromFold, LENS_NAMES } = await import(`${R}/seed/present/book/read-trail.js`);

let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d !== undefined) console.log(`      ${typeof d === "string" ? d : JSON.stringify(d)}`); };
const poll = async (fn, t = 60000, e = 250) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, e)); } return null; };

console.log(`\n  verify-views-fold (the 6 lens views are folded words; readTrail resolves from the fold)\n`);
try {
  const cherub = await poll(() => findByName("being", "cherub", "0"));
  if (!cherub) { console.log("  FATAL: genesis failed"); process.exit(1); }
  await new Promise((r) => setTimeout(r, 1500));

  // 1. all 6 views folded as kind:"view" on heaven "0", each carrying a host-handler render ref
  const folded = [];
  for (const name of LENS_NAMES) {
    const w = await getWord(name, "0");
    if (w && w.kind === "view" && w.render?.ref === `view:${name}`) folded.push(name);
  }
  folded.length === LENS_NAMES.length
    ? ok(`all ${LENS_NAMES.length} views folded as kind:"view" (${folded.join(", ")})`)
    : bad(`views folded`, { got: folded, want: LENS_NAMES });

  // 2. resolveViewFromFold returns the column-puller fn FROM THE FOLD (not the map)
  const whoFn = await resolveViewFromFold("who");
  typeof whoFn === "function"
    ? ok(`resolveViewFromFold("who") → the puller fn, from the fold`)
    : bad(`resolve from fold`, typeof whoFn);

  // 3. readTrail with a lens resolves through the fold + projects the facet down the trail
  const r = await readTrail({ history: "0", scope: "world", lens: "who" });
  (r.kind === "lens" && r.lens === "who" && Array.isArray(r.facets) && r.facets.length > 0 && r.facets[0]?.value)
    ? ok(`readTrail(lens:"who") → ${r.facets.length} facets via the fold (e.g. "${r.facets[0].value}")`)
    : bad(`readTrail lens`, { kind: r.kind, len: r.facets?.length });

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
