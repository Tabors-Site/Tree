#!/usr/bin/env node
// set-owner / remove-owner (store/words/owner/, WORD-SOLE), LIVE via doVerb. The auth + per-space
// lock + CAS stay the floor (ownership.js setOwner / removeOwner) reached as `see` escapes; the
// `.word` carries the input gates + authors the ONE do:set-owner / do:remove-owner fact. Proves:
// an authorized set-owner lays the fact (field:owner, value) and the space's owner folds;
// remove-owner folds it to empty; the no-newOwnerId gate refuses. CALLER mode (I). Full begin.js
// boot. Scratch DB, wiped.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = "mongodb://localhost:27017/story_word_owner_cut";
process.env.PORT = "3798";
process.env.MONGODB_URI = SCRATCH_DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "owner-secret-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "ownercut-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "ownercut-src");
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

const { findByName, loadOrFold } = await import(
  `${R}/seed/materials/projections.js`
);
const { sealFacts } = await import(`${R}/seed/past/fact/facts.js`);
const { withIAmAct, getSpaceRootId } = await import(`${R}/seed/sprout.js`);
const { birthBeing } = await import(
  `${R}/seed/materials/being/identity/birth.js`
);
const { I } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { doVerb } = await import(`${R}/seed/ibp/verbs/do.js`);
const { resolveAbleWord } = await import(
  `${R}/seed/present/word/ableWordRegistry.js`
);

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

const did = async (target, op, params, who = ident) => {
  const sc = {
    actId: randomUUID(),
    actorAct: { history: "0", by: who.name || "i-am" },
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

console.log(
  `\n  verify-owner-cut (REAL set-owner / remove-owner via doVerb → the word)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`,
);
try {
  if (!cherub) {
    console.log("  FATAL: genesis failed");
    process.exit(1);
  }

  resolveAbleWord("space", "set-owner") &&
  resolveAbleWord("space", "remove-owner")
    ? ok(`set-owner.word + remove-owner.word resolve through the bridge`)
    : bad(`resolve`);

  // a child space under the root (I creates it → I controls it)
  const rootId = String(getSpaceRootId());
  const mk = await did({ kind: "space", id: rootId }, "create-space", {
    name: "ownertest-" + randomUUID().slice(0, 6),
  });
  const mkFact = (mk.deltaF || []).find((f) => f.act === "create-space");
  const childId =
    mk.result?.spaceId ??
    mk.result?.id ??
    mk.result?._id ??
    mkFact?.of?.id ??
    null;
  childId
    ? ok(`child space created under root: ${String(childId).slice(0, 8)}…`)
    : bad(`create-space`, mk.refused?.message || mk.result);

  const newOwner = await birth("newowner");

  // ── 1. set-owner → the do:set-owner fact + the space's owner folds ──
  const so = await did({ kind: "space", id: String(childId) }, "set-owner", {
    newOwnerId: String(newOwner),
  });
  const sof = (so.deltaF || []).find((f) => f.act === "set-owner");
  so.result?.ownerSet === true &&
  sof?.params?.field === "owner" &&
  String(sof?.params?.value) === String(newOwner)
    ? ok(`set-owner → do:set-owner fact {field:"owner", value:newOwner}`)
    : bad(`set-owner`, so.refused?.message || { result: so.result, fact: sof?.params });

  const afterSet = await loadOrFold("space", String(childId), "0");
  String(afterSet?.state?.owner) === String(newOwner)
    ? ok(`@space owner folds to newOwner (applySetField applied)`)
    : bad(`owner fold`, afterSet?.state?.owner);

  // ── 2. remove-owner → owner folds to empty ──
  const ro = await did({ kind: "space", id: String(childId) }, "remove-owner", {});
  const rof = (ro.deltaF || []).find((f) => f.act === "remove-owner");
  ro.result?.ownerRemoved === true && rof?.params?.field === "owner"
    ? ok(`remove-owner → do:remove-owner fact {field:"owner", value:null}`)
    : bad(`remove-owner`, ro.refused?.message || { result: ro.result, fact: rof?.params });

  const afterRemove = await loadOrFold("space", String(childId), "0");
  !afterRemove?.state?.owner
    ? ok(`@space owner folds to empty (the leaf cleared)`)
    : bad(`owner-remove fold`, afterRemove?.state?.owner);

  // ── 3. gate: no newOwnerId → refuse ──
  const n1 = await did({ kind: "space", id: String(childId) }, "set-owner", {});
  n1.refused && /newOwnerId is required/i.test(n1.refused.message)
    ? ok(`no newOwnerId → refuse "newOwnerId is required"`)
    : bad(`gate`, n1.refused?.message || n1.result);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
