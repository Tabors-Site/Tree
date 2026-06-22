#!/usr/bin/env node
// rename-matter (rename-matter.word), LIVE through the bridge with ZERO stubs. The `name`-required
// gate + the §7 return are .word; resolve-rename-spec (load + spaceId-require + per-folder uniqueness)
// is the host escape wired by renameMatterHost.js, reusing loadTargetRow + listMatterNamesInFolder.
// Proves: a REAL rename-matter via doVerb runs the .word, renames the row, lands the do:rename-matter
// fact targeting the matter, and the gates (no-name, name-in-use, allowReplace bypass) match the JS.
// Full begin.js boot. Scratch DB, wiped.
import fs from "fs"; import os from "os"; import path from "path"; import { fileURLToPath } from "url"; import { randomUUID } from "crypto";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = "mongodb://localhost:27017/story_word_renamematter_cut";
process.env.PORT = "3840"; process.env.MONGODB_URI = SCRATCH_DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "renamematter-secret-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "renamemattercut-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "renamemattercut-src"); fs.rmSync(SRC, { recursive: true, force: true }); fs.mkdirSync(SRC, { recursive: true }); fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;
{ const mongoose = (await import(`${R}/node_modules/mongoose/index.js`)).default; const conn = await mongoose.createConnection(SCRATCH_DB).asPromise(); await conn.dropDatabase(); await conn.close(); }
await import(`${R}/begin.js`);
const { findByName, loadOrFold } = await import(`${R}/seed/materials/projections.js`);
const { sealFacts } = await import(`${R}/seed/past/fact/facts.js`);
const { I_AM } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { getSpaceRootId } = await import(`${R}/seed/sprout.js`);
const { doVerb } = await import(`${R}/seed/ibp/verbs/do.js`);
const { resolveRoleWord } = await import(`${R}/seed/present/word/roleWordRegistry.js`);
let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d !== undefined) console.log(`      ${typeof d === "string" ? d : JSON.stringify(d)}`); };
const poll = async (fn, t = 60000, e = 250) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, e)); } return null; };
const ident = { beingId: I_AM, name: "i-am", nameId: "i-am" };
const runOp = async (target, op, params) => {
  const sc = { actId: randomUUID(), actorAct: { history: "0", by: ident.nameId }, identity: ident, deltaF: [], foldedSeqs: new Map(), afterSeal: [] };
  try {
    const res = await doVerb(target, op, params, { identity: ident, moment: sc, currentHistory: "0" });
    if (sc.deltaF.length) await sealFacts(sc.deltaF);
    return { result: res?.result ?? res, deltaF: sc.deltaF, refused: null };
  } catch (e) { if (e && (e.name === "IbpError" || e.code)) return { result: null, deltaF: sc.deltaF, refused: e }; throw e; }
};

console.log(`\n  verify-renamematter-cut (REAL rename-matter op via doVerb → the cut)\n`);
try {
  const cherub = await poll(() => findByName("being", "cherub", "0"));
  if (!cherub) { console.log("  FATAL: genesis failed"); process.exit(1); }
  resolveRoleWord("matter", "rename-matter") ? ok(`rename-matter.word resolves through the bridge (self-registered)`) : bad(`resolves`, "null");
  const rootSpace = String(getSpaceRootId());

  // seed two matters in the root folder
  const a = await runOp({ kind: "space", id: rootSpace }, "create-matter", { name: "hello.txt", content: "a\n" });
  const b = await runOp({ kind: "space", id: rootSpace }, "create-matter", { name: "taken.txt", content: "b\n" });
  const aId = String(a.result?.matterId), bId = String(b.result?.matterId);
  (aId && bId) ? ok(`seeded two matters (hello.txt, taken.txt)`) : bad(`seed`, { a: a.refused?.message, b: b.refused?.message });
  const matterA = { kind: "matter", id: aId };

  // ── 1. rename hello.txt → renamed.txt: the .word runs AND the row folds the new name ──
  // (The conversion FIXES the pre-existing "weird funk": rename-matter now lays its fact exactly like
  // set-being/set-space — params {field:"name", value} — so applySetField folds the name onto the row.
  // The old {name}-shaped fact never folded [applySetField reads only {field,value}], so neither the
  // OLD JS nor a byte-identical .word actually renamed the row. Both paths [.word + JS fallback] now
  // emit {field,value} — Tabor's "should lay fact exactly like being and space".)
  const r = await runOp(matterA, "rename-matter", { name: "renamed.txt" });
  const slot = aId ? await loadOrFold("matter", aId, "0") : null;
  (r.result?.name === "renamed.txt" && slot?.state?.name === "renamed.txt")
    ? ok(`rename-matter via the .word → the row FOLDS the new name "renamed.txt" (the fix lands)`)
    : bad(`rename`, { result: r.result, refused: r.refused?.message, foldedName: slot?.state?.name });

  // ── 2. the do:rename-matter fact: targets the matter, params {field:"name", value} (like set-space) ──
  const rf = (r.deltaF || []).find((f) => f.act === "rename-matter");
  (rf && rf.verb === "do" && String(rf.of?.id) === aId && rf.of?.kind === "matter" && String(rf.through) === String(I_AM) && rf.params?.field === "name" && rf.params?.value === "renamed.txt")
    ? ok(`do:rename-matter fact: of {matter, matterId}, through = caller, params {field:"name", value:"renamed.txt"} (exactly like being/space)`)
    : bad(`fact`, rf ? { verb: rf.verb, of: rf.of, through: rf.through, params: rf.params } : "no fact");

  // ── 3. no-name gate (the .word's "name is required"): refuse, no fact ──
  const noName = await runOp(matterA, "rename-matter", {});
  (noName.refused && /name.*required/i.test(noName.refused.message || ""))
    ? ok(`no name → refuse "${(noName.refused.message || "").slice(0, 44)}…"`)
    : bad(`no-name gate`, noName.refused?.message || noName.result);

  // ── 4. name-in-use gate (resolve-rename-spec folder uniqueness): refuse ──
  const collide = await runOp(matterA, "rename-matter", { name: "taken.txt" });
  (collide.refused && /already in use/i.test(collide.refused.message || ""))
    ? ok(`rename to a sibling's name → refuse "already in use" (the host uniqueness read ran)`)
    : bad(`name-in-use gate`, collide.refused?.message || collide.result);

  // ── 5. allowReplace bypasses the handler's pre-flight uniqueness REFUSE (no refuse, fact laid) ──
  // (It does not end the still-present sibling "taken.txt", so the reducer's own fold-level uniqueness
  // de-dups the folded name to "taken.txt~conflict-…" — correct: allowReplace is for the atomic-replace
  // pattern where the caller ends the colliding row in the same moment. Here we only prove the
  // pre-flight gate is bypassed and the {field:"name", value} fact is laid.)
  const replace = await runOp(matterA, "rename-matter", { name: "taken.txt", allowReplace: true });
  const repf = (replace.deltaF || []).find((f) => f.act === "rename-matter");
  (replace.result?.name === "taken.txt" && !replace.refused && repf?.params?.field === "name" && repf?.params?.value === "taken.txt")
    ? ok(`allowReplace=true bypasses the pre-flight refuse → lays {field:"name", value:"taken.txt"} (no refuse)`)
    : bad(`allowReplace`, { result: replace.result, refused: replace.refused?.message, factParams: repf?.params });

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) { console.log(`\n  ! crashed: ${err.stack || err.message}`); process.exit(3); }
