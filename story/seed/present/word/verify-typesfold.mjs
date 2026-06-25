#!/usr/bin/env node
// verify-typesfold — the matter-types Map migration: every registered type folds into the word-fold
// (a type = a word with kind:"type"), and resolveTypeFromFold is VALUE-IDENTICAL to the Map's
// getMatterType — the parity that makes a getMatterType fold-first read safe. Mirrors verify-foldedops.
import fs from "fs"; import os from "os"; import path from "path"; import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const DB = path.join(os.tmpdir(), "story_typesfold-" + process.pid);
process.env.PORT = "3842"; process.env.TREEOS_STORE_BASE = DB;
fs.rmSync(DB, { recursive: true, force: true });
delete process.env.MONGODB_URI;
process.env.JWT_SECRET = process.env.JWT_SECRET || "typesfold-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "typesfold-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "typesfold-src"); fs.rmSync(SRC, { recursive: true, force: true }); fs.mkdirSync(SRC, { recursive: true }); fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;
// (scratch file store fresh-wiped above; no DB to drop)
await import(`${R}/begin.js`);
const { findByName } = await import(`${R}/seed/materials/projections.js`);
const { listFoldedTypes, resolveTypeFromFold } = await import(`${R}/seed/present/word/wordStore.js`);
const { listMatterTypes } = await import(`${R}/seed/materials/matter/types.js`);
const poll = async (fn, t = 20000, e = 300) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, e)); } return await fn(); };
let pass = 0, fail = 0; const ok = (l) => { pass++; console.log("  ✓ " + l); }; const bad = (l, d) => { fail++; console.log("  ✗ " + l); if (d !== undefined) console.log("      " + JSON.stringify(d)); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
console.log("\n  verify-typesfold (the matter-types Map -> the fold)\n");
try {
  await poll(() => findByName("being", "cherub", "0"), (v) => !!v);
  const mapTypes = listMatterTypes();
  const folded = listFoldedTypes();
  folded.length >= mapTypes.length && mapTypes.length > 0
    ? ok(`every Map type folds: ${folded.length} folded >= ${mapTypes.length} in the Map`)
    : bad(`fold count`, { folded: folded.length, map: mapTypes.length });
  // The parity that makes a fold-first getMatterType safe: field-by-field value-identity.
  const FIELDS = ["name", "description", "contentKinds", "mimeTypes", "ops", "render", "claims", "executable", "fields", "ownerExtension"];
  const mismatches = [];
  for (const m of mapTypes) {
    const f = resolveTypeFromFold(m.name);
    if (!f) { mismatches.push({ name: m.name, why: "not in fold" }); continue; }
    for (const k of FIELDS) if (!eq(m[k], f[k])) mismatches.push({ name: m.name, k, map: m[k], fold: f[k] });
  }
  mismatches.length === 0
    ? ok(`resolveTypeFromFold is value-identical to the Map for all ${mapTypes.length} types (fold-first is safe)`)
    : bad(`parity`, mismatches.slice(0, 4));
  const file = resolveTypeFromFold("file");
  (file && file.ops.includes("set-matter") && file.contentKinds.includes("binary"))
    ? ok(`"file" type folds with its ops + contentKinds (a real type, not a stub)`)
    : bad(`file type`, file);
  // 21.md P5: an EXECUTABLE matter type folds with its run-op declaration (effect-class + entry), so
  // the production fold-first getMatterType sees it as runnable — not just the Map backstop.
  const wasm = resolveTypeFromFold("wasm");
  (wasm && wasm.executable && wasm.executable.effect === "pure" && wasm.executable.entry === "run")
    ? ok(`"wasm" folds as EXECUTABLE (effect=pure, entry=run) — the run-op + effect-class ride the fold`)
    : bad(`wasm executable did not ride the fold`, wasm);
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (e) { console.log("\n  ! crashed: " + (e.stack || e.message)); process.exit(3); }
