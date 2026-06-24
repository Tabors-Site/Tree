#!/usr/bin/env node
// verify-prohibition-law (21.md P4 — the LAW strand + cond-host predicates).
//
// Proves the three legs of the law strand land and bite:
//   (A) PROHIBITION REGISTER — running "A <able> cannot do <action>." via runWordToStore folds a
//       kind:"law" cannot word; listFoldedProhibitions reads it back (content-addressed, append-only).
//   (B) PROHIBITION-WINS — authorizeViaAbles consults the register BEFORE the positive able-walk: a
//       being whose GRANTED able is named by the cannot is refused {ok:false, reason:"prohibited by
//       law"} even though its grant would otherwise permit the action (rule 14, a cannot beats a can).
//       CRITICAL: strictly additive — a being with a DIFFERENT able is UNAFFECTED (still ok:true),
//       and with NO cannot at all the gate is a pure no-op.
//   (C) FLOORHOSTENV — floorHostEnv()'s hasAuthorityOver predicate resolves LIVE off the being-tree
//       under BOTH cond conventions (resolvedBy spread-args + seeCall {args}), so a .word's
//       `If <caller> has authority over <target>:` no longer fails closed.
//
// Run: node seed/present/word/verify-prohibition-law.mjs

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = "mongodb://localhost:27017/story_prohibitionlaw";
process.env.PORT = "3851";
process.env.MONGODB_URI = SCRATCH_DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "prohibitionlaw-0123456789";
process.env.STORY_KEY_DIR = path.join(
  os.tmpdir(),
  "prohibitionlaw-keys-" + process.pid,
);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "prohibitionlaw-src");
fs.rmSync(SRC, { recursive: true, force: true });
fs.mkdirSync(SRC, { recursive: true });
fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;

{
  const mongoose = (await import(`${R}/node_modules/mongoose/index.js`))
    .default;
  const conn = await mongoose.createConnection(SCRATCH_DB).asPromise();
  await conn.dropDatabase();
  await conn.close();
}

await import(`${R}/begin.js`);

const { findByName } = await import(`${R}/seed/materials/projections.js`);
const { withIAmAct } = await import(`${R}/seed/sprout.js`);
const { I } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { birthBeing } = await import(
  `${R}/seed/materials/being/identity/birth.js`
);
const { emitFact } = await import(`${R}/seed/past/fact/facts.js`);
const { registerAble } = await import(`${R}/seed/present/ables/registry.js`);
const { parse } = await import(`${R}/seed/present/word/parser.js`);
const { runWordToStore } = await import(
  `${R}/seed/present/word/ableWordRegistry.js`
);
const { listFoldedProhibitions } = await import(
  `${R}/seed/present/word/wordStore.js`
);
const { authorizeViaAbles } = await import(`${R}/seed/ibp/ableAuth.js`);
const { floorHostEnv } = await import(
  `${R}/seed/store/words/cherub/floorHostEnv.js`
);
const { getSpaceRootId } = await import(`${R}/seed/sprout.js`);

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

// Grant a being a registry-fallback able with story-wide reach, the same shape applyAbleGrants
// folds (do:grant-able, of=being, params{able,anchorSpaceId,grantedBy,grantedAt}). Through I-Am.
async function grantAble(beingId, able, anchorSpaceId) {
  await withIAmAct(`grant ${able} to ${beingId}`, (m) =>
    emitFact(
      {
        through: String(I),
        history: "0",
        verb: "do",
        act: "grant-able",
        of: { kind: "being", id: String(beingId) },
        params: {
          able,
          anchorSpaceId: String(anchorSpaceId),
          grantedBy: String(I),
          grantedAt: new Date().toISOString(),
        },
      },
      m,
    ),
  );
}

console.log(
  `\n  verify-prohibition-law (the law strand folds + bites; the gate stays strictly additive)\n`,
);
try {
  const cherub = await poll(() => findByName("being", "cherub", "0"));
  if (!cherub) {
    console.log("  FATAL: genesis failed");
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 1500));
  const rootId = getSpaceRootId();

  // Two custom ables, each reaching the whole story, each permitting one do action. "councilor" is
  // the one a cannot will forbid; "scribe" is the control that no law touches (the additivity proof).
  registerAble(
    "councilor",
    {
      description: "may back proposals (until a law forbids it)",
      reach: ["/**"],
      can: [{ verb: "do", word: "back-proposal" }],
    },
    "live",
  );
  registerAble(
    "scribe",
    {
      description: "may back proposals; never named by any law",
      reach: ["/**"],
      can: [{ verb: "do", word: "back-proposal" }],
    },
    "live",
  );

  // Two beings under cherub, each granted ONE of the ables.
  let councilorBeing = null,
    scribeBeing = null;
  await withIAmAct("birth councilor-being", async (m) => {
    councilorBeing = (
      await birthBeing({
        spec: {
          name: "councilor-being",
          parentBeingId: cherub.id,
          homeId: cherub.state?.homeSpace,
          cognition: "scripted",
          defaultAble: "councilor",
        },
        identity: I,
        moment: m,
        history: "0",
      })
    ).beingId;
  });
  await withIAmAct("birth scribe-being", async (m) => {
    scribeBeing = (
      await birthBeing({
        spec: {
          name: "scribe-being",
          parentBeingId: cherub.id,
          homeId: cherub.state?.homeSpace,
          cognition: "scripted",
          defaultAble: "scribe",
        },
        identity: I,
        moment: m,
        history: "0",
      })
    ).beingId;
  });
  await grantAble(councilorBeing, "councilor", rootId);
  await grantAble(scribeBeing, "scribe", rootId);
  await new Promise((r) => setTimeout(r, 1200));

  const target = { kind: "space", id: String(rootId) };
  const req = (beingId, name) => ({
    identity: { beingId: String(beingId), name },
    verb: "do",
    action: "back-proposal",
    target,
    history: "0",
  });

  // ── BEFORE the law: both beings are permitted (the positive grant reaches the root, ok:true) ──
  const pre1 = await authorizeViaAbles(req(councilorBeing, "councilor-being"));
  pre1.ok === true
    ? ok(`PRE-LAW: councilor-being may do back-proposal (granted, ok:true)`)
    : bad(`pre-law councilor should be ok:true`, pre1);
  const pre2 = await authorizeViaAbles(req(scribeBeing, "scribe-being"));
  pre2.ok === true
    ? ok(`PRE-LAW: scribe-being may do back-proposal (granted, ok:true)`)
    : bad(`pre-law scribe should be ok:true`, pre2);

  // sanity: the register is empty pre-law (the pure no-op fast path)
  listFoldedProhibitions().length === 0
    ? ok(`PRE-LAW: prohibition register is EMPTY (gate is a pure no-op)`)
    : bad(`register should be empty pre-law`, listFoldedProhibitions());

  // ── (A) fold the cannot law: "A councilor cannot do back-proposal." via runWordToStore ──
  const ir = parse("A councilor cannot do back-proposal.\n");
  await runWordToStore(ir, {
    beingId: String(I),
    name: "i-am",
    history: "0",
  });
  await new Promise((r) => setTimeout(r, 400));
  const reg = listFoldedProhibitions();
  // The parser shapes "A councilor cannot do back-proposal." → verb:"do", of:"back-proposal".
  const entry = reg.find(
    (p) => p.subject === "councilor" && p.verb === "do" && p.of === "back-proposal",
  );
  entry
    ? ok(
        `(A) running the Word folded a cannot into the register: ${JSON.stringify(entry)}`,
      )
    : bad(`(A) no cannot entry folded`, reg);

  // ── (B) PROHIBITION-WINS: councilor-being is now refused, scribe-being is UNAFFECTED ──
  const post1 = await authorizeViaAbles(req(councilorBeing, "councilor-being"));
  post1.ok === false && post1.reason === "prohibited by law"
    ? ok(
        `(B) POST-LAW: councilor-being REFUSED → {ok:false, reason:"prohibited by law"} (a cannot beats a can)`,
      )
    : bad(`(B) councilor should be prohibited`, post1);

  const post2 = await authorizeViaAbles(req(scribeBeing, "scribe-being"));
  post2.ok === true
    ? ok(
        `(B) ADDITIVE: scribe-being (different able, not named by any law) is UNAFFECTED → ok:true`,
      )
    : bad(`(B) scribe must stay ok:true — additivity violated!`, post2);

  // additive on a DIFFERENT verb too: the cannot is do:back-proposal; a see by councilor-being is
  // untouched by this law (the law's verb/object doesn't match). The law must NEVER report
  // "prohibited by law" for a request it doesn't name — proves the no-op-when-no-match leg.
  const seeReq = {
    identity: { beingId: String(councilorBeing), name: "councilor-being" },
    verb: "see",
    seeOp: "place",
    target,
    history: "0",
  };
  const seePost = await authorizeViaAbles(seeReq);
  // Whatever the see's own grant decides, the do:back-proposal cannot must NOT touch it — the result
  // is never re-labeled "prohibited by law" (the law's verb/object doesn't match a see:place).
  seePost.reason !== "prohibited by law"
    ? ok(
        `(B) ADDITIVE: a non-matching verb (see:place) is untouched by the do:back-proposal law (ok:${seePost.ok})`,
      )
    : bad(`(B) non-matching verb wrongly prohibited`, seePost);

  // I-Am bypass is unaffected by an unrelated law (no cannot names "i-am").
  const iam = await authorizeViaAbles({
    identity: { beingId: String(I), name: "i-am" },
    verb: "do",
    action: "back-proposal",
    target,
    history: "0",
  });
  iam.ok === true
    ? ok(`(B) ADDITIVE: I-Am bypass intact (no law names "i-am")`)
    : bad(`(B) I-Am bypass broken`, iam);

  // ── (C) FLOORHOSTENV: hasAuthorityOver resolves LIVE under both cond conventions ──
  const host = floorHostEnv();
  const ctx = { history: "0" };
  // resolvedBy convention: spread args fn(subject, object, ctx). cherub (the being-parent) holds
  // authority over councilor-being (it birthed it under the cherub home, I-Am chain) — but to keep
  // this deterministic we assert the SELF case (a being has authority over itself via the credential
  // axis) and the live being-tree walk for I over any being.
  const selfAuth = await host.hasCredentialAuthority(
    String(councilorBeing),
    String(councilorBeing),
    "0",
    ctx,
  );
  selfAuth === true
    ? ok(`(C) floorHostEnv.hasCredentialAuthority(self,self) → true (spread-args convention)`)
    : bad(`(C) self credential authority should be true`, selfAuth);

  // seeCall / callHost convention: a single { args } object (+ ctx).
  const iAuthEnvelope = await host.hasAuthorityOver(
    { args: [String(I), String(councilorBeing), "0"] },
    ctx,
  );
  iAuthEnvelope === true
    ? ok(
        `(C) floorHostEnv.hasAuthorityOver({args:[I, being]}) → true ({args} convention resolves live)`,
      )
    : bad(`(C) I has authority over any being (live walk)`, iAuthEnvelope);

  // a being with NO authority over another, via the spread convention → false (the predicate bites)
  const noAuth = await host.hasAuthorityOver(
    String(scribeBeing),
    String(councilorBeing),
    "0",
    ctx,
  );
  noAuth === false
    ? ok(`(C) floorHostEnv.hasAuthorityOver(scribe, councilor) → false (no authority)`)
    : bad(`(C) scribe should not have authority over councilor`, noAuth);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
