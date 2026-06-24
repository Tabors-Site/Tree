#!/usr/bin/env node
// The Mode-owned + Mode-3 CUTs validated against the REAL connect handler
// (cherubBeOps.connect.handler). Mode-owned (a signed-in name → a being it owns) routes
// to cherub-connect.word flow 2; Mode-3 (inherit/father-admit) routes to flow 3. Asserts
// the handler builds the right response from the .word, and the not-owned/not-relative
// paths refuse correctly. Full begin.js boot. Scratch DB, wiped.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = "mongodb://localhost:27017/story_word_connect_cutmodes";
process.env.PORT = "3790";
process.env.MONGODB_URI = SCRATCH_DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "cutmodes-secret-0123456789";
process.env.STORY_KEY_DIR = path.join(
  os.tmpdir(),
  "cutmodes-keys-" + process.pid,
);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "cutmodes-src");
fs.rmSync(SRC, { recursive: true, force: true });
fs.mkdirSync(SRC, { recursive: true });
fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;

{
  const mongoose = (await import(`${R}/node_modules/mongoose/index.js`))
    .default;
  const conn = await mongoose.createConnection(SCRATCH_DB).asPromise();
  await conn.dropDatabase();
  await conn.close();
}

await import(`${R}/begin.js`);

const { findByName } = await import(`${R}/seed/materials/projections.js`);
const { sealFacts } = await import(`${R}/seed/past/fact/facts.js`);
const { withIAmAct } = await import(`${R}/seed/sprout.js`);
const { birthBeing } = await import(
  `${R}/seed/materials/being/identity/birth.js`
);
const { I } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { nameVerb } = await import(`${R}/seed/ibp/verbs/name.js`);
const { cherubBeOps } = await import(`${R}/seed/store/words/cherub/able.js`);
const { getStoryDomain } = await import(`${R}/seed/ibp/address.js`);
const D = getStoryDomain();

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

const cherub = await poll(() => findByName("being", "cherub", "0"));
const birth = async (name, extraSpec = {}) => {
  let bid = null;
  await withIAmAct(`birth ${name}`, async (ctx) => {
    const b = await birthBeing({
      spec: {
        name,
        parentBeingId: cherub.id,
        homeId: cherub.state?.homeSpace,
        cognition: "scripted",
        defaultAble: "global",
        ...extraSpec,
      },
      identity: I,
      moment: ctx,
      history: "0",
    });
    bid = b.beingId;
  });
  return bid;
};
async function register({ name, password, nameId }) {
  const moment = {
    actId: randomUUID(),
    actorAct: { history: "0", by: nameId || "i-am" },
    identity: { beingId: "i-am", name: "i-am", nameId: nameId || "i-am" },
    deltaF: [],
    foldedSeqs: new Map(),
    afterSeal: [],
    _inOp: true,
  };
  await cherubBeOps.birth.handler({
    payload: { name, password },
    ctx: { nameId: nameId || null, moment, req: {} },
  });
  await sealFacts(moment.deltaF);
  for (const fn of moment.afterSeal || []) {
    try {
      await fn();
    } catch {}
  }
}
async function declareName(name, password) {
  const sc = {
    actId: randomUUID(),
    actorAct: { history: "0", by: "i-am" },
    identity: { beingId: "i-am", name: "I", nameId: "i-am" },
    deltaF: [],
    foldedSeqs: new Map(),
    afterSeal: [],
  };
  const r = await nameVerb(
    "declare",
    { name, password, soulType: "human" },
    { identity: sc.identity, moment: sc, currentHistory: "0" },
  );
  await sealFacts(sc.deltaF);
  return r.nameId;
}
// drive the REAL connect handler
async function connect({ address, identity = null, nameId = null }) {
  const ctx = {
    moment: {
      actId: randomUUID(),
      actorAct: { history: "0" },
      identity: identity || { beingId: "arrival" },
      deltaF: [],
      foldedSeqs: new Map(),
      afterSeal: [],
    },
    nameId,
  };
  try {
    const res = await cherubBeOps.connect.handler({
      address,
      addressKind: "stance",
      payload: {},
      identity,
      ctx,
    });
    return { res, refused: null };
  } catch (e) {
    if (e && (e.name === "IbpError" || e.code))
      return { res: null, refused: e };
    throw e;
  }
}

console.log(
  `\n  verify-connect-cut-modes (Mode-owned + Mode-3 cuts, REAL handler)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`,
);
try {
  if (!cherub) {
    console.log("  FATAL: genesis failed");
    process.exit(1);
  }
  await register({ name: "founder", password: "founderpw1" });
  const tabor = await declareName("tabor", "taborpw12345");
  await register({
    name: "mybeing",
    password: "beingpw1234",
    nameId: String(tabor),
  });
  const daddy = await birth("daddy");
  await birth("childbeing", { parentBeingId: daddy });

  // ── Mode-owned (flow 2): signed-in tabor connects to @mybeing (no password) ──
  const owned = await connect({
    address: `${D}/@mybeing`,
    nameId: String(tabor),
  });
  owned.res?.owned === true &&
  owned.res?.identityToken &&
  owned.res?.name === "mybeing"
    ? ok(`Mode-owned cut: tabor → @mybeing → owned:true, token, name`)
    : bad(`mode-owned`, owned.refused?.message || owned.res);

  // ── Mode-owned NOT owned: a different name → falls through → Mode-3 → refuse (not relative) ──
  const mallory = await declareName("mallory", "mallorypw123");
  const notOwned = await connect({
    address: `${D}/@mybeing`,
    nameId: String(mallory),
    identity: { beingId: "mallory-being", name: "mallory" },
  });
  notOwned.refused
    ? ok(
        `Mode-owned not-owned → falls through → refused (not owner, not relative)`,
      )
    : bad(`not-owned fallthrough`, notOwned.res);

  // ── Mode-3 (flow 3): daddy inherit-connects to @childbeing it birthed ──
  const inh = await connect({
    address: `${D}/@childbeing`,
    identity: { beingId: String(daddy), name: "daddy" },
  });
  inh.res?.inherited === true &&
  inh.res?.identityToken &&
  inh.res?.name === "childbeing"
    ? ok(`Mode-3 cut: daddy → @childbeing → inherited:true, token, name`)
    : bad(`mode-3`, inh.refused?.message || inh.res);

  // ── Mode-3 not-relative: a stranger → refuse ──
  const stranger = await connect({
    address: `${D}/@childbeing`,
    identity: { beingId: "stranger-being", name: "stranger" },
  });
  stranger.refused && /inhabit beings/i.test(stranger.refused.message)
    ? ok(
        `Mode-3 stranger → refused (you can only inhabit beings you birthed/descend from)`,
      )
    : bad(`mode-3 stranger`, stranger.refused?.message || stranger.res);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
