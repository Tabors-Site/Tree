#!/usr/bin/env node
// verify-library — the Library / share / receive loop end-to-end.
// Boots genesis, then: the library heaven space exists; the genesis book is laid as the first
// volume (sealed by the story key); a captured word-book seals + lays on the library reel; the
// catalog lists it; resolveBook fetches the CAS body back; and a master book that IMPORTS it by
// colophon.root resolves the dependency from the library (the sealed-by-hash lockfile).
import fs from "fs"; import os from "os"; import path from "path"; import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const DB = path.join(os.tmpdir(), "story_library-" + process.pid);
process.env.PORT = "3848"; process.env.TREEOS_STORE_BASE = DB;
fs.rmSync(DB, { recursive: true, force: true });
delete process.env.MONGODB_URI;
process.env.JWT_SECRET = process.env.JWT_SECRET || "library-0123456789";
process.env.STORY_NAME = process.env.STORY_NAME || "Test Story";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "library-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "library-src"); fs.rmSync(SRC, { recursive: true, force: true }); fs.mkdirSync(SRC, { recursive: true }); fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;
// (scratch file store fresh-wiped above; no DB to drop)
await import(`${R}/begin.js`);
const { findByName, findByHeavenSpace } = await import(`${R}/seed/materials/projections.js`);
const { HEAVEN_SPACE } = await import(`${R}/seed/materials/space/heavenSpaces.js`);
const { captureBook } = await import(`${R}/seed/store/book/capture.js`);
const { makeBook } = await import(`${R}/seed/store/book/book.js`);
const { sealColophon, verifyColophon } = await import(`${R}/seed/store/book/colophon.js`);
const { receive } = await import(`${R}/seed/store/book/receive.js`);
const lib = await import(`${R}/seed/store/book/library.js`);
const { ensureGenesisBook, genesisRoot } = await import(`${R}/seed/store/book/genesisBook.js`);
const { withNameAct } = await import(`${R}/seed/sprout.js`);
const ws = await import(`${R}/seed/present/word/wordStore.js`);
const poll = async (fn, t = 20000, e = 300) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, e)); } return await fn(); };
let pass = 0, fail = 0; const ok = (l) => { pass++; console.log("  ✓ " + l); }; const bad = (l, d) => { fail++; console.log("  ✗ " + l); if (d !== undefined) console.log("      " + JSON.stringify(d).slice(0, 200)); };
console.log("\n  verify-library (share → catalog → resolve → receive)\n");
try {
  await poll(() => findByName("being", "cherub", "0"), (v) => !!v);

  // 1. The library is a story-level REEL (not a heaven space) — id = the story domain.
  const libraryId = await lib.getLibraryId();
  libraryId ? ok(`library reel id resolves (kind="library", id="${String(libraryId)}")`) : bad("no library id");

  // 2. The genesis book is NOT live-rendered at boot (a static .book of words). The library is
  //    empty until ensureGenesisBook is called ON DEMAND (a share/download) — it builds the .book
  //    of words once and lays it, idempotently.
  const preCatalog = await lib.listLibrary();
  preCatalog.length === 0
    ? ok("library is empty at boot (the genesis book is NOT live-rendered on boot)")
    : bad("library not empty at boot — something laid eagerly", preCatalog.slice(0, 3));
  const gRoot = await ensureGenesisBook();  // on-demand: build the .book of words once + lay it
  const gRoot2 = await ensureGenesisBook(); // idempotent
  const gEntry = (await lib.listLibrary()).find((e) => e.kind === "genesis");
  (gRoot && gEntry && gEntry.author && String(gRoot) === String(gRoot2))
    ? ok(`ensureGenesisBook built + laid the .book of words on demand (root ${String(gRoot).slice(0, 12)}…, by ${String(gEntry.author).slice(0, 12)}…), idempotent`)
    : bad("genesis book on-demand build/lay failed", { gRoot, gRoot2, gEntry });

  // 3. Capture a word into a book + seal it.
  await ws.bindWord("library-probe-word", { kind: "op", do: { ref: "noop" } }, {}); // declare a word to capture
  let book = await captureBook({ title: "probe language", words: ["library-probe-word"], history: "0" });
  book = sealColophon(book);
  const v = await verifyColophon(book);
  (v.ok && book.body?.words?.length === 1 && (await import(`${R}/seed/store/book/book.js`)).kindOf(book) === "language")
    ? ok(`captured + sealed a language book (1 word, root ${String(v.root).slice(0, 12)}…)`)
    : bad("capture/seal failed", { ok: v.ok, words: book.body?.words?.length });

  // 4. SHARE it onto the library reel (the direct lay mechanism the share-book op mirrors).
  const sharedRoot = book.colophon.root;
  await withNameAct("i-am", "test share", async (moment) => { await lib.layBookOnLibrary(book, { moment, by: "i-am", kind: "language" }); });
  lib.clearLibraryCache();
  const catalog1 = await lib.listLibrary();
  const entry = catalog1.find((e) => String(e.root) === String(sharedRoot));
  (entry && entry.bodyRef?.hash && entry.title === "probe language")
    ? ok(`book shared → catalog entry on the library reel (body CAS ${String(entry.bodyRef.hash).slice(0, 12)}…)`)
    : bad("share did not land a catalog entry", { entry });

  // 5. RESOLVE the book back from the library (read the reel + fetch the CAS body).
  const resolved = await lib.resolveBook(sharedRoot);
  const rv = resolved ? await verifyColophon(resolved) : { ok: false };
  (resolved && rv.ok && String(rv.root) === String(sharedRoot))
    ? ok("resolveBook fetched the CAS body back; colophon re-verifies")
    : bad("resolveBook failed / body mismatch", { found: !!resolved, ok: rv.ok });

  // 6. IMPORT — a master book that imports the shared book by root resolves it from the library.
  let master = makeBook({ title: "master", covers: { front: { imports: [{ name: "probe", root: sharedRoot }] } }, body: {} });
  master = sealColophon(master);
  const got = await receive(master, { history: "0" });
  (got.imports?.length === 1 && got.imports[0].resolved === true)
    ? ok(`a master book IMPORTS the shared book by root; receive resolved it from the library`)
    : bad("import not resolved from the library", got.imports);

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
} catch (e) {
  console.log("  ✗ threw: " + e.message); console.log("    " + String(e.stack).split("\n").slice(1, 5).join("\n    "));
  fail++;
  console.log(`\n  ${pass} passed, ${fail} failed\n`);
}
process.exit(fail > 0 ? 1 : 0);
