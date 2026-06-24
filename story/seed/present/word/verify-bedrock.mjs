#!/usr/bin/env node
// verify-bedrock — the I bedrock guard, now general in wordStore (every word kind, not just
// able-words): an I word declared on heaven ("0") cannot be re-declared or disabled on "0" by a
// non-I actor; per-branch shadowing (a non-"0" branch) is allowed; I may always change its own.
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const DB = "mongodb://localhost:27017/story_bedrock";
process.env.PORT = "3845";
process.env.MONGODB_URI = DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "bedrock-0123456789";
process.env.STORY_KEY_DIR = path.join(
  os.tmpdir(),
  "bedrock-keys-" + process.pid,
);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "bedrock-src");
fs.rmSync(SRC, { recursive: true, force: true });
fs.mkdirSync(SRC, { recursive: true });
fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;
{
  const mongoose = (await import(`${R}/node_modules/mongoose/index.js`))
    .default;
  const conn = await mongoose.createConnection(DB).asPromise();
  await conn.dropDatabase();
  await conn.close();
}
await import(`${R}/begin.js`);
const { findByName } = await import(`${R}/seed/materials/projections.js`);
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
const NOT_IAM = "0xNOT-I-AM-a-fake-being-id";
console.log("\n  verify-bedrock (the I genesis guard in wordStore)\n");
try {
  await poll(
    () => findByName("being", "cherub", "0"),
    (v) => !!v,
  );
  // I declares a "0" word (actorBeingId null => I) — it becomes bedrock.
  await ws.bindWord(
    "test-bedrock-word",
    { kind: "op", do: { ref: "noop" } },
    {},
  );
  // a real seed word is bedrock too: a non-I cannot disable "set-space" on "0"
  let blocked = false;
  try {
    await ws.disableWord("set-space", { actorBeingId: NOT_IAM, history: "0" });
  } catch (e) {
    blocked = /bedrock/.test(e.message);
  }
  blocked
    ? ok(
        `non-I disable of the I "0" word "set-space" is REFUSED (bedrock covers ops too)`,
      )
    : bad(`set-space not protected`, blocked);
  // a non-I cannot re-declare the bedrock word on "0"
  let reBlocked = false;
  try {
    await ws.bindWord(
      "test-bedrock-word",
      { kind: "op", do: { ref: "evil" } },
      { actorBeingId: NOT_IAM, history: "0" },
    );
  } catch (e) {
    reBlocked = /bedrock/.test(e.message);
  }
  reBlocked
    ? ok(`non-I re-declare of an I "0" word is REFUSED (bindWord guard)`)
    : bad(`re-declare not blocked`, reBlocked);
  // a non-I MAY shadow it on its own branch (not "0") — the bedrock guard must NOT fire there.
  // (the disable may still fail for an unrelated reason — the synthetic actor — but NOT as bedrock;
  // the end-to-end per-branch shadowing with a real being is exercised by verify-word-fold.)
  let bedrockOnBranch = false;
  try {
    await ws.disableWord("test-bedrock-word", {
      actorBeingId: NOT_IAM,
      history: "shadowbranch",
    });
  } catch (e) {
    bedrockOnBranch = /bedrock/.test(e.message);
  }
  !bedrockOnBranch
    ? ok(
        `the bedrock guard does NOT fire on a non-"0" branch (per-branch shadowing allowed)`,
      )
    : bad(`bedrock fired on a branch`, bedrockOnBranch);
  // I may always change its own "0" word
  let iamOk = true;
  try {
    await ws.disableWord("test-bedrock-word", { history: "0" });
  } catch (e) {
    iamOk = false;
  }
  iamOk
    ? ok(`I may disable its own "0" word (the guard never blocks I)`)
    : bad(`I blocked`, iamOk);
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (e) {
  console.log("\n  ! crashed: " + (e.stack || e.message));
  process.exit(3);
}
