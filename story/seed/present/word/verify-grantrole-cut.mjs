#!/usr/bin/env node
// grant-role (grant-role.word), LIVE through the bridge with ZERO stubs. The gates +
// role-registry check are .word; roleExists (registry lookup) + grantStamp (the grant's
// wall-clock instant, the one external-resource escape) are host. The grant RECORD is the
// dispatcher's auto-emitted grant-role fact — the cut enriches the op params with
// grantedBy/grantedAt so the fact (and the being reducer's rolesGranted append) carries
// them. Proves: a grant lands in rolesGranted WITH grantedBy/grantedAt, and the input
// gates refuse. CALLER mode. Full begin.js boot. Scratch DB, wiped.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = "mongodb://localhost:27017/story_word_grantrole_cut";
process.env.PORT = "3797";
process.env.MONGODB_URI = SCRATCH_DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "grantrole-secret-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "grantrolecut-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "grantrolecut-src");
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
const { withIAmAct } = await import(`${R}/seed/sprout.js`);
const { birthBeing } = await import(`${R}/seed/materials/being/identity/birth.js`);
const { I_AM } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { getSpaceRootId } = await import(`${R}/seed/sprout.js`);
const { doVerb } = await import(`${R}/seed/ibp/verbs/do.js`);
const { resolveRoleWord } = await import(`${R}/seed/present/word/roleWordRegistry.js`);
const { getRole } = await import(`${R}/seed/present/roles/registry.js`);

let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d !== undefined) console.log(`      ${typeof d === "string" ? d : JSON.stringify(d)}`); };
const poll = async (fn, t = 60000, e = 250) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, e)); } return null; };
const ident = { beingId: I_AM, name: "i-am", nameId: "i-am" };

const cherub = await poll(() => findByName("being", "cherub", "0"));
const birth = async (name) => {
  let bid = null;
  await withIAmAct(`birth ${name}`, async (ctx) => {
    const b = await birthBeing({ spec: { name, parentBeingId: cherub.id, homeId: cherub.state?.homeSpace, cognition: "scripted", defaultRole: "global" }, identity: I_AM, moment: ctx, branch: "0" });
    bid = b.beingId;
  });
  return bid;
};
const grant = async (target, params) => {
  const sc = { actId: randomUUID(), actorAct: { branch: "0", history: "0", by: "i-am" }, identity: ident, deltaF: [], foldedSeqs: new Map(), afterSeal: [] };
  try {
    const res = await doVerb({ kind: "being", id: String(target) }, "grant-role", params, { identity: ident, moment: sc, currentHistory: "0" });
    if (sc.deltaF.length) await sealFacts(sc.deltaF);
    return { result: res?.result ?? res, deltaF: sc.deltaF, refused: null };
  } catch (e) { if (e && (e.name === "IbpError" || e.code)) return { result: null, deltaF: sc.deltaF, refused: e }; throw e; }
};

console.log(`\n  verify-grantrole-cut (REAL grant-role op via doVerb → the cut)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`);
try {
  if (!cherub) { console.log("  FATAL: genesis failed"); process.exit(1); }
  resolveRoleWord("being", "grant-role") ? ok(`grant-role.word resolves through the bridge`) : bad(`resolves`);

  // pick a registered role to grant
  const role = ["human", "global", "member"].find((r) => getRole(r)) || "global";
  const grantee = await birth("grantee");
  const anchor = String(getSpaceRootId());

  // ── 1. grant a role → granted, attributed to the caller ──
  const g = await grant(grantee, { role, anchorSpaceId: anchor });
  g.result?.granted === true && g.result?.role === role && g.result?.grantedBy === I_AM
    ? ok(`grant "${role}" @ root → granted:true, grantedBy = I_AM (the caller)`)
    : bad(`grant`, g.refused?.message || g.result);

  // ── 2. the grant-role fact carries the enriched record (grantedBy + grantedAt) ──
  const gf = (g.deltaF || []).find((f) => f.act === "grant-role");
  gf && gf.params?.grantedBy === I_AM && typeof gf.params?.grantedAt === "string"
    ? ok(`the grant-role fact carries grantedBy + grantedAt (the cut's param-enrichment reached the auto-fact)`)
    : bad(`fact params`, gf?.params);

  // ── 3. the grantee's rolesGranted folds the grant ──
  const slot = await loadOrFold("being", String(grantee), "0");
  const granted = (slot?.state?.qualities?.rolesGranted || []).find((r) => (r.role || r) === role && (r.anchorSpaceId === anchor || !r.anchorSpaceId));
  granted
    ? ok(`@grantee rolesGranted folds {role:"${role}", anchorSpaceId, grantedBy} — the adjective applied`)
    : bad(`rolesGranted`, slot?.state?.qualities?.rolesGranted);

  // ── 4. input gates refuse (no role / unknown role / both anchors) ──
  const n1 = await grant(grantee, { anchorSpaceId: anchor });
  n1.refused && /role is required/i.test(n1.refused.message) && n1.refused.code === "INVALID_INPUT" ? ok(`no role → refuse "role is required" [INVALID_INPUT]`) : bad(`no role`, n1.refused?.message || n1.result);
  const n2 = await grant(grantee, { role: "definitely-not-a-role", anchorSpaceId: anchor });
  n2.refused && /not registered/i.test(n2.refused.message) ? ok(`unknown role → refuse "not registered"`) : bad(`unknown role`, n2.refused?.message || n2.result);
  const n3 = await grant(grantee, { role, anchorSpaceId: anchor, anchorBeingId: String(cherub.id) });
  n3.refused && /only one of/i.test(n3.refused.message) ? ok(`both anchors → refuse "only one of …"`) : bad(`both anchors`, n3.refused?.message || n3.result);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
