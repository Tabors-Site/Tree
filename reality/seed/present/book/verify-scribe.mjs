#!/usr/bin/env node
// The SCRIBE, end to end: it registers as a real summoned role with the NEVER-PRESS guard, it
// drafts + grounds Word from intent, it refuses what won't resolve, and it presses NOTHING —
// the draft is handed to YOU, and only YOUR press lays the fact. Proves the draft→press
// handoff and the three guards. Full boot.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = "mongodb://localhost:27017/reality_scribe";
process.env.PORT = "3807";
process.env.MONGODB_URI = SCRATCH_DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "scribe-secret-0123456789";
process.env.REALITY_KEY_DIR = path.join(os.tmpdir(), "scribe-keys-" + process.pid);
fs.rmSync(process.env.REALITY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "scribe-src");
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

const { findByName } = await import(`${R}/seed/materials/projections.js`);
const { sealFacts } = await import(`${R}/seed/past/fact/facts.js`);
const { withIAmAct } = await import(`${R}/seed/sprout.js`);
const { I_AM } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { registerRole } = await import(`${R}/seed/present/roles/registry.js`);
const { scribeRole } = await import(`${R}/seed/present/roles/scribe/role.js`);
const { draftWord } = await import(`${R}/seed/present/book/scribe.js`);
const { typeIntoBook } = await import(`${R}/seed/present/book/type.js`);
const { assembleBook } = await import(`${R}/seed/present/book/assemble.js`);

let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d !== undefined) console.log(`      ${typeof d === "string" ? d : JSON.stringify(d)}`); };
const poll = async (fn, t = 60000, e = 250) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, e)); } return null; };

console.log(`\n  verify-scribe (drafts + grounds, never presses; the press is yours)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`);
try {
  const cherub = await poll(() => findByName("being", "cherub", "0"));
  if (!cherub) { console.log("  FATAL: genesis failed"); process.exit(1); }
  await new Promise((r) => setTimeout(r, 1000));
  const home = cherub.state?.homeSpace;
  const identity = { beingId: I_AM, name: "i-am", nameId: "i-am" };

  // 1. registers as a real role, with the never-press guard
  let regErr = null;
  try { registerRole(scribeRole.name, scribeRole, "seed"); } catch (e) { regErr = e; }
  !regErr ? ok(`scribe registers as a real summoned role`) : bad(`register`, regErr.message);
  (!scribeRole.can.some((e) => e.verb === "do") && !scribeRole.permissions.includes("do"))
    ? ok(`the never-press guard: no \`do\` word in its \`can\`, see-only — it cannot commit on your behalf`)
    : bad(`never-press guard`, { can: scribeRole.can, permissions: scribeRole.permissions });
  scribeRole.requiredCognition === "llm" ? ok(`llm cognition: intent → the Word`) : bad(`cognition`, scribeRole.requiredCognition);

  // 2. drafts + grounds a valid line, refuses what won't resolve — and presses NOTHING
  const before = await assembleBook("0");
  const good = await draftWord("I make notebook.", { position: home });
  (good.parses && good.grounded && good.pressable)
    ? ok(`drafted + grounded a valid Word: "${good.draft}" (pressable)`) : bad(`good draft`, good);
  const nonsense = await draftWord("flibbertigibbet wozzle the.");
  (!nonsense.parses && !nonsense.pressable) ? ok(`refused invalid Word: ${nonsense.issues[0]}`) : bad(`refuse invalid`, nonsense);
  const ungrounded = await draftWord("I make notebook.", { position: null });
  (ungrounded.parses && !ungrounded.grounded) ? ok(`grounding caught it: ${ungrounded.issues[0]}`) : bad(`grounding`, ungrounded);

  // the unpressed stays yours: the notebook the scribe drafted is NOWHERE in the book yet
  // (robust to the boot's background facts still settling — we check for the DRAFT, not a count)
  const afterDraft = await assembleBook("0");
  !afterDraft.some((a) => /space notebook/.test(a.line))
    ? ok(`drafting laid NO fact — the unpressed stays yours (the notebook is nowhere in the book)`)
    : bad(`drafting pressed something`, afterDraft.filter((a) => /notebook/.test(a.line)).map((a) => a.line));

  // 3. the draft→press handoff: YOU press the scribe's line → the fact lands
  const priorTime = before.length ? before[before.length - 1].date : new Date(0);
  await withIAmAct("press the scribe's draft", async (sc) => {
    await typeIntoBook(good.draft, { moment: sc, identity, branch: "0", position: home });
    if (sc.deltaF.length) await sealFacts(sc.deltaF);
  });
  const fresh = await assembleBook("0", { since: priorTime });
  fresh.some((a) => /made the space notebook/.test(a.line))
    ? ok(`YOU pressed the draft → the fact landed (the draft→press handoff): "${fresh.find((a) => /made the space notebook/.test(a.line)).line}"`)
    : bad(`press handoff`, fresh.map((a) => a.line).slice(-3));

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
