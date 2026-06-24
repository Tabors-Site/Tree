#!/usr/bin/env node
// verify-reducerfold — the reducer-Map migration: each aggregate kind's reducer folds (a
// "<kind>-reducer" word carrying host-handler refs to its functions), and resolveReducerFromFold
// resolves to the SAME host functions the static registry holds — the parity that makes
// reducers.get fold-first safe. The functions stay host (the bottom turtle); only the kind->reducer
// mapping folds. (reducers.get is fold-FIRST, never fold-only: the fold engine runs get("being") at
// ensureIAm to fold I itself, before any reducer could be declared — the Map is the backstop.)
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const DB = "mongodb://localhost:27017/story_reducerfold";
process.env.PORT = "3843";
process.env.MONGODB_URI = DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "reducerfold-0123456789";
process.env.STORY_KEY_DIR = path.join(
  os.tmpdir(),
  "reducerfold-keys-" + process.pid,
);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "reducerfold-src");
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
const { resolveReducerFromFold } = await import(
  `${R}/seed/present/word/wordStore.js`
);
const reducers = await import(`${R}/seed/materials/reducers.js`);
const beingR = await import(`${R}/seed/materials/being/reducer.js`);
const matterR = await import(`${R}/seed/materials/matter/reducer.js`);
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
console.log("\n  verify-reducerfold (the per-kind reducers -> the fold)\n");
try {
  await poll(
    () => findByName("being", "cherub", "0"),
    (v) => !!v,
  );
  const types = reducers.types();
  types.length === 4 && types.every((t) => resolveReducerFromFold(t))
    ? ok(`all ${types.length} kinds fold (${types.join("/")})`)
    : bad(
        `fold coverage`,
        types.map((t) => [t, !!resolveReducerFromFold(t)]),
      );
  const b = resolveReducerFromFold("being");
  b && b.reduce === beingR.reduce && b.initial === beingR.initial
    ? ok(
        `being-reducer resolves to the SAME host functions (ref identity, not a copy)`,
      )
    : bad(`being ref identity`, {
        reduceMatch: b?.reduce === beingR.reduce,
        initialMatch: b?.initial === beingR.initial,
      });
  resolveReducerFromFold("matter").isGone === matterR.isGone
    ? ok(`matter's isGone rides the fold (the optional field is carried)`)
    : bad(
        `matter isGone`,
        resolveReducerFromFold("matter").isGone === matterR.isGone,
      );
  resolveReducerFromFold("being").isGone === undefined
    ? ok(`being has no isGone (optional field absent, matching the module)`)
    : bad(
        `being isGone should be absent`,
        resolveReducerFromFold("being").isGone,
      );
  const r = reducers.get("matter");
  typeof r.initial === "function" &&
  typeof r.reduce === "function" &&
  typeof r.isGone === "function"
    ? ok(
        `reducers.get("matter") fold-first returns a working {initial, reduce, isGone}`,
      )
    : bad(`get fold-first`, {
        initial: typeof r.initial,
        reduce: typeof r.reduce,
        isGone: typeof r.isGone,
      });
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (e) {
  console.log("\n  ! crashed: " + (e.stack || e.message));
  process.exit(3);
}
