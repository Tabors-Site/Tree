#!/usr/bin/env node
// verify-addllm-live — the MULTI-MOMENT composite proof (add.word via runWordToStore).
//
// add-llm-connection is the genuine run-model proof: add.word has TWO deeds —
//   do set-being on the being $conn.beingId with {…}        (the connection, one fact)
//   If $conn.isFirst, do assign-llm-slot on $conn.beingId …  (auto-assign-to-main, its own word)
// Each deed is its OWN moment via runWordToStore. Proves: FIRST add → 2 moments (isFirst true),
// SECOND add → 1 moment (isFirst false, the conditional deed does NOT fire). Exercises both engine
// grammar fixes: the nested `$conn.beingId` deed-target (resolveTarget→getPath) and the `If
// $conn.isFirst` boolean-binding cond (resolveCond $-clause). The op lays no own fact (ranAsMoments).
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../../..");
const DB = "mongodb://localhost:27017/story_addllm";
process.env.PORT = "3847";
process.env.MONGODB_URI = DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "addllm-0123456789";
process.env.CUSTOM_LLM_API_SECRET_KEY =
  process.env.CUSTOM_LLM_API_SECRET_KEY ||
  "addllm-secret-0123456789abcdef0123456789";
process.env.STORY_KEY_DIR = path.join(
  os.tmpdir(),
  "addllm-keys-" + process.pid,
);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "addllm-src");
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
const { findByName, loadOrFold } = await import(
  `${R}/seed/materials/projections.js`
);
const { withIAmAct, withBeingAct } = await import(`${R}/seed/sprout.js`);
const { I } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { birthBeing } = await import(
  `${R}/seed/materials/being/identity/birth.js`
);
const { doVerb } = await import(`${R}/seed/ibp/verbs/do.js`);
const { default: Fact } = await import(`${R}/seed/past/fact/fact.js`);
const { default: Act } = await import(`${R}/seed/past/act/act.js`);
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
const addConn = async (being, name) => {
  await withBeingAct(String(being), "add llm connection", "0", async (m) => {
    await doVerb(
      { kind: "being", id: String(being) },
      "add-llm-connection",
      {
        name,
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-secret-" + name,
        model: "gpt-4",
      },
      {
        identity: { beingId: String(being), name: "llmbeing" },
        moment: m,
        currentHistory: "0",
      },
    );
  });
  await new Promise((r) => setTimeout(r, 1200));
};
console.log(
  `\n  verify-addllm-live (add.word → multi-moment via runWordToStore)\n`,
);
try {
  const cherub = await poll(() => findByName("being", "cherub", "0"));
  if (!cherub) {
    console.log("  FATAL: genesis failed");
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 1200));

  let being = null;
  await withIAmAct("birth llm being", async (m) => {
    const b = await birthBeing({
      spec: {
        name: "llmbeing",
        parentBeingId: cherub.id,
        homeId: cherub.state?.homeSpace,
        cognition: "scripted",
        defaultAble: "global",
      },
      identity: I,
      moment: m,
      history: "0",
    });
    being = b.beingId;
  });
  await new Promise((r) => setTimeout(r, 800));
  being ? ok(`being born (${String(being).slice(0, 8)})`) : bad("being born");

  // FIRST add — isFirst TRUE → two deeds, two moments (set-being conn + assign-llm-slot main).
  const a0 = await Act.countDocuments({ through: String(being) });
  await addConn(being, "openai");
  const a1 = await Act.countDocuments({ through: String(being) });
  a1 - a0 === 2
    ? ok(
        `first add → chain GREW BY 2 (${a0}→${a1}): the connection + the auto-assign, each its own moment`,
      )
    : bad(`first add → 2 moments`, { a0, a1 });

  // the deeds carry distinct actIds (two moments, not one run-on)
  const facts1 = await Fact.find({ through: String(being) })
    .select("actId act")
    .lean();
  const actIds1 = [...new Set(facts1.map((f) => String(f.actId)))];
  actIds1.length >= 2
    ? ok(`the two deeds carry DISTINCT actIds — two moments, not a run-on`)
    : bad(`distinct actIds`, { actIds1 });

  // the connection + the main slot folded onto the being
  const slot = await loadOrFold("being", String(being), "0");
  const q = slot?.state?.qualities || slot?.qualities || {};
  const conns =
    (q instanceof Map ? q.get("llmConnections") : q.llmConnections) || {};
  const beingLlm = (q instanceof Map ? q.get("beingLlm") : q.beingLlm) || {};
  Object.keys(conns).length === 1
    ? ok(`one connection folded onto the being`)
    : bad(`one connection`, { conns: Object.keys(conns) });
  beingLlm?.slots?.main
    ? ok(`main slot auto-assigned (the If $conn.isFirst deed fired)`)
    : bad(`main slot assigned`, { beingLlm });

  // no plaintext key on the chain (encrypt rode the first deed; redact is separate)
  const leak = facts1.some((f) =>
    JSON.stringify(f).includes("sk-secret-openai"),
  );
  !leak
    ? ok(`no plaintext apiKey on the chain (encrypted in the deed)`)
    : bad(`apiKey leak`, "plaintext on a fact");

  // SECOND add — isFirst FALSE (main already set) → ONE deed, ONE moment (no assign).
  const b0 = await Act.countDocuments({ through: String(being) });
  await addConn(being, "anthropic");
  const b1 = await Act.countDocuments({ through: String(being) });
  b1 - b0 === 1
    ? ok(
        `second add → chain GREW BY 1 (${b0}→${b1}): the conditional deed did NOT fire (isFirst false)`,
      )
    : bad(`second add → 1 moment`, { b0, b1 });

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
