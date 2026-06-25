#!/usr/bin/env node
// verify-federation-cut, the federation-manager send-side ops (offer-template + reject-template)
// are WORD-SOLE, LIVE through doVerb. Each op is handler-less: its `.word` lays the negotiation
// writes as do:set-being deeds on the federation-manager being's reel (via the resolve-federation-
// spec floor read), then fires the cross-story membrane out (dispatch-federation-intent). Proves:
//   - offer-template lays bundleCache + pendingOutbound + the lastStep "offer-sent" deeds on the
//     federation-manager being's qualities.federation, and the dispatch see-op fired (the word ran
//     to its "offered" status, which is past the dispatch line).
//   - reject-template reads a pre-seeded incoming offer, fires the dispatch, then records the
//     completed entry and clears the pending offer.
//   - the no-actor gate refuses both (the auth gate lives IN the word).
// The cross-story dispatch resolves no peer (PEER_NOT_FOUND, a clean ack, no throw), so the word
// completes locally. Full begin.js boot. Scratch DB.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = path.join(os.tmpdir(), "story_word_federation_cut-" + process.pid);
process.env.PORT = "3795";
process.env.TREEOS_STORE_BASE = SCRATCH_DB;
fs.rmSync(SCRATCH_DB, { recursive: true, force: true });
process.env.JWT_SECRET = process.env.JWT_SECRET || "federationcut-secret-0123456789";
process.env.STORY_DOMAIN = process.env.STORY_DOMAIN || "alpha.test";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "federationcut-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "federationcut-src");
fs.rmSync(SRC, { recursive: true, force: true });
fs.mkdirSync(SRC, { recursive: true });
fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;

// Scratch file store is fresh-wiped above (TREEOS_STORE_BASE); begin.js opens it on boot.
// The fold + projections read the files.
await import(`${R}/begin.js`);

const { findByName, loadOrFold } = await import(`${R}/seed/materials/projections.js`);
const { sealFacts } = await import(`${R}/seed/past/fact/facts.js`);
const { I } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { doVerb } = await import(`${R}/seed/ibp/verbs/do.js`);
const { resolveAbleWord } = await import(`${R}/seed/present/word/ableWordRegistry.js`);

let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => {
  fail++; console.log(`  ✗ ${l}`);
  if (d !== undefined) console.log(`      ${typeof d === "string" ? d : JSON.stringify(d)}`);
};
const poll = async (fn, t = 60000, e = 250) => {
  const t0 = Date.now();
  while (Date.now() - t0 < t) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, e)); }
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
    const res = await doVerb(target, op, params, { identity: who, moment: sc, currentHistory: "0" });
    if (sc.deltaF.length) await sealFacts(sc.deltaF);
    for (const cb of sc.afterSeal || []) { try { await cb(); } catch {} }
    return { result: res?.result ?? res, deltaF: sc.deltaF, refused: null };
  } catch (e) {
    for (const cb of sc.afterSeal || []) { try { await cb(); } catch {} }
    if (e && (e.name === "IbpError" || e.code)) return { result: null, deltaF: sc.deltaF, refused: e };
    throw e;
  }
};

// Read qualities.federation.<bucket> off the federation-manager being.
const fedBucket = async (mgrId, bucket) => {
  const st = (await loadOrFold("being", String(mgrId), "0"))?.state;
  const q = st?.qualities;
  const quals = q instanceof Map ? Object.fromEntries(q.entries()) : (q || {});
  return (quals.federation || {})[bucket] || {};
};

console.log(`\n  verify-federation-cut (offer-template / reject-template word-SOLE via doVerb)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`);
try {
  const mgr = await poll(() => findByName("being", "federation-manager", "0"));
  if (!mgr) { console.log("  FATAL: federation-manager being not planted"); process.exit(1); }
  const mgrId = String(mgr.id);

  resolveAbleWord("being", "offer-template") &&
  resolveAbleWord("being", "reject-template") &&
  resolveAbleWord("being", "offer-being") &&
  resolveAbleWord("being", "request-template") &&
  resolveAbleWord("being", "accept-template") &&
  resolveAbleWord("being", "fulfill-request") &&
  resolveAbleWord("being", "refuse-request")
    ? ok(`all 7 federation .words resolve through the bridge`)
    : bad(`resolve`, {
        offerT: !!resolveAbleWord("being", "offer-template"),
        rejectT: !!resolveAbleWord("being", "reject-template"),
        offerB: !!resolveAbleWord("being", "offer-being"),
        reqT: !!resolveAbleWord("being", "request-template"),
        acceptT: !!resolveAbleWord("being", "accept-template"),
        fulfill: !!resolveAbleWord("being", "fulfill-request"),
        refuse: !!resolveAbleWord("being", "refuse-request"),
      });

  const T = { kind: "being", id: mgrId };

  // ── 1. offer-template: capture + cache + record pendingOutbound + dispatch + mark offer-sent ──
  // subtreePath is the place root (a uuid resolves as-is); peer is a foreign domain (no peer
  // registered, so the dispatch acks PEER_NOT_FOUND without throwing, the word completes locally).
  const { getSpaceRootId } = await import(`${R}/seed/sprout.js`);
  const rootSpace = getSpaceRootId();
  const off = await did("offer-template", T, {
    peer: "beta.test",
    subtreePath: String(rootSpace),
    label: "cut-test-offer",
  });
  const negId = off.result?.negotiationId || null;
  (off.result?.status === "offered" && negId)
    ? ok(`offer-template ran past the dispatch see-op to status "offered" (neg ${String(negId).slice(0, 8)})`)
    : bad(`offer-template`, off.refused?.message || off.result);

  // the do:set-being deeds landed on the federation-manager being ──
  const outbound = await poll(async () => {
    const b = await fedBucket(mgrId, "pendingOutbound");
    return b[negId] ? b[negId] : null;
  }, 10000);
  outbound && outbound.lastStep === "offer-sent" && outbound.peer === "beta.test"
    ? ok(`offer-template laid pendingOutbound.<id> (do:set-being) with lastStep="offer-sent"`)
    : bad(`pendingOutbound`, outbound);

  const cached = await poll(async () => {
    const b = await fedBucket(mgrId, "bundleCache");
    return b[negId] ? "y" : null;
  }, 8000);
  cached
    ? ok(`offer-template laid bundleCache.<id> (do:set-being) before the dispatch`)
    : bad(`bundleCache`, await fedBucket(mgrId, "bundleCache"));

  // ── 2. reject-template: seed an incoming offer, then reject it ──
  const incomingId = randomUUID();
  // Seed the pending incoming offer directly via set-being on the federation-manager being.
  await did("set-being", T, {
    field: `qualities.federation.pendingIncomingOffers.${incomingId}`,
    value: { sender: { beingId: "peerBeing", story: "gamma.test" }, manifest: { foo: 1 }, receivedAt: null },
  });
  const seeded = await poll(async () => {
    const b = await fedBucket(mgrId, "pendingIncomingOffers");
    return b[incomingId] ? "y" : null;
  }, 8000);
  if (!seeded) { bad(`seed incoming offer`, await fedBucket(mgrId, "pendingIncomingOffers")); }

  const rej = await did("reject-template", T, { negotiationId: incomingId, reason: "no thanks" });
  rej.result?.status === "rejected"
    ? ok(`reject-template ran past the dispatch see-op to status "rejected"`)
    : bad(`reject-template`, rej.refused?.message || rej.result);

  // completed.<id> recorded + the pending offer cleared ──
  const completed = await poll(async () => {
    const b = await fedBucket(mgrId, "completed");
    return b[incomingId] ? b[incomingId] : null;
  }, 10000);
  const clearedPending = await poll(async () => {
    const b = await fedBucket(mgrId, "pendingIncomingOffers");
    return b[incomingId] == null ? "y" : null;
  }, 10000);
  completed && completed.success === false && clearedPending
    ? ok(`reject-template recorded completed.<id> and cleared pendingIncomingOffers.<id> (two do:set-being deeds)`)
    : bad(`reject seal`, { completed, clearedPending });

  // ── 3. the no-actor gate refuses both ──
  const nOff = await did("offer-template", T, { peer: "beta.test", subtreePath: String(rootSpace) }, {});
  const nRej = await did("reject-template", T, { negotiationId: incomingId }, {});
  nOff.refused && nRej.refused
    ? ok(`no actor → offer-template + reject-template both refuse (the auth gate lives IN the word)`)
    : bad(`actor gate`, { off: nOff.refused?.message || nOff.result, rej: nRej.refused?.message || nRej.result });

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
