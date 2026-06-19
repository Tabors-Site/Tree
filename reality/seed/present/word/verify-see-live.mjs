#!/usr/bin/env node
// The Word's SEE verb, LIVE. Proves reads are VERBS, not host escapes (the see-registry
// dissolving into Word, 1.md): a QUERY (beings by name), a READ (a being's quality, fresh
// from the projection), and a being-tree PREDICATE (descends-from). SEE lays NO fact.
// Full begin.js boot. Scratch DB, wiped.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = "mongodb://localhost:27017/story_word_see_live";
process.env.PORT = "3791";
process.env.MONGODB_URI = SCRATCH_DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "seelive-secret-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "seelive-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "seelive-src");
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
const { withIAmAct } = await import(`${R}/seed/sprout.js`);
const { birthBeing } = await import(`${R}/seed/materials/being/identity/birth.js`);
const { I_AM } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { evaluate } = await import(`${R}/seed/present/word/evaluator.js`);
const { doVerb } = await import(`${R}/seed/ibp/verbs/do.js`);
const { getSpaceRootId } = await import(`${R}/seed/sprout.js`);

let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d !== undefined) console.log(`      ${typeof d === "string" ? d : JSON.stringify(d)}`); };
const poll = async (fn, t = 60000, e = 250) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, e)); } return null; };

const cherub = await poll(() => findByName("being", "cherub", "0"));
const birth = async (name, extraSpec = {}) => {
  let bid = null;
  await withIAmAct(`birth ${name}`, async (ctx) => {
    const b = await birthBeing({ spec: { name, parentBeingId: cherub.id, homeId: cherub.state?.homeSpace, cognition: "scripted", defaultRole: "global", ...extraSpec }, identity: I_AM, moment: ctx, branch: "0" });
    bid = b.beingId;
  });
  return bid;
};

// run a SEE node and return the bindings it produced
async function see(node, bindings = {}) {
  const ctx = { dryRun: false, moment: { actId: randomUUID() }, branch: "0", bindings: { ...bindings }, deltaF: [] };
  await evaluate(node, ctx);
  return { bindings: ctx.bindings, deltaF: ctx.deltaF };
}

console.log(`\n  verify-see-live (the SEE verb — reads as verbs, NO host escape)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`);
try {
  if (!cherub) { console.log("  FATAL: genesis failed"); process.exit(1); }
  const alice = await birth("alice");
  const child = await birth("alicechild", { parentBeingId: alice });
  const bob = await birth("bob");
  console.log(`  alice=${String(alice).slice(0,10)} child=${String(child).slice(0,10)}\n`);

  // ── QUERY: see beings where name = alice ──
  const q = await see({ kind: "see", of: "being", where: { name: "alice" }, bind: "found" });
  const found = q.bindings.found;
  Array.isArray(found) && found.length === 1 && String(found[0]._id) === String(alice)
    ? ok(`QUERY: see beings where name="alice" → [@alice]`) : bad(`query`, found);
  (q.deltaF || []).length === 0 ? ok(`SEE lays NO fact`) : bad(`no fact`, q.deltaF);

  // ── QUERY one: see the being named bob ──
  const q1 = await see({ kind: "see", of: "being", where: { name: "bob" }, one: true, bind: "b" });
  q1.bindings.b && q1.bindings.b.name === "bob" ? ok(`QUERY one: see the being named "bob" → @bob`) : bad(`query one`, q1.bindings.b);

  // ── READ: see a candidate's trueName (fresh) ──
  const cand = found[0];
  const rd = await see({ kind: "see", of: { ref: "cand" }, read: "trueName", fresh: true, bind: "tn" }, { cand });
  ("tn" in rd.bindings) && rd.bindings.tn != null ? ok(`READ: see @alice's trueName (fresh) → ${String(rd.bindings.tn).slice(0,10)}…`) : bad(`read`, rd.bindings.tn);

  // ── PREDICATE: see whether the child descends from alice ──
  const p1 = await see({ kind: "see", of: { ref: "child" }, descendsFrom: { ref: "ancestor" }, bind: "isDesc" }, { child: { _id: child }, ancestor: { beingId: alice } });
  p1.bindings.isDesc === true ? ok(`PREDICATE: @alicechild descends from @alice → true`) : bad(`descends true`, p1.bindings.isDesc);

  const p2 = await see({ kind: "see", of: { ref: "alice" }, descendsFrom: { ref: "child" }, bind: "isDesc" }, { alice: { _id: alice }, child: { beingId: child } });
  p2.bindings.isDesc === false ? ok(`PREDICATE: @alice does NOT descend from @alicechild → false`) : bad(`descends false`, p2.bindings.isDesc);

  // ── NEW: SPACE reads (the kind extension — not just beings) ──
  let arena = null;
  await withIAmAct("create arena", async (ctx) => {
    const res = await doVerb({ kind: "space", id: String(getSpaceRootId()) }, "create-space", { name: "arena", type: "generic" }, { identity: I_AM, moment: ctx });
    arena = String(res.spaceId);
  });
  // QUERY a space → the row is tagged kind:"space"
  const sq = await see({ kind: "see", of: "space", where: { name: "arena" }, one: true, bind: "sp" });
  sq.bindings.sp && sq.bindings.sp.kind === "space" && String(sq.bindings.sp._id) === arena
    ? ok(`QUERY of a SPACE: see the space named "arena" → tagged kind:"space"`) : bad(`space query`, sq.bindings.sp);
  // READ a space's quality fresh → uses kind="space" → loadProjection("space"), not "being"
  const sr = await see({ kind: "see", of: { ref: "sp" }, read: "name", fresh: true, bind: "nm" }, { sp: sq.bindings.sp });
  sr.bindings.nm === "arena" ? ok(`READ a SPACE's quality (fresh, kind="space"): see the space's name → "arena"`) : bad(`space read`, sr.bindings.nm);
  // and a {kind,id} bind (move's `subject` shape) reads the right kind
  const sr2 = await see({ kind: "see", of: { ref: "subj" }, read: "name", fresh: true, bind: "nm2" }, { subj: { kind: "space", id: arena } });
  sr2.bindings.nm2 === "arena" ? ok(`READ via a {kind,id} bind (move's subject shape) → resolves the space`) : bad(`kind-id read`, sr2.bindings.nm2);
  // a BARE id STRING (key-export's target arrives as a plain beingId, not a row) — seeRead
  // must treat a string subject as an id and loadProjection it, not read string["trueName"].
  const sr3 = await see({ kind: "see", of: { ref: "id" }, read: "trueName", fresh: true, bind: "tn" }, { id: String(alice) });
  sr3.bindings.tn != null ? ok(`READ a BARE id string (key-export's target shape): see the <id>'s trueName → ${String(sr3.bindings.tn).slice(0,8)}…`) : bad(`bare-id read (key-export)`, sr3.bindings.tn);

  // ── NEW: AUTHORITY predicate (the credential-reset gate, the grant gates) — a being-
  // tree authority WALK as a `see` verb, the last escape credential-reset can collapse. ──
  const ap1 = await see({ kind: "see", of: { ref: "a" }, hasAuthorityOver: { ref: "a" }, credential: true, bind: "auth" }, { a: { beingId: alice } });
  ap1.bindings.auth === true ? ok(`AUTHORITY: @alice has credential authority over @alice (self) → true`) : bad(`auth self`, ap1.bindings.auth);
  const ap2 = await see({ kind: "see", of: { ref: "a" }, hasAuthorityOver: { ref: "b" }, credential: true, bind: "auth" }, { a: { beingId: alice }, b: { beingId: bob } });
  typeof ap2.bindings.auth === "boolean" ? ok(`AUTHORITY: @alice over @bob resolves via the credential walk → ${ap2.bindings.auth}`) : bad(`auth resolves`, ap2.bindings.auth);
  const ap3 = await see({ kind: "see", of: { ref: "iam" }, hasAuthorityOver: { ref: "a" }, credential: true, bind: "auth" }, { iam: { beingId: I_AM }, a: { beingId: alice } });
  ap3.bindings.auth === true ? ok(`AUTHORITY: I_AM has credential authority over @alice → true (the root walk)`) : bad(`auth iam`, ap3.bindings.auth);
  // general (name -> being) authority + a clean FALSE: an unrelated name has none.
  const ap4 = await see({ kind: "see", of: { ref: "n" }, hasAuthorityOver: { ref: "a" }, bind: "auth" }, { n: { nameId: "z6MkUnrelatedNameXyz" }, a: { beingId: alice } });
  ap4.bindings.auth === false ? ok(`AUTHORITY (general, name->being): an unrelated name has NO authority over @alice → false`) : bad(`auth general false`, ap4.bindings.auth);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
