#!/usr/bin/env node
// The bridge's live entry point, end to end. Where verify-cherub-live.mjs hand-built
// the I_AM-through-Cherub ctx and called evaluate() directly, THIS drives the SAME
// five-act diff through `runRoleWord` from a REALISTIC summoner moment (the arrival's
// attribution, `_inOp` NOT preset) — proving runRoleWord derives the actor model the
// green diff proved (overrides identity + actorAct.nameId to i-am, shares the chain),
// so the birthHandler cut is a trivial call into this one tested entry point.
//
// Two assertions beyond the green seven: the laid facts attribute to I_AM (the
// override worked), and the caller's own summonCtx is UNTOUCHED (the derivation is
// clean — the host session strand that follows reads the real moment, not i-am).
// Isolated test DB, wiped at start and end.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const realityRoot = path.resolve(__dirname, "../../..");
for (const line of fs.readFileSync(path.resolve(realityRoot, ".env"), "utf8").split("\n")) {
  const t = line.trim(); if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("="); if (eq === -1) continue;
  const k = t.slice(0, eq).trim(), v = t.slice(eq + 1).trim();
  if (v && !process.env[k]) process.env[k] = v;
}
process.env.MONGODB_URI = "mongodb://localhost:27017/reality-word-bridge-live";

const mongoose = (await import("../../seedReality/dbConfig.js")).default;
if (mongoose.connection.readyState !== 1) {
  await new Promise((res, rej) => { mongoose.connection.once("connected", res); mongoose.connection.once("error", rej); });
}
if (mongoose.connection.name !== "reality-word-bridge-live") { console.log(`  REFUSING wrong DB ${mongoose.connection.name}`); process.exit(2); }

await import("../../materials/space/ops.js");
await import("../../materials/matter/ops.js");
await import("../../materials/being/ops.js");

const { registerRole } = await import("../../present/roles/registry.js");
const { humanRole } = await import("../../present/roles/human/role.js");
try { registerRole("human", humanRole); } catch { /* already registered */ }

const { ensureSpaceRoot, ensureIAm } = await import("../../sprout.js");
const { findByName } = await import("../../materials/projections.js");
const { ensureSeedDelegates } = await import("../../materials/being/seedDelegates.js");
const { sealFacts } = await import("../../past/fact/facts.js");
const { nameVerb } = await import("../../ibp/verbs/name.js");
const { resolveRoleWord, runRoleWord, bornBeingFrom } = await import("./roleWordRegistry.js");

let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d) console.log(`      ${d}`); };
async function withRetry(fn, tries = 6) {
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) { const m = String(e?.message || e);
      if (i < tries - 1 && /catalog changes|acquire .* lock|please retry|WriteConflict|TransientTransaction/i.test(m)) { await new Promise((r) => setTimeout(r, 250 * (i + 1))); continue; }
      throw e; }
  }
}

console.log(`\n  verify-bridge-live (runRoleWord drives the full 5-act diff)\n  DB: ${mongoose.connection.name}\n`);
try {
  await mongoose.connection.db.dropDatabase();
  for (const c of ["facts", "acts", "beings", "spaces", "matters", "reels", "reelheads", "names", "stamps"]) {
    try { await mongoose.connection.db.createCollection(c); } catch {}
  }
  const spaceRoot = await withRetry(() => ensureSpaceRoot());
  await withRetry(() => ensureIAm());
  await withRetry(() => ensureSeedDelegates(spaceRoot._id));
  const branch = "0";
  const cherub = await findByName("being", "cherub", branch);
  if (!cherub) throw new Error("no cherub");
  const arrival = await findByName("being", "arrival", branch);
  console.log(`  cherub=${cherub.id} placeRoot=${spaceRoot._id} branch=${branch}`);

  // the arriving Name (the father, via arrival), declared first so form-being's
  // trueName = a declared Name.
  let ownerName = null;
  await withRetry(async () => {
    const sc = { actId: randomUUID(), actorAct: { branch, nameId: "i-am" }, identity: { beingId: "i-am", name: "I_AM", nameId: "i-am" }, deltaF: [], foldedSeqs: new Map(), afterSeal: [] };
    ownerName = (await nameVerb("declare", { name: "tabor", password: "pw12345678", soulType: "human" }, { identity: sc.identity, summonCtx: sc, currentBranch: branch })).nameId;
    await sealFacts(sc.deltaF);
  });
  console.log(`  arriving Name (father) = ${String(ownerName).slice(0, 14)}…\n`);

  const ir = resolveRoleWord("cherub", "birth");

  // A REALISTIC summoner moment: attribution is the arriving NAME (NOT i-am), and
  // `_inOp` is NOT preset — exactly what birthHandler hands the bridge. runRoleWord
  // must derive the i-am-through-Cherub actor model itself.
  const summonCtx = {
    actId: randomUUID(),
    actorAct: { branch, nameId: String(ownerName) },
    identity: { beingId: String(arrival?.id ?? "arrival"), name: "tabor", nameId: String(ownerName) },
    deltaF: [], foldedSeqs: new Map(), afterSeal: [],
  };
  const sealedActorAct = JSON.stringify(summonCtx.actorAct);

  await withRetry(() => runRoleWord(ir, {
    summonCtx, branch,
    trigger: { name: "tabor-prime", password: "wordpass" },
    bindings: { ownerName: String(ownerName), placeRoot: String(spaceRoot._id) },
    beings: { Cherub: String(cherub.id), ...(arrival ? { Arrival: String(arrival.id) } : {}) },
    through: String(cherub.id),
    iam: "i-am",
  }));

  console.log(`  runRoleWord laid ${summonCtx.deltaF.length} fact(s):`);
  for (const f of summonCtx.deltaF) console.log(`    ${f.verb}:${f.action} (by ${String(f.nameId).slice(0, 8)}) -> ${f.target?.kind}:${String(f.target?.id ?? "").slice(0, 10)}`);
  console.log("");

  // ── the green seven (the world strand the cut must preserve) ──
  const shape = summonCtx.deltaF.map((f) => `${f.verb}:${f.action}`);
  const EXPECT = ["do:create-space", "be:birth", "do:set-space", "do:grant-role", "do:set-being"];
  EXPECT.every((e) => shape.includes(e))
    ? ok(`all five world acts present (${shape.join(", ")})`) : bad(`five acts present`, shape.join(", "));

  const birth = summonCtx.deltaF.find((f) => f.verb === "be" && f.action === "birth");
  birth?.params?.name === "tabor-prime" ? ok(`be:birth names @tabor-prime`) : bad(`be:birth names @tabor-prime`, birth?.params?.name);
  String(birth?.params?.trueName) === String(ownerName) ? ok(`being is the new Name's own (trueName = the arriving Name)`) : bad(`trueName = arriving Name`, `got ${birth?.params?.trueName}`);
  const newBeingId = String(birth?.target?.id ?? birth?.beingId);

  const setSpace = summonCtx.deltaF.find((f) => f.action === "set-space");
  String(setSpace?.params?.value ?? setSpace?.params?.owner) === newBeingId
    ? ok(`home owner set to the new being`) : bad(`home owner = new being`, JSON.stringify(setSpace?.params));

  const humanGrant = summonCtx.deltaF.find((f) => f.action === "grant-role" && f.params?.role === "human");
  humanGrant ? ok(`human role granted on the new being`) : bad(`human role granted`, "no human grant-role fact");

  const lv = summonCtx.deltaF.find((f) => f.action === "set-being")?.params?.value;
  (String(lv?.mother) === String(cherub.id) && (!arrival || String(lv?.father) === String(arrival.id)))
    ? ok(`lineage: mother=Cherub, father=Arrival (proper names resolved to ids)`) : bad(`lineage`, JSON.stringify(lv));

  await sealFacts(summonCtx.deltaF);
  const born = await findByName("being", "tabor-prime", branch);
  born ? ok(`@tabor-prime materializes after seal (${String(born.id).slice(0, 10)}…)`) : bad(`@tabor-prime materializes`, "no row");

  // ── the two new assertions: the derivation is correct AND clean ──
  const allByIam = summonCtx.deltaF.every((f) => String(f.nameId) === "i-am");
  allByIam ? ok(`every laid fact attributes to I_AM (the actor-model override worked)`) : bad(`facts attribute to I_AM`, summonCtx.deltaF.map((f) => f.nameId).join(", "));

  JSON.stringify(summonCtx.actorAct) === sealedActorAct
    ? ok(`caller's summonCtx.actorAct UNTOUCHED (derivation is clean, session strand safe)`)
    : bad(`caller summonCtx untouched`, `was ${sealedActorAct}, now ${JSON.stringify(summonCtx.actorAct)}`);

  // ── bornBeingFrom: what the session strand reads ──
  const being = bornBeingFrom(summonCtx.deltaF);
  (being && being.name === "tabor-prime" && String(being.trueName) === String(ownerName) && being._id)
    ? ok(`bornBeingFrom reconstructs { _id, name:@tabor-prime, trueName } for the session strand`)
    : bad(`bornBeingFrom`, JSON.stringify(being));

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  try { await mongoose.connection.db.dropDatabase(); await mongoose.disconnect(); } catch {}
  process.exit(3);
}
