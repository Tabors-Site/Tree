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
const DB = "mongodb://localhost:27017/story_callrender";
process.env.PORT = "3814";
process.env.MONGODB_URI = DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "callrender-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "callrender-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "callrender-src");
fs.rmSync(SRC, { recursive: true, force: true });
fs.mkdirSync(SRC, { recursive: true });
fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;

{
  const mongoose = (await import(`${R}/node_modules/mongoose/index.js`)).default;
  const conn = await mongoose.createConnection(DB).asPromise();
  await conn.dropDatabase();
  await conn.close();
}

await import(`${R}/begin.js`);

const { findByName } = await import(`${R}/seed/materials/projections.js`);
const { withIAmAct } = await import(`${R}/seed/sprout.js`);
const { I_AM } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { birthBeing } = await import(`${R}/seed/materials/being/identity/birth.js`);
const { assembleStory } = await import(`${R}/seed/present/book/assemble.js`);
const { default: Fact } = await import(`${R}/seed/past/fact/fact.js`);
const poll = async (fn, t = 60000, e = 250) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, e)); } return null; };

let pass = 0, fail = 0;
const has = (lines, needle, label) => { const l = lines.find((x) => x.includes(needle)); l ? (pass++, console.log(`  ✓ ${label}: "${l}"`)) : (fail++, console.log(`  ✗ ${label}: missing "${needle}"`)); };

console.log(`\n  verify-call-render (a call fact, rendered in the Word)\n`);
try {
  const cherub = await poll(() => findByName("being", "cherub", "0"));
  if (!cherub) { console.log("  FATAL: genesis failed"); process.exit(1); }
  await new Promise((r) => setTimeout(r, 1500));
  let sageId = null;
  await withIAmAct("birth sage", async (m) => {
    const b = await birthBeing({ spec: { name: "sage", parentBeingId: cherub.id, homeId: cherub.state?.homeSpace, cognition: "scripted", defaultAble: "global" }, identity: I_AM, moment: m, branch: "0" });
    sageId = b.beingId;
  });
  await new Promise((r) => setTimeout(r, 1000));

  // synthetic call/reply facts — assembleStory just READS them (no logFact, no call machinery)
  const now = Date.now();
  const C = String(cherub.id), S = String(sageId);
  // Real call facts carry the recipient on `of` (the right stance), NOT `to`, and content can be
  // a string (saying) OR an object (the `with` payload). Match that shape so the recipient
  // resolution + content coercion are tested as they actually run.
  const mk = (i, by, through, recipient, extra) => ({ _id: `callrender-${i}`, branch: "0", actId: `act-cr-${i}`, by, through, of: recipient ? { kind: "being", id: recipient } : null, verb: "call", act: "call", date: new Date(now + i * 1000), seq: 2000 + i, ...extra });
  await Fact.collection.insertMany([
    mk(1, C, C, S, { params: { content: "welcome to the garden" } }),                          // message → "said '…' to sage"
    mk(2, S, S, C, { inReplyTo: "callrender-1", params: { content: "thank you" } }),            // reply + message
    mk(3, C, C, S, { params: { intent: "stand-watch" } }),                                     // intent only → "called sage to stand watch"
    mk(4, C, C, S, { params: {} }),                                                            // bare reach → "called sage"
    mk(5, C, C, S, { params: { content: { able: "warrior", anchorSpaceId: "x" } } }),          // OBJECT payload, no message field → call form, NEVER "[object Object]"
    mk(6, C, C, S, { params: { content: { content: "hi there" } } }),                          // nested envelope object → extract the message
  ]);

  const world = await assembleStory("world", { branch: "0" });
  const lines = world.map((a) => a.line);
  has(lines, `said "welcome to the garden" to sage`, "plain message (call implied)");
  has(lines, `replied to cherub, and said "thank you"`, "reply with a message");
  has(lines, `called sage to stand watch`, "intent-only reach");
  has(lines, `called sage.`, "bare reach");
  has(lines, `said "hi there" to sage`, "nested envelope object → message extracted");
  // the two bugs this fix closed (the portal story rendered `cherub said "[object Object]" to someone`):
  lines.some((l) => l.includes("[object Object]")) ? (fail++, console.log(`  ✗ a line printed [object Object]`)) : (pass++, console.log(`  ✓ object payload rendered by form, never "[object Object]"`));
  lines.some((l) => l.includes("to someone")) ? (fail++, console.log(`  ✗ a line fell back to "someone"`)) : (pass++, console.log(`  ✓ recipient on \`of\` resolved (no "someone")`));

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
