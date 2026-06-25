#!/usr/bin/env node
// render(genesis → head) LIVE — the proof of the read side (623/8.pdf's floor): "render the trail
// from genesis to the head, and the book it hands back is a creation story." Write the chain forward
// one word at a time (genesis already did); read it back as the story. A pure SEE (a self-fold of
// the world), lays NO fact. The branch is pinned to "0" HERE because this is a test that knows the
// genesis branch — renderGenesis itself requires the branch, never defaults it.
// Run: node seed/present/book/verify-genesis-read.mjs

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH = path.join(os.tmpdir(), "story_genesis_read-" + process.pid);
process.env.PORT = "3814";
process.env.TREEOS_STORE_BASE = SCRATCH;
fs.rmSync(SCRATCH, { recursive: true, force: true });
process.env.JWT_SECRET = process.env.JWT_SECRET || "genesis-read-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "genread-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "genread-src");
fs.rmSync(SRC, { recursive: true, force: true });
fs.mkdirSync(SRC, { recursive: true });
fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;

// (scratch file store fresh-wiped above; no DB to drop)
await import(`${R}/begin.js`);

const { findByName } = await import(`${R}/seed/materials/projections.js`);
const { renderGenesis } = await import(`${R}/seed/present/book/read-trail.js`);

let pass = 0,
  fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d !== undefined) console.log(`      ${typeof d === "string" ? d : JSON.stringify(d)}`); };
const poll = async (fn, t = 60000, e = 250) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, e)); } return null; };

console.log(`\n  verify-genesis-read — render(genesis → head) = the creation story (623/8.pdf)\n`);
try {
  const cherub = await poll(() => findByName("being", "cherub", "0"));
  if (!cherub) { console.log("  FATAL: genesis failed"); process.exit(1); }
  await new Promise((r) => setTimeout(r, 1500)); // let genesis settle

  // render(genesis → head): the whole chain, read from its first mark
  const { text, book } = await renderGenesis("0");

  // 1. the chain reads back as a BOOK — non-empty, many acts (the genesis events)
  (typeof text === "string" && text.length > 0 && Array.isArray(book) && book.length >= 5)
    ? ok(`the chain reads back as a book — ${book.length} acts, ${text.length} chars of Word`)
    : bad(`renders a book`, { len: text?.length, acts: book?.length });

  // 2. it reads in CHAIN ORDER (genesis → head). The store never persists `date` (hash.js:
  //    "ordering is seq, history is the chain"), so the world book sorts by seq, the file-store
  //    truth-order. The read is therefore seq-monotonic (non-decreasing) across the acts.
  const seqs = book.map((a) => a.seq).filter((s) => s != null);
  const ordered = seqs.length > 0 && seqs.every((s, i) => i === 0 || s >= seqs[i - 1]);
  ordered ? ok(`the acts read in chain order, genesis → head (${seqs.length} by seq)`) : bad(`chain order`, seqs.slice(0, 12));

  // 3. it reads as readable WORD — the opening lines are named subjects + predicates, never raw
  //    ids or "[object Object]" (the read re-rasterizes each fact to its word, per 623/8 §03)
  const head = book.slice(0, 6).map((a) => a.line);
  const readable =
    head.length > 0 &&
    head.every((l) => typeof l === "string" && /\S+\s+\S+/.test(l) && !/\[object Object\]|undefined/.test(l));
  readable ? ok(`it reads as Word — named subjects + predicates, no raw ids`) : bad(`readable Word`, head);

  // SHOW the story — the opening of the creation, read back from the chain (623/8 §04 "THE BOOK")
  console.log(`\n  ── render(genesis → head): the opening of the story ──`);
  for (const a of book.slice(0, 14)) console.log(`     ${a.line}`);
  console.log(`     … (${book.length} acts total, read from the first mark to the head)\n`);

  console.log(`  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
