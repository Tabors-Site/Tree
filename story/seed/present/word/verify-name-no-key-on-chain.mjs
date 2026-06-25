#!/usr/bin/env node
// verify-name-no-key-on-chain . the NAME key-safety floor, end to end through the verb.
//
// The risk the verb-lane swap had to clear: name:declare's handler returns `reveal` (the freshly
// minted PRIVATE KEY + 24 words) for the asker's backup. Routing NAME through the unified keystone
// (emitWordFact) made every fact carry `result: stripForAudit(result)` — and stripForAudit only
// scrubs fields NAMED in REVEAL_KEYS, so a key under a DIFFERENTLY-named sub-field of `reveal` could
// slip onto the immutable chain (the project_audit_fact_cleartext_leak class — a key, once stamped,
// can never be un-stamped). The keystone's answer is structural, not name-based: a name-op fact
// OMITS the result field ENTIRELY. This proves it composes end to end: a name op whose handler
// returns key material under fields NOT in REVEAL_KEYS still lands a fact with no key anywhere.
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const DB = path.join(os.tmpdir(), "story_namenokey-" + process.pid);
process.env.PORT = "3837";
process.env.TREEOS_STORE_BASE = DB;
fs.rmSync(DB, { recursive: true, force: true });
delete process.env.MONGODB_URI;
process.env.JWT_SECRET = process.env.JWT_SECRET || "namenokey-0123456789";
process.env.STORY_KEY_DIR = path.join(
  os.tmpdir(),
  "namenokey-keys-" + process.pid,
);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
// (scratch file store fresh-wiped above; no DB to drop)
await import(`${R}/begin.js`);
const { findByName } = await import(`${R}/seed/materials/projections.js`);
const { bindWord, registerHostHandler } = await import(
  `${R}/seed/present/word/wordStore.js`
);
const { nameVerb } = await import(`${R}/seed/ibp/verbs/name.js`);
const { withIAmAct } = await import(`${R}/seed/sprout.js`);
const { I } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { factFind, factFindOne, factCount } = await import(`${R}/seed/present/word/_factStoreTest.mjs`);
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
  `\n  verify-name-no-key-on-chain (a name-op fact NEVER carries the minted key)\n`,
);

// Secret markers planted under field names that are NOT in REVEAL_KEYS, so only the result-OMIT
// (not stripForAudit's name match) can keep them off the chain.
const PEM = "-----BEGIN-LEAK-PEM-7f3a91-----";
const RAW = "RAW-PRIVATE-KEY-LEAK-7f3a91";
const PHRASE = "wordleak ".repeat(24).trim();

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

  // A synthetic name op whose handler returns a `reveal` carrying key material under MIS-NAMED
  // sub-fields (privateKey / words / pem — none in REVEAL_KEYS). The fact must still hold none of it.
  registerHostHandler("name-op:leak-probe", async () => ({
    nameId: String(I),
    spec: { publicKey: "pub-ok" },
    reveal: { privateKey: RAW, words: PHRASE, pem: PEM, publicKey: "pub-ok" },
  }));
  await bindWord("name:leak-probe", {
    ownerExtension: "seed",
    kind: "nameop",
    do: { ref: "name-op:leak-probe" },
  });
  await new Promise((r) => setTimeout(r, 400));

  let ret;
  await withIAmAct("leak probe", async (moment) => {
    ret = await nameVerb(
      "leak-probe",
      {},
      {
        moment,
        identity: { name: "i-am", beingId: String(I), nameId: String(I) },
        currentHistory: "0",
      },
    );
  });

  const f = await pollFor(
    () => factFindOne({ verb: "name", act: "leak-probe" }),
    (v) => !!v,
  );
  if (!f) {
    bad("the name:leak-probe fact was laid", "no fact");
  } else {
    // 1. the fact carries NO result field at all (the structural omit)
    !("result" in f) || f.result == null
      ? ok(
          `the name-op fact has NO result field (the structural omit, not a redaction)`,
        )
      : bad(`name fact omits result`, { result: f.result });

    // 2. a deep scan of the ENTIRE fact finds none of the key material (under any field name)
    const blob = JSON.stringify(f);
    const leaked = [PEM, RAW, PHRASE, "wordleak"].filter((s) =>
      blob.includes(s),
    );
    leaked.length === 0
      ? ok(
          `no key material anywhere in the stamped fact (pem / raw key / mnemonic all absent)`,
        )
      : bad(`key leaked onto the fact`, { leaked });

    // 3. the fact still records the act correctly (verb/act/of-name/params)
    f.verb === "name" && f.act === "leak-probe" && f.of?.kind === "name"
      ? ok(
          `the fact still records the act (verb:name, act:leak-probe, of:{kind:name})`,
        )
      : bad(`fact shape`, { verb: f.verb, act: f.act, of: f.of });
  }

  // 4. the asker STILL receives the reveal on the RETURN (the key reaches the human, just not the chain)
  ret && ret.reveal && ret.reveal.privateKey === RAW
    ? ok(
        `the verb RETURN still carries the reveal to the asker (key delivered off-chain)`,
      )
    : bad(`asker receives reveal`, {
        reveal: ret?.reveal ? "present-but-wrong" : "missing",
      });

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
