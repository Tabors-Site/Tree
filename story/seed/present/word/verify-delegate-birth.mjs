#!/usr/bin/env node
// verify-delegate-birth (SLICE 2 isolation) — proves the seed-delegate BIRTH mechanism for
// genesis.word WITHOUT touching boot ordering. The I speaks the generic `form a being with <spec>`
// rule (new, self-stamped) and births a being whose be:birth fact is attributed to the BEING ITSELF
// (through = the new being, never the I, never a mother — Tabor's invariant), parented to the I.
// Also proves: the existence guard makes it idempotent, and the delegate-spec floor see-op resolves
// each delegate's spec (parent=I; root-home vs heaven-home; ring coord). Full begin.js boot. Scratch
// DB, wiped. NO boot reorder here — that is the follow-up wiring slice.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = path.join(os.tmpdir(), "story_delegate_birth-" + process.pid);
process.env.PORT = "3799";
process.env.TREEOS_STORE_BASE = SCRATCH_DB;
fs.rmSync(SCRATCH_DB, { recursive: true, force: true });
delete process.env.MONGODB_URI;
process.env.JWT_SECRET = process.env.JWT_SECRET || "delegatebirth-secret-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "delegatebirth-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "delegatebirth-src");
fs.rmSync(SRC, { recursive: true, force: true });
fs.mkdirSync(SRC, { recursive: true });
fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;

// (scratch file store fresh-wiped above; no DB to drop)

await import(`${R}/begin.js`);

const { findByName, findByHeavenSpace } = await import(
  `${R}/seed/materials/projections.js`
);
const { HEAVEN_SPACE } = await import(`${R}/seed/materials/space/heavenSpaces.js`);
const { getSpaceRootId } = await import(`${R}/seed/sprout.js`);
const { I } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { parse } = await import(`${R}/seed/present/word/parser.js`);
const { runWordToStore } = await import(
  `${R}/seed/present/word/ableWordRegistry.js`
);
const { genesisHostEnv } = await import(`${R}/seed/store/genesisHost.js`);
const { factFind, factFindOne, factCount } = await import(`${R}/seed/present/word/_factStoreTest.mjs`);

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

const TEST_NAME = "genesis-test-being";
// The name rides a BINDING, never a quoted literal — a see-op paren-arg is always treated as a ref
// (the parser's argList already prefixes "$"), so the arg is the BARE binding name `testName`, NOT a
// `$`-prefixed token (that would double-prefix to `$$testName` and resolve to the literal, never the
// binding) and never a quoted literal (`findByName("x")` would look up a being literally named "x").
// Every production .word feeds see-op args this same bareword way (genesis.word's delegate names: a
// foreach loop-var or a host binding). Inside the `{ … }` object literal, `$name` is the ref form.
const birthSrc = `When the I makes the world:
  see findByName(testName) as existing.
  If no existing, form a being with { name: $testName, cognition: "scripted", defaultAble: "global", parentBeingId: $I, homeId: $root } as t.`;

console.log(
  `\n  verify-delegate-birth (slice 2 isolation: the I births a delegate via the Word)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`,
);
try {
  const root = await poll(() => {
    const id = getSpaceRootId();
    return id ? { id } : null;
  });
  const heaven = await findByHeavenSpace(HEAVEN_SPACE.HEAVEN, "0");
  if (!root || !heaven) {
    console.log("  FATAL: root/heaven not materialized");
    process.exit(1);
  }
  const rootId = String(root.id);
  ok(`boot reached: root ${rootId.slice(0, 8)}`);

  // ── the generic form-being grammar parses (both the literal and the $spec forms) ──
  try {
    const flat = JSON.stringify(parse(birthSrc));
    flat.includes('"act":"form-being"') && flat.includes('"through":"self"')
      ? ok(`"form a being with {…}" parses → be:form-being, through:"self" (self-stamped marker)`)
      : bad(`form-being parse`, flat.slice(0, 200));
  } catch (e) {
    bad(`birth Word parse threw`, e.message);
    throw e;
  }
  try {
    const r2 = parse(`When x:\n  form a being with $spec as kid.`);
    r2?.[0]?.effects?.[0]?.act === "form-being"
      ? ok(`"form a being with $spec" parses (the binding form)`)
      : bad(`$spec form parse`, r2);
  } catch (e) {
    bad(`$spec form parse threw`, e.message);
  }

  // ── the I births the test being via the Word (the SAME runWordToStore call shape as the reader) ──
  const env = { host: genesisHostEnv() };
  const run = async () => {
    const ir = parse(birthSrc);
    return runWordToStore(ir, {
      beingId: I,
      name: I,
      history: "0",
      position: rootId,
      bindings: { I, root: rootId, testName: TEST_NAME },
      env,
    });
  };
  let r1;
  try {
    r1 = await run();
    ok(`the I ran the birth Word (stamped ${r1.stamped} act(s))`);
  } catch (e) {
    bad(`birth Word run threw`, e.message);
    throw e;
  }

  const born = await findByName("being", TEST_NAME, "0");
  if (!born) {
    bad(`the test being was NOT born`);
  } else {
    ok(`the test being is born (${String(born.id).slice(0, 8)})`);
    // SELF-STAMPED: the be:birth fact's actor is the being itself, never the I, never a mother.
    const birthFact = factFindOne({
      verb: "be",
      act: "birth",
      "of.kind": "being",
      "of.id": String(born.id),
    });
    birthFact &&
    String(birthFact.through) === String(born.id) &&
    String(birthFact.through) !== String(I)
      ? ok(`be:birth is SELF-STAMPED (through = the being, not the I)`)
      : bad(`be:birth through`, {
          through: birthFact?.through,
          being: String(born.id),
          I: String(I),
        });
    // parented to the I (the seed-delegate distinction).
    String(born.state?.parentBeingId) === String(I)
      ? ok(`parented to the I (parentBeingId = I)`)
      : bad(`parentBeingId`, born.state?.parentBeingId);
    // the clean scripted spec, NOT the cherub human-wart.
    const q = born.state?.qualities;
    const cog = q instanceof Map ? q.get("cognition") : q?.cognition;
    cog?.defaultKind === "scripted" && born.state?.defaultAble === "global"
      ? ok(`scripted cognition + global able (no cherub/human wart leaked)`)
      : bad(`spec`, { cognition: cog?.defaultKind, defaultAble: born.state?.defaultAble });
  }

  // ── idempotent: the guard CLEANLY skips a re-run (no error, no second be:birth). run2Err must
  //    be null — a "Name already taken" throw would mean the guard FAILED and the name-unique check
  //    caught it (a false pass on the count alone), so assert both. ──
  let run2Err = null;
  try {
    await run();
  } catch (e) {
    run2Err = e.message;
  }
  const births = factCount({
    verb: "be",
    act: "birth",
    "of.kind": "being",
    "of.id": String((await findByName("being", TEST_NAME, "0"))?.id),
  });
  !run2Err && births === 1
    ? ok(`idempotent: the guard cleanly skipped the re-run (no error, one be:birth)`)
    : bad(`idempotency`, { run2Err, births });

  // ── delegate-spec floor see-op: parent=I, root-home vs heaven-home, coord ──
  const ds = genesisHostEnv()["delegate-spec"];
  const cherubSpec = await ds({ args: ["cherub"] });
  cherubSpec &&
  String(cherubSpec.parentBeingId) === String(I) &&
  String(cherubSpec.homeId) === rootId &&
  cherubSpec.cognition === "scripted" &&
  cherubSpec.defaultAble === "cherub"
    ? ok(`delegate-spec("cherub") → parent=I, home=root, scripted, able=cherub`)
    : bad(`delegate-spec cherub`, cherubSpec);
  const httpSpec = await ds({ args: ["http-server"] });
  httpSpec &&
  String(httpSpec.homeId) !== rootId &&
  httpSpec.coord?.x === 4
    ? ok(`delegate-spec("http-server") → homed at its heaven space (not root), room coord`)
    : bad(`delegate-spec http-server`, httpSpec);
  (await ds({ args: ["no-such-delegate"] })) === null
    ? ok(`delegate-spec(unknown) → null`)
    : bad(`delegate-spec unknown should be null`);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
