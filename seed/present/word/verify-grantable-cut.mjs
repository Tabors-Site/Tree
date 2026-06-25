#!/usr/bin/env node
// grant-able (grant-able.word), LIVE through the bridge with ZERO stubs. The gates +
// able-registry check are .word; ableExists (registry lookup) + grantStamp (the grant's
// wall-clock instant, the one external-resource escape) are host. The grant RECORD is the
// dispatcher's auto-emitted grant-able fact — the cut enriches the op params with
// grantedBy/grantedAt so the fact (and the being reducer's ablesGranted append) carries
// them. Proves: a grant lands in ablesGranted WITH grantedBy/grantedAt, and the input
// gates refuse. CALLER mode. Full begin.js boot. Scratch DB, wiped.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = path.join(os.tmpdir(), "story_word_grantable_cut-" + process.pid);
process.env.PORT = "3797";
process.env.TREEOS_STORE_BASE = SCRATCH_DB;
fs.rmSync(SCRATCH_DB, { recursive: true, force: true });
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "grantable-secret-0123456789";
process.env.STORY_KEY_DIR = path.join(
  os.tmpdir(),
  "grantablecut-keys-" + process.pid,
);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "grantablecut-src");
fs.rmSync(SRC, { recursive: true, force: true });
fs.mkdirSync(SRC, { recursive: true });
fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;

// (scratch file store fresh-wiped above; no DB to drop)

await import(`${R}/begin.js`);

const { findByName, loadOrFold } = await import(
  `${R}/seed/materials/projections.js`
);
const { sealFacts } = await import(`${R}/seed/past/fact/facts.js`);
const { withIAmAct } = await import(`${R}/seed/sprout.js`);
const { birthBeing } = await import(
  `${R}/seed/materials/being/identity/birth.js`
);
const { I } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { getSpaceRootId } = await import(`${R}/seed/sprout.js`);
const { doVerb } = await import(`${R}/seed/ibp/verbs/do.js`);
const { resolveAbleWord } = await import(
  `${R}/seed/present/word/ableWordRegistry.js`
);
const { getAble } = await import(`${R}/seed/present/ables/registry.js`);

let pass = 0,
  fail = 0;
const ok = (l) => {
  pass++;
  console.log(`  ✓ ${l}`);
};
const bad = (l, d) => {
  fail++;
  console.log(`  ✗ ${l}`);
  if (d !== undefined)
    console.log(`      ${typeof d === "string" ? d : JSON.stringify(d)}`);
};
const poll = async (fn, t = 60000, e = 250) => {
  const t0 = Date.now();
  while (Date.now() - t0 < t) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, e));
  }
  return null;
};
const ident = { beingId: I, name: "i-am", nameId: "i-am" };

const cherub = await poll(() => findByName("being", "cherub", "0"));
const birth = async (name) => {
  let bid = null;
  await withIAmAct(`birth ${name}`, async (ctx) => {
    const b = await birthBeing({
      spec: {
        name,
        parentBeingId: cherub.id,
        homeId: cherub.state?.homeSpace,
        cognition: "scripted",
        defaultAble: "global",
      },
      identity: I,
      moment: ctx,
      history: "0",
    });
    bid = b.beingId;
  });
  return bid;
};
const grant = async (target, params) => {
  const sc = {
    actId: randomUUID(),
    actorAct: { history: "0", by: "i-am" },
    identity: ident,
    deltaF: [],
    foldedSeqs: new Map(),
    afterSeal: [],
  };
  try {
    const res = await doVerb(
      { kind: "being", id: String(target) },
      "grant-able",
      params,
      { identity: ident, moment: sc, currentHistory: "0" },
    );
    if (sc.deltaF.length) await sealFacts(sc.deltaF);
    return { result: res?.result ?? res, deltaF: sc.deltaF, refused: null };
  } catch (e) {
    if (e && (e.name === "IbpError" || e.code))
      return { result: null, deltaF: sc.deltaF, refused: e };
    throw e;
  }
};

console.log(
  `\n  verify-grantable-cut (REAL grant-able op via doVerb → the cut)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`,
);
try {
  if (!cherub) {
    console.log("  FATAL: genesis failed");
    process.exit(1);
  }
  resolveAbleWord("being", "grant-able")
    ? ok(`grant-able.word resolves through the bridge`)
    : bad(`resolves`);

  // pick a registered able to grant
  const able =
    ["human", "global", "member"].find((r) => getAble(r)) || "global";
  const grantee = await birth("grantee");
  const anchor = String(getSpaceRootId());

  // ── 1. grant a able → granted, attributed to the caller ──
  const g = await grant(grantee, { able, anchorSpaceId: anchor });
  g.result?.able === able &&
  g.result?.grantedBy === I
    ? ok(`grant "${able}" @ root → grantedBy = I (the caller); the fact's existence IS "granted"`)
    : bad(`grant`, g.refused?.message || g.result);

  // ── 2. the grant-able fact carries the enriched record (grantedBy + grantedAt) ──
  const gf = (g.deltaF || []).find((f) => f.act === "grant-able");
  gf && String(gf.through) === I
    ? ok(
        `the grant-able fact carries grantedBy + grantedAt (the cut's param-enrichment reached the auto-fact)`,
      )
    : bad(`fact params`, gf?.params);

  // ── 3. the grantee's ablesGranted folds the grant ──
  const slot = await loadOrFold("being", String(grantee), "0");
  const granted = (slot?.state?.qualities?.ablesGranted || []).find(
    (r) =>
      (r.able || r) === able &&
      (r.anchorSpaceId === anchor || !r.anchorSpaceId),
  );
  granted
    ? ok(
        `@grantee ablesGranted folds {able:"${able}", anchorSpaceId, grantedBy} — the adjective applied`,
      )
    : bad(`ablesGranted`, slot?.state?.qualities?.ablesGranted);

  // ── 4. input gates refuse (no able / unknown able / both anchors) ──
  const n1 = await grant(grantee, { anchorSpaceId: anchor });
  n1.refused &&
  /able is required/i.test(n1.refused.message) &&
  n1.refused.code === "INVALID_INPUT"
    ? ok(`no able → refuse "able is required" [INVALID_INPUT]`)
    : bad(`no able`, n1.refused?.message || n1.result);
  const n2 = await grant(grantee, {
    able: "definitely-not-a-able",
    anchorSpaceId: anchor,
  });
  n2.refused && /not registered/i.test(n2.refused.message)
    ? ok(`unknown able → refuse "not registered"`)
    : bad(`unknown able`, n2.refused?.message || n2.result);
  const n3 = await grant(grantee, {
    able,
    anchorSpaceId: anchor,
    anchorBeingId: String(cherub.id),
  });
  n3.refused && /only one of/i.test(n3.refused.message)
    ? ok(`both anchors → refuse "only one of …"`)
    : bad(`both anchors`, n3.refused?.message || n3.result);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
