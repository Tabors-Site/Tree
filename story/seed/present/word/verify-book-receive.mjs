#!/usr/bin/env node
// verify-book-receive — the Book RECEIVE engine end-to-end on a tiny language book.
// Boots genesis, builds a one-word language book, seals it (real story-key colophon), verifies
// the seal, receives it (receiveWords → bindWord coin), asserts the word resolves, and proves a
// tampered book is REFUSED before any plant (the seal catches it, no leak).
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const DB = path.join(os.tmpdir(), "story_book_receive-" + process.pid);
process.env.PORT = "3847";
process.env.TREEOS_STORE_BASE = DB;
fs.rmSync(DB, { recursive: true, force: true });
delete process.env.MONGODB_URI;
process.env.JWT_SECRET = process.env.JWT_SECRET || "bookrcv-0123456789";
process.env.STORY_KEY_DIR = path.join(
  os.tmpdir(),
  "bookrcv-keys-" + process.pid,
);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "bookrcv-src");
fs.rmSync(SRC, { recursive: true, force: true });
fs.mkdirSync(SRC, { recursive: true });
fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;
// (scratch file store fresh-wiped above; no DB to drop)
await import(`${R}/begin.js`);
const { findByName } = await import(`${R}/seed/materials/projections.js`);
const { makeBook } = await import(`${R}/seed/store/book/book.js`);
const { sealColophon, verifyColophon } = await import(
  `${R}/seed/store/book/colophon.js`
);
const { receive } = await import(`${R}/seed/store/book/receive.js`);
const ws = await import(`${R}/seed/present/word/wordStore.js`);
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
console.log("\n  verify-book-receive (the Book receive engine, end-to-end)\n");
try {
  await poll(
    () => findByName("being", "cherub", "0"),
    (v) => !!v,
  );

  // 1. Build a tiny LANGUAGE book (one word) + seal it with the real story key.
  const WORD = "received-greeting";
  let book = makeBook({
    title: "a tiny language",
    body: {
      words: [
        {
          name: WORD,
          kind: "op",
          binding: { do: { ref: "noop" } },
          ownerExtension: "test-book",
        },
      ],
    },
  });
  book = sealColophon(book); // the story identity signs the sealed object
  const v = await verifyColophon(book);
  v.ok && !v.unsigned && v.signers?.length === 1
    ? ok(
        `book sealed + verifyColophon ok (signed by ${String(v.signers[0]).slice(0, 12)}…)`,
      )
    : bad("seal/verify failed", v);

  // 2. The word does NOT exist yet.
  const before = await ws.getWord(WORD, "0");
  !before
    ? ok(`"${WORD}" is unknown before receive`)
    : bad("word already existed", before);

  // 3. receive() the book → receiveWords binds the coin (as I on "0").
  const got = await receive(book, { history: "0" });
  got.words === 1 && got.kind === "language"
    ? ok(
        `receive landed ${got.words} word(s), kind="${got.kind}", root=${String(got.root).slice(0, 12)}…`,
      )
    : bad("receive did not land the word", got);

  // 4. The word now resolves (the coin folded).
  const after = await poll(
    () => ws.getWord(WORD, "0"),
    (w) => !!w,
  );
  after && after.word === WORD
    ? ok(`"${WORD}" resolves after receive (coin folded)`)
    : bad("word did not resolve after receive", after);

  // 5. A TAMPERED book is refused before any plant (the seal catches it; nothing leaks).
  const book2base = makeBook({
    title: "tampered",
    body: {
      words: [
        { name: "tampered-word", kind: "op", binding: { do: { ref: "noop" } } },
      ],
    },
  });
  const book2 = sealColophon(book2base);
  book2.body.words[0].name = "EVIL-SWAP"; // mutate AFTER sealing → root no longer matches
  let refused = false;
  try {
    await receive(book2, { history: "0" });
  } catch (e) {
    refused = /colophon verification failed|root mismatch/i.test(e.message);
  }
  const leaked = await ws.getWord("EVIL-SWAP", "0");
  refused && !leaked
    ? ok("a tampered book is REFUSED before any word plants (no leak)")
    : bad("tamper not refused / leaked", { refused, leaked: !!leaked });

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
} catch (e) {
  console.log("  ✗ threw: " + e.message);
  console.log("    " + String(e.stack).split("\n").slice(1, 5).join("\n    "));
  fail++;
  console.log(`\n  ${pass} passed, ${fail} failed\n`);
}
process.exit(fail > 0 ? 1 : 0);
