#!/usr/bin/env node
// verify-be-ops-fold . the BE verb resolves its ops from the FOLD, not the BE_OPS Map.
// (1) all six BE ops fold at genesis as kind:"beop" words named "be:<op>" (incl switch/death/
// truename — the special-branch ops in be.js); (2) resolveBeOpFromFold returns each handler; (3) the
// BE-only `bootstrap` flag (birth/connect skip assertVerbCaller) is carried correctly through the
// fold, matching the buffer; (4) BE_OPS stays only as the registration buffer (every op it lists
// resolves from the fold); (5) a SYNTHETIC be op bound to the fold resolves additively, with its
// bootstrap. Twin of verify-name-ops-fold. Live birth/connect/release dispatch is proven by the
// cherub/connect verifiers; this pins the fold + bootstrap + the special-branch ops. (I's genesis
// be:birth is a raw emitFact in sprout.js, never beVerb, so it predates + grounds this fold.)
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const DB = path.join(os.tmpdir(), "story_beopsfold-" + process.pid);
process.env.PORT = "3833";
process.env.TREEOS_STORE_BASE = DB;
fs.rmSync(DB, { recursive: true, force: true });
delete process.env.MONGODB_URI;
process.env.JWT_SECRET = process.env.JWT_SECRET || "beopsfold-0123456789";
process.env.STORY_KEY_DIR = path.join(
  os.tmpdir(),
  "beopsfold-keys-" + process.pid,
);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
// (scratch file store fresh-wiped above; no DB to drop)
await import(`${R}/begin.js`);
const { findByName } = await import(`${R}/seed/materials/projections.js`);
const { bindWord, registerHostHandler, resolveBeOpFromFold, getWordSync } =
  await import(`${R}/seed/present/word/wordStore.js`);
const { getBeOp, listBeOpNames } = await import(`${R}/seed/ibp/beOps.js`);
const pollFor = async (fn, pred, t = 12000, e = 250) => {
  const t0 = Date.now();
  while (Date.now() - t0 < t) {
    const v = await fn();
    if (pred(v)) return v;
    await new Promise((r) => setTimeout(r, e));
  }
  return await fn();
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
console.log(
  `\n  verify-be-ops-fold (BE resolves its ops from the fold, not the BE_OPS Map)\n`,
);
try {
  const cherub = await pollFor(
    () => findByName("being", "cherub", "0"),
    (v) => !!v,
  );
  if (!cherub) {
    console.log("  FATAL: genesis failed");
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 1200));

  const expected = [
    "birth",
    "connect",
    "release",
    "switch",
    "death",
    "truename",
  ];

  // (1) all six BE ops folded as kind:"beop" words "be:<op>" (incl switch/death/truename)
  const folded = expected.filter((op) => {
    const w = getWordSync(`be:${op}`);
    return w && w.kind === "beop" && w.do?.ref;
  });
  folded.length === expected.length
    ? ok(
        `all 6 BE ops folded as kind:"beop" words (be:${expected.join(", be:")})`,
      )
    : bad(`6 BE ops folded`, { folded });

  // (2) resolveBeOpFromFold returns a handler for each (incl switch/death/truename, the special branches)
  const resolved = expected.filter(
    (op) => typeof resolveBeOpFromFold(op)?.handler === "function",
  );
  resolved.length === expected.length
    ? ok(
        `resolveBeOpFromFold returns a handler for all 6 (incl the special-branch switch/death/truename)`,
      )
    : bad(`all 6 resolve a handler`, { resolved });

  // (3) the BE-only `bootstrap` flag rides the fold, matching the buffer for each op
  const bootstrapOk = expected.every(
    (op) => !!getBeOp(op).bootstrap === !!resolveBeOpFromFold(op).bootstrap,
  );
  const bootstrapTrue = expected.filter(
    (op) => resolveBeOpFromFold(op).bootstrap,
  );
  bootstrapOk
    ? ok(
        `bootstrap flag carried through the fold (true for: ${bootstrapTrue.join(", ") || "none"})`,
      )
    : bad(
        `bootstrap carry`,
        expected.map((op) => ({
          op,
          buf: !!getBeOp(op).bootstrap,
          fold: !!resolveBeOpFromFold(op).bootstrap,
        })),
      );

  // (4) the BE_OPS object is now only the registration buffer: every op it lists resolves from the fold
  const buffer = listBeOpNames();
  const agree =
    buffer.length === expected.length &&
    buffer.every(
      (op) =>
        typeof resolveBeOpFromFold(op)?.handler === "function" &&
        typeof getBeOp(op)?.handler === "function",
    );
  agree
    ? ok(
        `BE_OPS object (${buffer.length}) agrees with the fold (the demoted registration buffer)`,
      )
    : bad(`buffer<->fold agreement`, { buffer });

  // (5) a SYNTHETIC be op: bound to the fold + its handler registered, ABSENT from BE_OPS
  registerHostHandler("be-op:test-be-op", async () => ({ ok: true }));
  await bindWord("be:test-be-op", {
    ownerExtension: "seed",
    kind: "beop",
    do: { ref: "be-op:test-be-op" },
    bootstrap: true,
  });
  await new Promise((r) => setTimeout(r, 400));
  !getBeOp("test-be-op")
    ? ok(`"test-be-op" is absent from the BE_OPS object (fold-only)`)
    : bad(`should be Map-absent`, "found in BE_OPS");
  const synth = resolveBeOpFromFold("test-be-op");
  typeof synth?.handler === "function" && synth.bootstrap === true
    ? ok(
        `resolveBeOpFromFold resolves the synthetic op from the fold (with its bootstrap)`,
      )
    : bad(`synthetic resolves`, synth);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
