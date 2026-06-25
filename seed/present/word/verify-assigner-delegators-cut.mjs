#!/usr/bin/env node
// verify-assigner-delegators-cut, the THREE llm-assigner connection-management ops
// (add-llm / assign-slot / delete-llm) are WORD-SOLE delegators, LIVE through doVerb.
// Each op is handler-less: its `.word` lays ONE entailed deed on the CALLER'S OWN being
// (`do add-llm-connection` / `do assign-llm-slot` / `do delete-llm-connection`), the seed
// ops that are themselves word-SOLE (runAsStore), so this is words all the way down. The
// op targets a SPACE (the portal addresses it at the place root), but the deed lands on the
// caller's being via `$caller`, never the space target. Proves: a REAL add via doVerb runs
// add-llm.word and the connection folds on the caller's being; assign-slot rebinds main;
// delete-llm unsets the connection; and each op's no-actor gate refuses. Full begin.js boot.
// Scratch DB.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = path.join(os.tmpdir(), "story_word_assigner_deleg_cut-" + process.pid);
process.env.PORT = "3793";
process.env.TREEOS_STORE_BASE = SCRATCH_DB;
fs.rmSync(SCRATCH_DB, { recursive: true, force: true });
process.env.JWT_SECRET = process.env.JWT_SECRET || "assignerdeleg-secret-0123456789";
process.env.STORY_KEY_DIR = path.join(
  os.tmpdir(),
  "assignerdeleg-keys-" + process.pid,
);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "assignerdeleg-src");
fs.rmSync(SRC, { recursive: true, force: true });
fs.mkdirSync(SRC, { recursive: true });
fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;
process.env.CUSTOM_LLM_API_SECRET_KEY =
  process.env.CUSTOM_LLM_API_SECRET_KEY ||
  "assignerdeleg-llm-encryption-key-0123456789ab";

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
const did = async (op, target, params, who = ident) => {
  const sc = {
    actId: randomUUID(),
    actorAct: { history: "0", by: who?.nameId || null },
    identity: who,
    deltaF: [],
    foldedSeqs: new Map(),
    afterSeal: [],
  };
  try {
    const res = await doVerb(target, op, params, {
      identity: who,
      moment: sc,
      currentHistory: "0",
    });
    if (sc.deltaF.length) await sealFacts(sc.deltaF);
    for (const cb of sc.afterSeal || []) {
      try {
        await cb();
      } catch {}
    }
    return { result: res?.result ?? res, deltaF: sc.deltaF, refused: null };
  } catch (e) {
    for (const cb of sc.afterSeal || []) {
      try {
        await cb();
      } catch {}
    }
    if (e && (e.name === "IbpError" || e.code))
      return { result: null, deltaF: sc.deltaF, refused: e };
    throw e;
  }
};
const being = async () => (await loadOrFold("being", String(I), "0"))?.state;
const conns = (st) => {
  const q = st?.qualities;
  const c = q instanceof Map ? q.get("llmConnections") : q?.llmConnections;
  return c instanceof Map ? Object.fromEntries(c) : c || {};
};
const mainSlot = (st) => {
  const q = st?.qualities;
  const m = q instanceof Map ? q.get("beingLlm") : q?.beingLlm;
  return m?.slots?.main;
};

console.log(
  `\n  verify-assigner-delegators-cut (add-llm / assign-slot / delete-llm word-SOLE delegators via doVerb)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`,
);
try {
  if (!cherub) {
    console.log("  FATAL: genesis failed");
    process.exit(1);
  }
  const { setStoryConfigValue } = await import(`${R}/seed/storyConfig.js`);
  await setStoryConfigValue("allowedLlmDomains", ["example.com"], {
    identity: ident,
  });

  resolveAbleWord("being", "add-llm") &&
  resolveAbleWord("being", "assign-slot") &&
  resolveAbleWord("being", "delete-llm")
    ? ok(`add-llm / assign-slot / delete-llm .words all resolve through the bridge`)
    : bad(`resolve`, {
        add: !!resolveAbleWord("being", "add-llm"),
        assign: !!resolveAbleWord("being", "assign-slot"),
        del: !!resolveAbleWord("being", "delete-llm"),
      });

  const spaceRoot = getSpaceRootId();
  const T = { kind: "space", id: String(spaceRoot) };

  // ── 1. add-llm at a SPACE target, but the connection folds on the CALLER'S being ──
  const addA = await did("add-llm", T, {
    name: "A",
    baseUrl: "https://example.com/a",
    model: "m",
    apiKey: "sk-a",
  });
  const idA = await poll(async () => {
    const c = conns(await being());
    const k = Object.keys(c).find((id) => c[id]?.name === "A");
    return k || null;
  }, 8000);
  idA
    ? ok(
        `add-llm (space target) lays do:add-llm-connection on the CALLER'S being: "A" id ${String(idA).slice(0, 8)}…`,
      )
    : bad(`add-llm`, addA.refused?.message || conns(await being()));

  // main auto-assigned (the entailed add-llm-connection composite's second moment) ──
  const m1 = await poll(
    async () => (mainSlot(await being()) === idA ? "y" : null),
    8000,
  );
  m1
    ? ok(`add-llm's entailed composite auto-assigned main to A (nested runAsStore deed ran)`)
    : bad(`auto-assign`, mainSlot(await being()));

  // ── 2. add a second connection, then assign-slot rebinds main ──
  const addB = await did("add-llm", T, {
    name: "B",
    baseUrl: "https://example.com/b",
    model: "m",
    apiKey: "sk-b",
  });
  const idB = await poll(async () => {
    const c = conns(await being());
    const k = Object.keys(c).find((id) => c[id]?.name === "B");
    return k || null;
  }, 8000);
  const asg = await did("assign-slot", T, { slot: "main", connectionId: idB });
  const rebind = await poll(
    async () => (mainSlot(await being()) === idB ? "y" : null),
    8000,
  );
  idB && rebind
    ? ok(`assign-slot (space target) rebinds main to B on the caller's being`)
    : bad(`assign-slot`, asg.refused?.message || { main: mainSlot(await being()), want: idB });

  // ── 3. delete-llm removes A from the caller's being ──
  const del = await did("delete-llm", T, { connectionId: idA });
  const gone = await poll(
    async () => (conns(await being())[idA] == null ? "y" : null),
    8000,
  );
  gone
    ? ok(`delete-llm (space target) unsets connection A on the caller's being`)
    : bad(`delete-llm`, del.refused?.message || conns(await being()));

  // ── 4. the no-actor gate refuses on all three ──
  const nAdd = await did(
    "add-llm",
    T,
    { name: "C", baseUrl: "https://example.com/c", model: "m", apiKey: "sk-c" },
    {},
  );
  const nAsg = await did("assign-slot", T, { slot: "main", connectionId: idB }, {});
  const nDel = await did("delete-llm", T, { connectionId: idB }, {});
  nAdd.refused && nAsg.refused && nDel.refused
    ? ok(`no actor → all three refuse (the auth gate lives IN the word)`)
    : bad(`actor gate`, {
        add: nAdd.refused?.message || nAdd.result,
        assign: nAsg.refused?.message || nAsg.result,
        del: nDel.refused?.message || nDel.result,
      });

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
