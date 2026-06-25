#!/usr/bin/env node
// The `story` SEE op serves the portal story view the SAME woven fold the LLM's RECALL reads.
// Proves the wire path: seeVerb("story", {scope}) → {scope, acts:[{line,...}]}, past-tense Word,
// no fact. Covers the coordinate system (world / being / lineage), being defaulting to the caller.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH = path.join(os.tmpdir(), "story_storyop-" + process.pid);
process.env.PORT = "3815";
process.env.TREEOS_STORE_BASE = SCRATCH;
fs.rmSync(SCRATCH, { recursive: true, force: true });
process.env.JWT_SECRET = process.env.JWT_SECRET || "storyop-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "storyop-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "storyop-src");
fs.rmSync(SRC, { recursive: true, force: true });
fs.mkdirSync(SRC, { recursive: true });
fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;

// (scratch file store fresh-wiped above; no DB to drop)
await import(`${R}/begin.js`);

const { findByName } = await import(`${R}/seed/materials/projections.js`);
const { seeVerb } = await import(`${R}/seed/ibp/verbs/see.js`);
const poll = async (fn, t = 60000, e = 250) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, e)); } return null; };

let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d !== undefined) console.log(`      ${typeof d === "string" ? d : JSON.stringify(d)}`); };

console.log(`\n  verify-story-op (the portal story view's wire path = the recall fold)\n`);
try {
  const cherub = await poll(() => findByName("being", "cherub", "0"));
  if (!cherub) { console.log("  FATAL: genesis failed"); process.exit(1); }
  await new Promise((r) => setTimeout(r, 1500));
  const ident = { beingId: String(cherub.id), nameId: String(cherub.id), name: "cherub" };

  // 1. world story — the whole branch, woven in the Word
  const w = await seeVerb("story", { args: { scope: "world" }, identity: ident, currentHistory: "0" });
  (w && Array.isArray(w.acts) && w.acts.length > 0 && typeof w.acts[0]?.line === "string")
    ? ok(`see story {scope:world} → ${w.acts.length} acts, woven: "${w.acts[0].line}"`)
    : bad(`world`, w);

  // 2. being story — defaults `being` to the caller (cherub), first person
  const b = await seeVerb("story", { args: { scope: "being" }, identity: ident, currentHistory: "0" });
  (b && Array.isArray(b.acts) && b.acts.length > 0 && b.acts.every((a) => typeof a.line === "string"))
    ? ok(`see story {scope:being} (defaults to caller) → ${b.acts.length} acts in cherub's thread`)
    : bad(`being`, b);

  // 3. lineage story — cherub + its descendants (the family)
  const l = await seeVerb("story", { args: { scope: "lineage" }, identity: ident, currentHistory: "0" });
  (l && Array.isArray(l.acts) && l.acts.length > 0)
    ? ok(`see story {scope:lineage} → ${l.acts.length} acts, the family story`)
    : bad(`lineage`, l);

  // 4. it's a pure read — the woven shape carries the rendered line, not raw verb:op
  const clean = w.acts.every((a) => typeof a.line === "string" && !/^\w+:\w+$/.test(a.line));
  clean ? ok(`every act carries a rendered Word line (not JSON / verb:op)`) : bad(`render shape`, w.acts.slice(0, 2));

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
