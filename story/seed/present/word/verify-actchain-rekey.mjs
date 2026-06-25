#!/usr/bin/env node
// verify-actchain-rekey — the act-chain key is now <story>:<history>:<being>.
// Boots genesis, asserts every ActHead _id is 3-segment + story-prefixed with matching
// story/history/beingId fields, and verifyActChain(story, history, being) walks every chain
// clean. Then lays another act and proves the chain advances + re-verifies (the corruption
// class — interleaved branches / unscoped stories — is structurally gone).
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const DB = path.join(os.tmpdir(), "story_actchain_rekey-" + process.pid);
process.env.PORT = "3846";
process.env.TREEOS_STORE_BASE = DB;
fs.rmSync(DB, { recursive: true, force: true });
delete process.env.MONGODB_URI;
process.env.JWT_SECRET = process.env.JWT_SECRET || "actchain-0123456789";
process.env.STORY_KEY_DIR = path.join(
  os.tmpdir(),
  "actchain-keys-" + process.pid,
);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "actchain-src");
fs.rmSync(SRC, { recursive: true, force: true });
fs.mkdirSync(SRC, { recursive: true });
fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;
// (scratch file store fresh-wiped above; no DB to drop)
await import(`${R}/begin.js`);
const { findByName } = await import(`${R}/seed/materials/projections.js`);
const { getStoryDomain } = await import(`${R}/seed/ibp/address.js`);
const { listActHeads } = await import(`${R}/seed/past/fileStore.js`);
const { verifyActChain } = await import(`${R}/seed/past/act/actHash.js`);
const ws = await import(`${R}/seed/present/word/wordStore.js`);
const poll = async (fn, t = 20000, e = 300) => {
  const t0 = Date.now();
  while (Date.now() - t0 < t) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, e));
  }
  return await fn();
};
let pass = 0,
  fail = 0;
const ok = (l) => {
  pass++;
  console.log("  ✓ " + l);
};
const bad = (l, d) => {
  fail++;
  console.log("  ✗ " + l);
  if (d !== undefined) console.log("      " + JSON.stringify(d));
};
console.log(
  "\n  verify-actchain-rekey (act-chain key = <story>:<history>:<being>)\n",
);
try {
  await poll(
    () => findByName("being", "cherub", "0"),
    (v) => !!v,
  );
  const story = getStoryDomain();
  console.log(`  story = "${story}"`);

  // 1. SHAPE — every ActHead _id is 3-segment, story-prefixed, with fields matching the _id.
  const heads = listActHeads(story);
  heads.length > 0
    ? ok(`genesis produced ${heads.length} act-chain head(s)`)
    : bad("no act-chain heads after genesis");
  let shapeOk = heads.length > 0,
    fieldsOk = true;
  for (const h of heads) {
    const seg = String(h._id).split(":");
    if (seg.length !== 3 || seg[0] !== story) shapeOk = false;
    if (h.story !== story || typeof h.history !== "string" || !h.beingId)
      fieldsOk = false;
    if (`${h.story}:${h.history}:${h.beingId}` !== String(h._id))
      fieldsOk = false;
  }
  shapeOk
    ? ok(`every ActHead _id is "<story>:<history>:<being>" (story="${story}")`)
    : bad(
        "an ActHead _id is not 3-segment story-prefixed",
        heads.map((h) => h._id).slice(0, 6),
      );
  fieldsOk
    ? ok(
        "every ActHead carries story/history/beingId fields that reconstruct its _id",
      )
    : bad("an ActHead field disagrees with its _id", heads.slice(0, 3));

  // 2. VERIFY — verifyActChain(story, history, being) walks every chain clean.
  let allOk = true;
  const broken = [];
  for (const h of heads) {
    const v = await verifyActChain(h.story, h.history, h.beingId);
    if (!v.ok) {
      allOk = false;
      broken.push({ id: h._id, reason: v.reason, at: v.brokenAt });
    }
  }
  allOk
    ? ok(
        `verifyActChain(story, history, being) walks all ${heads.length} chain(s) end-to-end clean`,
      )
    : bad("a chain failed verifyActChain", broken.slice(0, 6));

  // 3. ADVANCE — a new act advances some chain and it re-verifies (open→seal→CAS-advance path).
  const before = new Map(heads.map((h) => [String(h._id), String(h.headHash)]));
  await ws.bindWord(
    "actchain-probe-word",
    { kind: "op", do: { ref: "noop" } },
    {},
  ); // I act on "0"
  const after = listActHeads(story);
  const changed = after.filter(
    (h) => before.get(String(h._id)) !== String(h.headHash),
  );
  let advOk = changed.length > 0;
  for (const h of changed) {
    const v = await verifyActChain(h.story, h.history, h.beingId);
    if (!v.ok) advOk = false;
  }
  advOk
    ? ok(
        `a new act advanced ${changed.length} chain(s); each re-verifies clean (no fork, no interleave)`,
      )
    : bad("no chain advanced / advanced chain failed verify", {
        changed: changed.map((h) => h._id),
      });

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
} catch (e) {
  console.log("  ✗ threw: " + e.message);
  console.log("    " + String(e.stack).split("\n").slice(1, 4).join("\n    "));
  fail++;
  console.log(`\n  ${pass} passed, ${fail} failed\n`);
}
process.exit(fail > 0 ? 1 : 0);
