#!/usr/bin/env node
// verify-statement — the statement bar's wire op (protocols/ibp/verbs/type.js handleType).
// A being types a Word line live: a VALID Word lands a fact under that being (first-person "I"
// assumed when omitted); an INVALID Word REJECTS with the hint and lays NOTHING; no being refuses.
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const DB = path.join(os.tmpdir(), "story_statement-" + process.pid);
process.env.PORT = "3823";
process.env.TREEOS_STORE_BASE = DB;
fs.rmSync(DB, { recursive: true, force: true });
process.env.JWT_SECRET = process.env.JWT_SECRET || "statement-0123456789";
process.env.STORY_KEY_DIR = path.join(
  os.tmpdir(),
  "statement-keys-" + process.pid,
);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "statement-src");
fs.rmSync(SRC, { recursive: true, force: true });
fs.mkdirSync(SRC, { recursive: true });
fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;
// (scratch file store fresh-wiped above; no DB to drop)
await import(`${R}/begin.js`);
const { findByName } = await import(`${R}/seed/materials/projections.js`);
const { withIAmAct } = await import(`${R}/seed/sprout.js`);
const { I } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { birthBeing } = await import(
  `${R}/seed/materials/being/identity/birth.js`
);
const { handleType } = await import(`${R}/protocols/ibp/verbs/type.js`);
const { factFind, factFindOne, factCount } = await import(
  `${R}/seed/present/word/_factStoreTest.mjs`
);
const poll = async (fn, t = 60000, e = 250) => {
  const t0 = Date.now();
  while (Date.now() - t0 < t) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, e));
  }
  return null;
};
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
const callType = (socket, text) =>
  new Promise((resolve) =>
    handleType(socket, { id: "t", verb: "type", payload: { text } }, (resp) =>
      resolve(resp),
    ),
  );
console.log(`\n  verify-statement (the statement bar — type wire op)\n`);
try {
  const cherub = await poll(() => findByName("being", "cherub", "0"));
  if (!cherub) {
    console.log("  FATAL: genesis failed");
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 1200));
  let typist = null;
  await withIAmAct("birth typist", async (m) => {
    const b = await birthBeing({
      spec: {
        name: "typist",
        parentBeingId: cherub.id,
        homeId: cherub.state?.homeSpace,
        cognition: "scripted",
        defaultAble: "global",
      },
      identity: I,
      moment: m,
      history: "0",
    });
    typist = b.beingId;
  });
  await new Promise((r) => setTimeout(r, 1000));
  const socket = {
    beingId: String(typist),
    name: "typist",
    nameId: String(typist),
    currentHistory: "0",
  };

  // 1. a VALID Word with no leading "I" and no period → first-person + terminator assumed → a fact lands
  const before = factCount({ act: "create-space" });
  const r1 = await callType(socket, "make notebook");
  r1?.status === "ok"
    ? ok(`valid Word accepted ("make notebook" → "I make notebook.")`)
    : bad(`valid accepted`, r1);
  const made = await poll(
    async () => factCount({ act: "create-space" }) > before,
    8000,
  );
  made
    ? ok(`a create-space fact landed under the typist`)
    : bad(`fact landed`, { before });
  const sp = factFindOne({
    act: "create-space",
    through: String(typist),
  });
  sp
    ? ok(`the new space is attributed to the typist (the "I")`)
    : bad(`attributed to typist`, "no create-space through typist");

  // 2. an INVALID Word → REJECT with the hint + NOTHING lands
  const total = factCount({});
  const r2 = await callType(socket, "zxqwv blarg nonsense word");
  r2?.status === "error" && r2?.error?.message
    ? ok(`invalid Word REJECTED with a hint: "${r2.error.message}"`)
    : bad(`invalid rejected`, r2);
  await new Promise((r) => setTimeout(r, 600));
  const total2 = factCount({});
  total2 === total
    ? ok(`nothing laid on rejection (the press failed clean, no fact forced)`)
    : bad(`no fact on reject`, { total, total2 });

  // 3. no being → refused
  const r3 = await callType({ beingId: null }, "make X");
  r3?.status === "error" && /being/i.test(r3?.error?.message || "")
    ? ok(`no being → refused (a Name needs a being to speak the Word)`)
    : bad(`no-being refused`, r3);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
