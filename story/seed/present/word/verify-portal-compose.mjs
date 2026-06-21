#!/usr/bin/env node
// form-portal as a COMPOSITE word: portal.word composes `do create-matter with { nested ibpa
// spec }` (the new nested-object grammar), laying ONE caller-attributed do:create-matter fact
// via the dispatcher — no host: emit, no redundant do:form-portal audit (skipAudit). Proves the
// nested-param grammar end to end + the composition. CALLER mode. Full begin.js boot. Scratch DB.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = "mongodb://localhost:27017/story_word_portal_compose";
process.env.PORT = "3801";
process.env.MONGODB_URI = SCRATCH_DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "portalcompose-secret-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "portalcompose-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "portalcompose-src");
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

const { findByName, loadOrFold } = await import(`${R}/seed/materials/projections.js`);
const { sealFacts } = await import(`${R}/seed/past/fact/facts.js`);
const { I_AM } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { getSpaceRootId } = await import(`${R}/seed/sprout.js`);
const { doVerb } = await import(`${R}/seed/ibp/verbs/do.js`);

let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d !== undefined) console.log(`      ${typeof d === "string" ? d : JSON.stringify(d)}`); };
const poll = async (fn, t = 60000, e = 250) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, e)); } return null; };
const ident = { beingId: I_AM, name: "i-am", nameId: "i-am" };

console.log(`\n  verify-portal-compose (form-portal composes create-matter via nested-param grammar)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`);
try {
  const cherub = await poll(() => findByName("being", "cherub", "0"));
  if (!cherub) { console.log("  FATAL: genesis failed"); process.exit(1); }
  const spaceRoot = getSpaceRootId();
  const FOREIGN = "bing.com#0/library";

  const sc = { actId: randomUUID(), actorAct: { history: "0", by: "i-am" }, identity: ident, deltaF: [], foldedSeqs: new Map(), afterSeal: [] };
  const raw = await doVerb({ kind: "space", id: String(spaceRoot) }, "form-portal", { target: FOREIGN, name: "test portal" }, { identity: ident, moment: sc, currentHistory: "0" });
  const result = raw?.result ?? raw;

  // 1. the composite returns formed + a content-addressed matterId
  (result?.formed === true && result?.matterId)
    ? ok(`form-portal returned formed:true + matterId ${String(result.matterId).slice(0, 10)}…`)
    : bad(`form-portal return`, result);

  // 2. exactly ONE fact, and it is do:create-matter (NOT do:form-portal) — composition + skipAudit
  const acts = sc.deltaF.map((f) => `${f.verb}:${f.act}`);
  const createFacts = sc.deltaF.filter((f) => f.verb === "do" && f.act === "create-matter");
  (createFacts.length === 1 && !sc.deltaF.some((f) => f.act === "form-portal"))
    ? ok(`one do:create-matter fact, no do:form-portal audit (composition + skipAudit) — [${acts.join(", ")}]`)
    : bad(`fact shape`, acts);

  // 3. the create-matter fact carries the NESTED ibpa spec the grammar shaped + is caller-attributed
  const cf = createFacts[0];
  (cf?.params?.type === "ibpa" &&
    cf?.params?.content?.target === FOREIGN &&
    cf?.params?.qualities?.portal?.createdBy === String(I_AM) &&
    String(cf?.through) === String(I_AM))
    ? ok(`fact params carry the nested spec {type:ibpa, content:{target}, qualities:{portal:{createdBy}}}, attributed to the caller`)
    : bad(`nested fact params`, cf?.params);

  // 4. after seal, the ibpa matter materializes with the folded nested content + qualities
  await sealFacts(sc.deltaF);
  const matter = await poll(() => loadOrFold("matter", String(result.matterId), "0"));
  (matter?.state?.type === "ibpa" &&
    matter?.state?.content?.target === FOREIGN &&
    matter?.state?.qualities?.portal?.target === FOREIGN)
    ? ok(`the portal matter folds: type ibpa, content.target + qualities.portal.target = ${FOREIGN}`)
    : bad(`folded matter`, matter?.state);

  // 5. the matter id is content-addressed (reproducible) — it is a real hash, not a uuid
  (typeof result.matterId === "string" && result.matterId.length >= 16 && !result.matterId.includes("-"))
    ? ok(`matterId is content-addressed (not a uuid)`)
    : bad(`content-addressed id`, result.matterId);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
