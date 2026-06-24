#!/usr/bin/env node
// close-story — the LAST skipAudit op. It now lays a 5D NAME-ACT (verb:name, act:close-story,
// bodiless) on the LIBRARY reel BEFORE the graceful shutdown — the out-of-history "story closed"
// signal the engine's dispatch-gate reads to refuse acts once a story is closed. ranAsMoments,
// no skipAudit. Proves: a REAL close-story via doVerb (heaven authority) lands the library-reel
// name-act (verb:name, through:null, by the Name, params.closedBy), and the no-actor gate refuses.
// We neutralize close-story's 250ms self-SIGTERM so it can't tear this test down. Full begin.js boot.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const DB = "mongodb://localhost:27017/story_closestory_cut";
process.env.PORT = "3793";
process.env.MONGODB_URI = DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "closestory-0123456789";
process.env.STORY_KEY_DIR = path.join(
  os.tmpdir(),
  "closestory-keys-" + process.pid,
);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "closestory-src");
fs.rmSync(SRC, { recursive: true, force: true });
fs.mkdirSync(SRC, { recursive: true });
fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;

// Neutralize close-story's 250ms self-SIGTERM so it can't kill this test process mid-check.
const _kill = process.kill.bind(process);
process.kill = (pid, sig) => {
  if (sig === "SIGTERM" && pid === process.pid) return true;
  return _kill(pid, sig);
};

{
  const mongoose = (await import(`${R}/node_modules/mongoose/index.js`))
    .default;
  const conn = await mongoose.createConnection(DB).asPromise();
  await conn.dropDatabase();
  await conn.close();
}
await import(`${R}/begin.js`);

const { findByName } = await import(`${R}/seed/materials/projections.js`);
const { sealFacts } = await import(`${R}/seed/past/fact/facts.js`);
const { I } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { doVerb } = await import(`${R}/seed/ibp/verbs/do.js`);
const { getStoryDomain } = await import(`${R}/seed/ibp/address.js`);
const { getSpaceRootId } = await import(`${R}/seed/sprout.js`);
const Fact = (await import(`${R}/seed/past/fact/fact.js`)).default;

let pass = 0,
  fail = 0;
const ok = (l) => {
  pass++;
  console.log("  ✓ " + l);
};
const bad = (l, d) => {
  fail++;
  console.log("  ✗ " + l);
  if (d !== undefined) console.log("      " + JSON.stringify(d).slice(0, 240));
};
const poll = async (fn, t = 30000, e = 250) => {
  const t0 = Date.now();
  while (Date.now() - t0 < t) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, e));
  }
  return null;
};
const ident = { beingId: I, name: "i-am", nameId: "i-am" };
const did = async (op, target, params, who = ident) => {
  const sc = {
    actId: randomUUID(),
    actorAct: { history: "0", by: who?.nameId || null },
    identity: who,
    deltaF: [],
    foldedSeqs: new Map(),
    afterSeal: [],
  };
  try {
    const res = await doVerb(target, op, params, {
      identity: who,
      moment: sc,
      currentHistory: "0",
    });
    if (sc.deltaF.length) await sealFacts(sc.deltaF);
    return { result: res?.result ?? res, deltaF: sc.deltaF, refused: null };
  } catch (e) {
    if (e && (e.name === "IbpError" || e.code))
      return { result: null, deltaF: sc.deltaF, refused: e };
    throw e;
  }
};

console.log(
  "\n  verify-closestory-cut (close-story → library-reel name-act)\n",
);
try {
  const cherub = await poll(() => findByName("being", "cherub", "0"));
  if (!cherub) {
    console.log("  FATAL: genesis failed");
    process.exit(1);
  }
  const story = getStoryDomain();
  const rootSpace = String(getSpaceRootId());

  // ── 1. close-story (heaven authority) returns + lays no do-fact of its own (ranAsMoments) ──
  const c = await did("close-story", { kind: "space", id: rootSpace }, {});
  const doFacts = (c.deltaF || []).filter((f) => f.verb === "do");
  c.result?.closing === true && doFacts.length === 0
    ? ok(
        `close-story → closing:true, ZERO do-facts in the op moment (ranAsMoments; no skipAudit double-stamp)`,
      )
    : bad(
        `close`,
        c.refused?.message || {
          result: c.result,
          doFacts: doFacts.map((f) => f.act),
        },
      );

  // ── 2. the close-story NAME-ACT landed on the library reel (verb:name, bodiless, by the Name) ──
  const cf = await poll(() =>
    Fact.findOne({
      "of.kind": "library",
      "of.id": story,
      act: "close-story",
      verb: "name",
    }).lean(),
  );
  cf && cf.through == null && cf.by && String(cf.params?.closedBy) === String(I)
    ? ok(
        `close-story name-act on the library reel: verb=name, through=null, by=${cf.by}, params.closedBy=I`,
      )
    : bad(
        `name-act`,
        cf
          ? { verb: cf.verb, through: cf.through, by: cf.by, params: cf.params }
          : "no fact on library reel",
      );

  // ── 3. the no-actor gate refuses (heaven authority required) ──
  const n = await did("close-story", { kind: "space", id: rootSpace }, {}, {});
  n.refused
    ? ok(`no actor → refuse "${n.refused.message?.slice(0, 44)}..."`)
    : bad(`actor gate`, n.result);

  // ── 4. THE DISPATCH GATE (in-process latch): a subsequent act refuses now that we're closed ──
  const g1 = await did(
    "create-space",
    { kind: "space", id: rootSpace },
    { name: "after-close" },
  );
  g1.refused && /closed/i.test(g1.refused.message || "")
    ? ok(
        `post-close act REFUSED (in-process latch): "${g1.refused.message?.slice(0, 50)}..."`,
      )
    : bad(`gate (latch)`, g1.refused?.message || g1.result);

  // ── 5. THE GATE via the FACT-READ path (what a restarted server takes): reset the latch, act ──
  const { _resetStoryClosedLatchForTest } = await import(
    `${R}/seed/storyLifecycle.js`
  );
  _resetStoryClosedLatchForTest();
  const g2 = await did(
    "create-space",
    { kind: "space", id: rootSpace },
    { name: "after-restart" },
  );
  g2.refused && /closed/i.test(g2.refused.message || "")
    ? ok(
        `post-close act REFUSED via the library-reel fact read (restart path): "${g2.refused.message?.slice(0, 40)}..."`,
      )
    : bad(`gate (fact-read)`, g2.refused?.message || g2.result);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
