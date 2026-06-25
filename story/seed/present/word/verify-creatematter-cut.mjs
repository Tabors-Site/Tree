#!/usr/bin/env node
// create-matter (create-matter.word), LIVE through the bridge with ZERO stubs. The actor
// gate + the §7 return are .word; resolve-birth-spec (type resolution / content-store /
// unique name / coord clamp / content-addressed id) + emitBirth (the do:create-matter fact)
// are host escapes wired by matterHost.js. Proves: a REAL create-matter via doVerb runs the
// .word, lands a content-addressed matter under a space, the fact folds the row, and the
// no-actor gate refuses. CALLER mode. Full begin.js boot. Scratch DB, wiped.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = path.join(os.tmpdir(), "story_word_creatematter_cut-" + process.pid);
process.env.PORT = "3799";
process.env.TREEOS_STORE_BASE = SCRATCH_DB;
fs.rmSync(SCRATCH_DB, { recursive: true, force: true });
delete process.env.MONGODB_URI;
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "creatematter-secret-0123456789";
process.env.STORY_KEY_DIR = path.join(
  os.tmpdir(),
  "createmattercut-keys-" + process.pid,
);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "createmattercut-src");
fs.rmSync(SRC, { recursive: true, force: true });
fs.mkdirSync(SRC, { recursive: true });
fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;

// (scratch file store fresh-wiped above; no DB to drop)

await import(`${R}/begin.js`);

const { findByName, loadOrFold } = await import(
  `${R}/seed/materials/projections.js`
);
const { sealFacts } = await import(`${R}/seed/past/fact/facts.js`);
const { I } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { getSpaceRootId } = await import(`${R}/seed/sprout.js`);
const { doVerb } = await import(`${R}/seed/ibp/verbs/do.js`);
const { resolveAbleWord } = await import(
  `${R}/seed/present/word/ableWordRegistry.js`
);

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
const ident = { beingId: I, name: "i-am", nameId: "i-am" };

const cherub = await poll(() => findByName("being", "cherub", "0"));
const create = async (target, params, who = ident) => {
  const sc = {
    actId: randomUUID(),
    actorAct: { history: "0", by: who?.nameId || null },
    identity: who,
    deltaF: [],
    foldedSeqs: new Map(),
    afterSeal: [],
  };
  try {
    const res = await doVerb(target, "create-matter", params, {
      identity: who,
      moment: sc,
      currentHistory: "0",
    });
    if (sc.deltaF.length) await sealFacts(sc.deltaF);
    return { result: res?.result ?? res, deltaF: sc.deltaF, refused: null };
  } catch (e) {
    if (e && (e.name === "IbpError" || e.code))
      return { result: null, deltaF: sc.deltaF, refused: e };
    throw e;
  }
};

console.log(
  `\n  verify-creatematter-cut (REAL create-matter op via doVerb → the cut)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`,
);
try {
  if (!cherub) {
    console.log("  FATAL: genesis failed");
    process.exit(1);
  }
  resolveAbleWord("matter", "create-matter")
    ? ok(`create-matter.word resolves through the bridge (self-registered)`)
    : bad(`resolves`, "null");

  const rootSpace = String(getSpaceRootId());

  // ── 1. create a text matter under the root space → content-addressed matterId ──
  const c = await create(
    { kind: "space", id: rootSpace },
    { name: "hello.txt", content: "hello world\n" },
  );
  c.result?.matterId && String(c.result?.spaceId) === rootSpace
    ? ok(
        `create-matter under root → matterId returned, spaceId = root (the .word resolve-birth-spec + emitBirth ran)`,
      )
    : bad(`create`, c.refused?.message || c.result);

  // ── 2. the do:create-matter fact lands, content-addressed, attributed to the caller ──
  const cf = (c.deltaF || []).find((f) => f.act === "create-matter");
  cf &&
  String(cf.of?.id) === String(c.result?.matterId) &&
  String(cf.through) === String(I)
    ? ok(
        `do:create-matter fact lands: of.id = the content-addressed matterId, through = the caller (I)`,
      )
    : bad(`fact`, cf ? { ofId: cf.of?.id, through: cf.through } : "no fact");

  // ── 3. the matter row folds (name + type + spaceId) ──
  const slot = await loadOrFold("matter", String(c.result?.matterId), "0");
  String(slot?.state?.spaceId) === rootSpace &&
  slot?.state?.name === "hello.txt" &&
  !!slot?.state?.type
    ? ok(
        `@matter folds: name "hello.txt", type "${slot?.state?.type}", spaceId = root`,
      )
    : bad(`fold`, slot?.state);

  // ── 4. unique-name floor: a second nameless text matter gets a generated unique name ──
  const c2 = await create(
    { kind: "space", id: rootSpace },
    { content: "two\n" },
  );
  const slot2 = c2.result?.matterId
    ? await loadOrFold("matter", String(c2.result.matterId), "0")
    : null;
  c2.result?.matterId && slot2?.state?.name && slot2.state.name !== "hello.txt"
    ? ok(
        `second matter (no name) → generated unique name "${slot2.state.name}" (resolveMatterName floor ran in the .word)`,
      )
    : bad(`unique name`, slot2?.state?.name);

  // ── 5. the no-actor gate refuses (the .word's "requires an identified actor") ──
  const n = await create(
    { kind: "space", id: rootSpace },
    { content: "x" },
    {},
  );
  n.refused
    ? ok(`no actor → refuse "${n.refused.message?.slice(0, 48)}..."`)
    : bad(`actor gate`, n.result);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
