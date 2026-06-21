#!/usr/bin/env node
// verify-rolewordfold — ROLES-UNIFICATION phase 1: every registered role-word is declared into the
// unified wordStore fold (kind:"roleword", role:op -> source), and the fold READ path
// (resolveRoleWordViaFold) resolves the SAME .word as the REGISTRY path (resolveRoleWord). This is the
// parity that makes the phase-2 read cutover provably a no-op before REGISTRY is deleted. Additive:
// phase 1 changes NO behavior (resolveRoleWord still drives); this only proves the new path agrees.
import fs from "fs"; import os from "os"; import path from "path"; import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const DB = "mongodb://localhost:27017/story_rolewordfold";
process.env.PORT = "3844"; process.env.MONGODB_URI = DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "rolewordfold-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "rolewordfold-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "rolewordfold-src"); fs.rmSync(SRC, { recursive: true, force: true }); fs.mkdirSync(SRC, { recursive: true }); fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;
{ const mongoose = (await import(`${R}/node_modules/mongoose/index.js`)).default; const conn = await mongoose.createConnection(DB).asPromise(); await conn.dropDatabase(); await conn.close(); }
await import(`${R}/begin.js`);
const { findByName } = await import(`${R}/seed/materials/projections.js`);
const rwr = await import(`${R}/seed/present/word/roleWordRegistry.js`);
const { resolveRoleWordSource } = await import(`${R}/seed/present/word/wordStore.js`);
const poll = async (fn, t = 20000, e = 300) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, e)); } return await fn(); };
let pass = 0, fail = 0; const ok = (l) => { pass++; console.log("  ✓ " + l); }; const bad = (l, d) => { fail++; console.log("  ✗ " + l); if (d !== undefined) console.log("      " + JSON.stringify(d)); };
console.log("\n  verify-rolewordfold (ROLES-UNIFICATION phase 1: declare + read parity)\n");
try {
  await poll(() => findByName("being", "cherub", "0"), (v) => !!v);
  const regs = rwr.listRegistered();
  regs.length >= 15 ? ok(`${regs.length} role-words registered (the bundles self-registered)`) : bad(`registered count`, regs.length);
  // 1. every registered role-word is in the fold with its EXACT source
  const srcMiss = [];
  for (const w of regs) {
    const src = resolveRoleWordSource(w.role, w.op);
    if (src !== String(w.fileUrl)) srcMiss.push({ key: `${w.role}:${w.op}`, fold: src, reg: String(w.fileUrl) });
  }
  srcMiss.length === 0 ? ok(`every role-word folded with its exact source (${regs.length})`) : bad(`source parity`, srcMiss.slice(0, 3));
  // 2. read parity: the fold path resolves iff the REGISTRY path resolves (both non-null / both null)
  const disagree = [];
  for (const w of regs) {
    const viaFold = rwr.resolveRoleWordViaFold(w.role, w.op, "0");
    const viaReg = rwr.resolveRoleWord(w.role, w.op, "0");
    if ((viaFold !== null) !== (viaReg !== null)) disagree.push({ key: `${w.role}:${w.op}`, fold: viaFold !== null, reg: viaReg !== null });
  }
  disagree.length === 0 ? ok(`read parity: fold-path resolves iff REGISTRY-path resolves, all ${regs.length}`) : bad(`read parity`, disagree.slice(0, 3));
  // 3. spot-check the bridge hot path: cherub:birth resolves to a real IR via the fold
  const cb = rwr.resolveRoleWordViaFold("cherub", "birth", "0");
  cb ? ok(`cherub:birth resolves via the fold (the bridge/birth hot path is ready for cutover)`) : bad(`cherub:birth via fold`, cb);
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (e) { console.log("\n  ! crashed: " + (e.stack || e.message)); process.exit(3); }
