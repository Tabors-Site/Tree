#!/usr/bin/env node
// set-owner / remove-owner (store/words/owner/, WORD-SOLE), LIVE via doVerb. The auth + per-space
// lock + CAS stay the floor (ownership.js setOwner / removeOwner) reached as `see` escapes; the
// `.word` carries the input gates + authors the ONE do:set-owner / do:remove-owner fact.
//
// Ownership shape (members.js): claiming/revoking a child's owner is authorized by the PARENT's
// owner. So the test nests: a being B granted angel ("do *") brings a TREE ROOT P (resolveBirthSpace
// makes the creator its owner), then a sub-space C under P; as P's owner, B set-owners C to newOwner
// (the fact carries {field:owner,value} and C's owner folds) and remove-owners C (folds to empty);
// the no-newOwnerId gate refuses. Full begin.js boot. Scratch DB, wiped.

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

const spaceIdOf = (mk) =>
  mk.result?.spaceId ??
  (mk.deltaF || []).find((f) => f.act === "create-space")?.of?.id ??
  null;

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

const grantAngel = (beingId, anchorSpaceId) =>
  did({ kind: "being", id: String(beingId) }, "grant-able", {
    able: "angel",
    anchorSpaceId: String(anchorSpaceId),
  });

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

  const rootId = String(getSpaceRootId());
  const B = await birth("ownerB");
  const newOwner = await birth("newowner");
  const B_id = { beingId: String(B), name: "ownerB" };

  // B brings a TREE ROOT P (creator becomes owner), then a sub-space C under P. B needs angel
  // reaching root (to plant P) and reaching P (a tree root isn't under the story root).
  await grantAngel(B, rootId);
  const mkP = await did(
    { kind: "space", id: rootId },
    "create-space",
    { name: "owner-P-" + randomUUID().slice(0, 6) },
    B_id,
  );
  const P = spaceIdOf(mkP);
  if (!P) bad(`create P`, mkP.refused?.message || mkP.result);
  await grantAngel(B, P);
  const mkC = await did(
    { kind: "space", id: String(P) },
    "create-space",
    { name: "owner-C-" + randomUUID().slice(0, 6) },
    B_id,
  );
  const C = spaceIdOf(mkC);
  P && C
    ? ok(
        `B owns tree root P=${String(P).slice(0, 8)}…; brings sub-space C=${String(C).slice(0, 8)}… under it`,
      )
    : bad(`setup`, { P, C, mkC: mkC.refused?.message || mkC.result });

  // ── 1. B set-owner(C → newOwner): P's owner (B) authorizes claiming the child ──
  const so = await did(
    { kind: "space", id: String(C) },
    "set-owner",
    { newOwnerId: String(newOwner) },
    B_id,
  );
  // set-owner is now a COMPOSITE: its do:set-space deed seals in its OWN moment (not so.deltaF),
  // so assert the result here and the fold below (the deed's fact landed iff the owner folded).
  so.result?.ownerSet === true && String(so.result?.newOwnerId) === String(newOwner)
    ? ok(
        `set-owner → ownerSet (composite: gate + do set-space leaf-call; the deed seals its own moment)`,
      )
    : bad(`set-owner`, so.refused?.message || so.result);

  const afterSet = await loadOrFold("space", String(C), "0");
  String(afterSet?.state?.owner) === String(newOwner)
    ? ok(`@C owner folds to newOwner (applySetField applied)`)
    : bad(`owner fold`, afterSet?.state?.owner);

  // ── 2. B remove-owner(C): P's owner (B) authorizes the revoke → folds to empty ──
  const ro = await did(
    { kind: "space", id: String(C) },
    "remove-owner",
    {},
    B_id,
  );
  // remove-owner is now a COMPOSITE too: its do:set-space deed seals in its OWN moment, so assert the
  // result here and the fold below (the deed's fact landed iff the owner folded to empty).
  ro.result?.ownerRemoved === true
    ? ok(`remove-owner → ownerRemoved (composite: gate + do set-space {value:null} leaf-call)`)
    : bad(`remove-owner`, ro.refused?.message || ro.result);

  const afterRemove = await loadOrFold("space", String(C), "0");
  !afterRemove?.state?.owner
    ? ok(`@C owner folds to empty (the leaf cleared)`)
    : bad(`owner-remove fold`, afterRemove?.state?.owner);

  // ── 3. gate: no newOwnerId → refuse (the word's input gate, before the floor) ──
  const n1 = await did({ kind: "space", id: String(C) }, "set-owner", {}, B_id);
  n1.refused && /newOwnerId is required/i.test(n1.refused.message)
    ? ok(`no newOwnerId → refuse "newOwnerId is required"`)
    : bad(`gate`, n1.refused?.message || n1.result);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
