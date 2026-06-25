#!/usr/bin/env node
// The BOOK renders a CALL fact in the Word (Tabor's shape): the reach verb shows only when it
// carries weight. A REPLY → "replied to Y, and said '…'"; an intent-only reach → "called Y to
// <intent>"; a plain message IMPLIES the call → "said '…' to Y". Synthetic call facts read by
// assembleStory (the render is a pure function of the fact — no call machinery involved).

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH = path.join(os.tmpdir(), "story_callrender-" + process.pid);
process.env.PORT = "3814";
process.env.TREEOS_STORE_BASE = SCRATCH;
fs.rmSync(SCRATCH, { recursive: true, force: true });
process.env.JWT_SECRET = process.env.JWT_SECRET || "callrender-0123456789";
process.env.STORY_KEY_DIR = path.join(
  os.tmpdir(),
  "callrender-keys-" + process.pid,
);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "callrender-src");
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
const { assembleStory } = await import(`${R}/seed/present/book/assemble.js`);
const { sealFacts } = await import(`${R}/seed/past/fact/facts.js`);
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
const has = (lines, needle, label) => {
  const l = lines.find((x) => x.includes(needle));
  l
    ? (pass++, console.log(`  ✓ ${label}: "${l}"`))
    : (fail++, console.log(`  ✗ ${label}: missing "${needle}"`));
};

console.log(`\n  verify-call-render (a call fact, rendered in the Word)\n`);
try {
  const cherub = await poll(() => findByName("being", "cherub", "0"));
  if (!cherub) {
    console.log("  FATAL: genesis failed");
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 1500));
  let sageId = null;
  await withIAmAct("birth sage", async (m) => {
    const b = await birthBeing({
      spec: {
        name: "sage",
        parentBeingId: cherub.id,
        homeId: cherub.state?.homeSpace,
        cognition: "scripted",
        defaultAble: "global",
      },
      identity: I,
      moment: m,
      branch: "0",
    });
    sageId = b.beingId;
  });
  await new Promise((r) => setTimeout(r, 1000));

  // synthetic call/reply facts, sealed straight onto the reel; assembleStory just READS them
  // (no call machinery). sealFacts is the real append: it routes each spec through logFact +
  // commitMoment, which derives seq/p/_id/date, so the specs carry only the fact's content fields.
  const C = String(cherub.id),
    S = String(sageId);
  // Real call facts carry the recipient on `of` (the right stance), NOT `to`, and content can be
  // a string (saying) OR an object (the `with` payload). Match that shape so the recipient
  // resolution + content coercion are tested as they actually run. A reply marks its antecedent
  // via params.inReplyTo (the render reads `p.inReplyTo`), the file-native peer of the old
  // top-level reply pointer.
  const mk = (i, by, through, recipient, params) => ({
    history: "0",
    actId: `act-cr-${i}`,
    by,
    through,
    of: recipient ? { kind: "being", id: recipient } : null,
    verb: "call",
    act: "call",
    params: params || {},
  });
  for (const spec of [
    mk(1, C, C, S, { content: "welcome to the garden" }), // message → "said '…' to sage"
    mk(2, S, S, C, { inReplyTo: "act-cr-1", content: "thank you" }), // reply + message
    mk(3, C, C, S, { intent: "stand-watch" }), // intent only → "called sage to stand watch"
    mk(4, C, C, S, {}), // bare reach → "called sage"
    mk(5, C, C, S, { content: { able: "warrior", anchorSpaceId: "x" } }), // OBJECT payload, no message field → call form, NEVER "[object Object]"
    mk(6, C, C, S, { content: { content: "hi there" } }), // nested envelope object → extract the message
  ]) {
    await sealFacts([spec]); // one seal per fact, in order, so they read newest-last
  }

  const world = await assembleStory("world", { branch: "0" });
  const lines = world.map((a) => a.line);
  has(
    lines,
    `said "welcome to the garden" to sage`,
    "plain message (call implied)",
  );
  has(lines, `replied to cherub, and said "thank you"`, "reply with a message");
  has(lines, `called sage to stand watch`, "intent-only reach");
  has(lines, `called sage.`, "bare reach");
  has(
    lines,
    `said "hi there" to sage`,
    "nested envelope object → message extracted",
  );
  // the two bugs this fix closed (the portal story rendered `cherub said "[object Object]" to someone`):
  lines.some((l) => l.includes("[object Object]"))
    ? (fail++, console.log(`  ✗ a line printed [object Object]`))
    : (pass++,
      console.log(
        `  ✓ object payload rendered by form, never "[object Object]"`,
      ));
  lines.some((l) => l.includes("to someone"))
    ? (fail++, console.log(`  ✗ a line fell back to "someone"`))
    : (pass++, console.log(`  ✓ recipient on \`of\` resolved (no "someone")`));

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
