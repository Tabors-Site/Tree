#!/usr/bin/env node
// verify-connect-result-curate . the be:connect fact's result is a fail-CLOSED allowlist, through the
// REAL fold binding (not a hand-injected fixture). The adversarial review found that emitWordFact's
// curation branch only runs when binding.resultPolicy.keep is set, and the PRODUCTION connect binding
// (declareBeOpsToFold) was not setting it — so connect fell through to stripForAudit (a denylist), and
// the lone keystone test fabricated the policy, false-greening. This drives resolveBeOpFromFold('connect')
// — the exact binding the BE dispatcher resolves — and proves a rich connect result is narrowed to
// {beingAddress, note}: every other field (beingId/name/seatHistory/firstUser, a FUTURE field, and the
// session identityToken) is DROPPED from the stamped fact. Fail-closed: drift cannot auto-land.
import fs from "fs"; import os from "os"; import path from "path"; import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const DB = "mongodb://localhost:27017/story_connectcurate";
process.env.PORT = "3838"; process.env.MONGODB_URI = DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "connectcurate-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "connectcurate-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
{ const mongoose = (await import(`${R}/node_modules/mongoose/index.js`)).default; const conn = await mongoose.createConnection(DB).asPromise(); await conn.dropDatabase(); await conn.close(); }
await import(`${R}/begin.js`);
const { findByName } = await import(`${R}/seed/materials/projections.js`);
const { resolveBeOpFromFold } = await import(`${R}/seed/present/word/wordStore.js`);
const { emitWordFact, stampsFact } = await import(`${R}/seed/ibp/factResult.js`);
const { withIAmAct } = await import(`${R}/seed/sprout.js`);
const { I_AM } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { default: Fact } = await import(`${R}/seed/past/fact/fact.js`);
const pollFor = async (fn, pred, t = 12000, e = 250) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (pred(v)) return v; await new Promise((r) => setTimeout(r, e)); } return await fn(); };
let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d !== undefined) console.log(`      ${typeof d === "string" ? d : JSON.stringify(d)}`); };
console.log(`\n  verify-connect-result-curate (be:connect fact result is the {beingAddress,note} allowlist, real binding)\n`);

try {
  const cherub = await pollFor(() => findByName("being", "cherub", "0"), (v) => !!v);
  if (!cherub) { console.log("  FATAL: genesis failed"); process.exit(1); }
  await new Promise((r) => setTimeout(r, 1200));

  // (1) the REAL fold binding carries the fail-closed allowlist (not a hand-injected fixture)
  const binding = resolveBeOpFromFold("connect");
  const keep = binding?.resultPolicy?.keep;
  (Array.isArray(keep) && keep.length === 2 && keep.includes("beingAddress") && keep.includes("note"))
    ? ok(`resolveBeOpFromFold('connect').resultPolicy.keep = [beingAddress, note] (the production binding)`)
    : bad(`real connect binding carries the allowlist`, { resultPolicy: binding?.resultPolicy });

  // (2) emitWordFact through that REAL binding narrows a RICH connect result to exactly {beingAddress,note}
  const richResult = stampsFact(
    {
      beingAddress: "story/@y", note: "welcome", beingId: "B-target", name: "y",
      seatHistory: "0", firstUser: true, futureLeakField: "MUST-NOT-LAND",
      identityToken: "SESSION-TOKEN-SECRET",
    },
    { name: "y", from: null, inhabitedBy: "B-target" },
    { kind: "being", id: "B-target" },
  );
  await withIAmAct("connect curate probe", async (moment) => {
    await emitWordFact(binding, { through: String(I_AM), actId: moment?.actId || null, history: "0" }, richResult, moment);
  });

  const f = await pollFor(() => Fact.findOne({ verb: "be", act: "connect", "of.id": "B-target" }).lean(), (v) => !!v);
  if (!f) { bad("the be:connect fact was laid", "no fact"); }
  else {
    const rk = f.result ? Object.keys(f.result).sort() : [];
    (rk.length === 2 && rk[0] === "beingAddress" && rk[1] === "note")
      ? ok(`stamped fact.result has EXACTLY {beingAddress, note} (rich fields dropped)`)
      : bad(`result curated to allowlist`, { resultKeys: rk });

    const blob = JSON.stringify(f);
    const leaked = ["MUST-NOT-LAND", "SESSION-TOKEN-SECRET", "B-target", "firstUser"].filter((s) => f.result && JSON.stringify(f.result).includes(s));
    (leaked.length === 0)
      ? ok(`no rich/secret field (futureLeak, token, beingId, firstUser) reached fact.result`)
      : bad(`fail-closed allowlist holds`, { leaked });

    // params/target still correct (the curate only narrows result, not the act)
    (f.params?.inhabitedBy === "B-target" && f.of?.kind === "being")
      ? ok(`the act is still fully recorded (params.inhabitedBy, of:{kind:being})`)
      : bad(`act shape preserved`, { params: f.params, of: f.of });
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) { console.log(`\n  ! crashed: ${err.stack || err.message}`); process.exit(3); }
