#!/usr/bin/env node
// Inspect the BOOK of a branch — the story back to the very start (genesis → live edge).
// The first step of book view: read the reality's history as the narration its facts tell.
// Usage (after a boot): node inspect-book.mjs [branch] [nameId]. Full begin.js boot, scratch DB.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = "mongodb://localhost:27017/reality_book_inspect";
process.env.PORT = "3805";
process.env.MONGODB_URI = SCRATCH_DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "book-secret-0123456789";
process.env.REALITY_KEY_DIR = path.join(os.tmpdir(), "book-keys-" + process.pid);
fs.rmSync(process.env.REALITY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "book-src");
fs.rmSync(SRC, { recursive: true, force: true });
fs.mkdirSync(SRC, { recursive: true });
fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;

{
  const mongoose = (await import(`${R}/node_modules/mongoose/index.js`)).default;
  const conn = await mongoose.createConnection(SCRATCH_DB).asPromise();
  await conn.dropDatabase();
  await conn.close();
}

await import(`${R}/begin.js`);

const { findByName } = await import(`${R}/seed/materials/projections.js`);
const { assembleBook } = await import(`${R}/seed/present/book/assemble.js`);

const poll = async (fn, t = 60000, e = 250) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, e)); } return null; };

const branch = process.argv[2] || "0";
const nameId = process.argv[3] || null;

console.log(`\n  THE BOOK of branch "${branch}"${nameId ? ` (as @${nameId})` : ""} — genesis → live edge\n`);
try {
  await poll(() => findByName("being", "cherub", "0"));
  // let the boot's word-declarations + any async genesis settle
  await new Promise((r) => setTimeout(r, 1500));
  const book = await assembleBook(branch, { nameId });
  if (!book.length) { console.log("  (the book is empty — no facts on this branch yet)"); process.exit(0); }
  for (const act of book) {
    const mark = act.mine === true ? "›" : " ";
    // one past-tense sentence per act, its deeds joined by "and"
    console.log(`  ${mark} ${act.line}`);
  }
  console.log(`\n  ${book.length} acts — the story so far, the next still unwritten at the live edge.`);
  process.exit(0);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
