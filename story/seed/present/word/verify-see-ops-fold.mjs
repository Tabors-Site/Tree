#!/usr/bin/env node
// verify-see-ops-fold . the SEE verb resolves its ops from the FOLD, not the seeOps REGISTRY.
// SEE is an OPEN registry (seed ops + the "<ext>:<name>" form), so the load-bearing check is
// COVERAGE: every registered see op must resolve from the fold, else fold-only dispatch breaks it.
// (1) COVERAGE — listSeeOperations() all resolve from the fold; (2) a known seed op folds as
// kind:"seeop" and resolves a handler; (3) the REGISTRY (buffer) agrees with the fold; (4) a
// synthetic see op folds + resolves. Twin of verify-name/be-ops-fold. If (1) FAILS, a see op
// registered AFTER seedFold — add a boot-end declareSeeOpsToFold pass (mirroring the do-ops).
import fs from "fs"; import os from "os"; import path from "path"; import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const DB = path.join(os.tmpdir(), "story_seeopsfold-" + process.pid);
process.env.PORT = "3834"; process.env.TREEOS_STORE_BASE = DB;
fs.rmSync(DB, { recursive: true, force: true });
delete process.env.MONGODB_URI;
process.env.JWT_SECRET = process.env.JWT_SECRET || "seeopsfold-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "seeopsfold-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
// (scratch file store fresh-wiped above; no DB to drop)
await import(`${R}/begin.js`);
const { findByName } = await import(`${R}/seed/materials/projections.js`);
const { bindWord, registerHostHandler, resolveSeeOpFromFold, getWordSync } = await import(`${R}/seed/present/word/wordStore.js`);
const { getSeeOperation, listSeeOperations } = await import(`${R}/seed/ibp/seeOps.js`);
const pollFor = async (fn, pred, t = 12000, e = 250) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (pred(v)) return v; await new Promise((r) => setTimeout(r, e)); } return await fn(); };
let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d !== undefined) console.log(`      ${typeof d === "string" ? d : JSON.stringify(d)}`); };
console.log(`\n  verify-see-ops-fold (SEE resolves its ops from the fold, not the seeOps REGISTRY)\n`);
try {
  const cherub = await pollFor(() => findByName("being", "cherub", "0"), (v) => !!v);
  if (!cherub) { console.log("  FATAL: genesis failed"); process.exit(1); }
  await new Promise((r) => setTimeout(r, 1500));

  // (1) COVERAGE — the load-bearing check: every registered see op resolves from the fold
  const registered = listSeeOperations().map((o) => o.name);
  const missing = registered.filter((name) => typeof resolveSeeOpFromFold(name)?.handler !== "function");
  (registered.length > 0 && missing.length === 0)
    ? ok(`all ${registered.length} registered SEE ops resolve from the fold (coverage complete — seedFold catches them all)`)
    : bad(`SEE op coverage — these registered AFTER seedFold, need a boot-end pass`, { registeredCount: registered.length, missing });

  // (2) a known seed op folds as kind:"seeop" and resolves a handler
  const known = "place";
  const w = getWordSync(`see:${known}`);
  (w && w.kind === "seeop" && typeof resolveSeeOpFromFold(known)?.handler === "function")
    ? ok(`a known seed op ("${known}") folds as kind:"seeop" and resolves a handler`)
    : bad(`known op folds`, { w });

  // (3) the REGISTRY (buffer) agrees with the fold for every registered op
  const agree = registered.every((name) => typeof getSeeOperation(name)?.handler === "function" && typeof resolveSeeOpFromFold(name)?.handler === "function");
  (agree)
    ? ok(`the seeOps REGISTRY (${registered.length}) agrees with the fold (the demoted registration buffer)`)
    : bad(`REGISTRY<->fold agreement`, { registered });

  // (4) a SYNTHETIC see op: bound to the fold + its handler registered, ABSENT from the REGISTRY
  registerHostHandler("see-op:test-see-op", async () => ({ ok: true }));
  await bindWord("see:test-see-op", { ownerExtension: "seed", kind: "seeop", do: { ref: "see-op:test-see-op" } });
  await new Promise((r) => setTimeout(r, 400));
  (!getSeeOperation("test-see-op"))
    ? ok(`"test-see-op" is absent from the seeOps REGISTRY (fold-only)`)
    : bad(`should be registry-absent`, "found in REGISTRY");
  (typeof resolveSeeOpFromFold("test-see-op")?.handler === "function")
    ? ok(`resolveSeeOpFromFold resolves the synthetic op from the fold`)
    : bad(`synthetic resolves`, resolveSeeOpFromFold("test-see-op"));

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) { console.log(`\n  ! crashed: ${err.stack || err.message}`); process.exit(3); }
