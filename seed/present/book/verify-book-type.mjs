#!/usr/bin/env node
// The LIVE-TYPING loop, end to end: type a Word line → it evaluates in an act → a fact lands
// at the live edge → the book shows the new line. Proves book view's authoring half: the
// inverse of inspect-book (read the past) is type-into-book (write the present). Full boot.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH = path.join(os.tmpdir(), "story_book_type-" + process.pid);
process.env.PORT = "3806";
process.env.TREEOS_STORE_BASE = SCRATCH;
fs.rmSync(SCRATCH, { recursive: true, force: true });
process.env.JWT_SECRET = process.env.JWT_SECRET || "booktype-secret-0123456789";
process.env.STORY_KEY_DIR = path.join(
  os.tmpdir(),
  "booktype-keys-" + process.pid,
);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "booktype-src");
fs.rmSync(SRC, { recursive: true, force: true });
fs.mkdirSync(SRC, { recursive: true });
fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;

// (scratch file store fresh-wiped above; no DB to drop)
await import(`${R}/begin.js`);

const { findByName } = await import(`${R}/seed/materials/projections.js`);
const { sealFacts } = await import(`${R}/seed/past/fact/facts.js`);
const { withIAmAct } = await import(`${R}/seed/sprout.js`);
const { I } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { assembleBook } = await import(`${R}/seed/present/book/assemble.js`);
const { typeIntoBook } = await import(`${R}/seed/present/book/type.js`);

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

console.log(
  `\n  verify-book-type (type a Word line → fact at the live edge → book shows it)\n  store: ${SCRATCH}\n`,
);
try {
  const cherub = await poll(() => findByName("being", "cherub", "0"));
  if (!cherub) {
    console.log("  FATAL: genesis failed");
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 1200));

  // the live edge before the press — the latest moment already written (the global story order
  // is TIME, since seq is per-reel; the timeline scrubs by this)
  const before = await assembleBook("0");
  const priorTime = before.length
    ? before[before.length - 1].date
    : new Date(0);
  const identity = { beingId: I, name: "i-am", nameId: "i-am" };

  // PRESS a Word line into an act (the genesis-author act); the act seals the ink
  let typed = null,
    err = null;
  await withIAmAct("type into book", async (sc) => {
    try {
      typed = await typeIntoBook("I make notebook.", {
        moment: sc,
        identity,
        branch: "0",
        position: cherub.state?.homeSpace,
      });
      if (sc.deltaF.length) await sealFacts(sc.deltaF);
    } catch (e) {
      err = e;
    }
  });

  !err && typed?.ok
    ? ok(
        `typed line parsed + evaluated (laid ${typed.laid.length}: ${typed.laid.join(", ") || "—"})`,
      )
    : bad(`press failed`, err?.message || typed);
  typed?.laid?.some((l) => /create-space/.test(l))
    ? ok(`the press laid a create-space fact (the new bead)`)
    : bad(`expected create-space`, typed?.laid);

  // the book now shows the new act at the live edge — re-read ONLY the tail (the live update),
  // and it reads in the WORD, past tense ("made the space notebook"), not do:create-space
  const fresh = await assembleBook("0", { since: priorTime });
  const newAct = fresh.find(
    (a) =>
      /made the space notebook/.test(a.line) ||
      a.landings.some((l) => /made the space notebook/.test(l.did)),
  );
  newAct
    ? ok(
        `the book updated live, in the Word — "${newAct.line}" (past tense, not do:create-space)`,
      )
    : bad(`new line not in the book tail`, fresh.map((a) => a.line).slice(-4));

  // append-only: the past is frozen, exactly one new act at the edge
  const afterAll = await assembleBook("0");
  afterAll.length === before.length + 1
    ? ok(
        `append-only: ${before.length} → ${afterAll.length} acts, the past untouched, one new act at the edge`,
      )
    : bad(`append-only`, {
        beforeActs: before.length,
        afterActs: afterAll.length,
      });

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
