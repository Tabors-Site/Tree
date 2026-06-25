#!/usr/bin/env node
// verify-receive-being — the receive-a-being-reel path end-to-end (captureBook reelOf → seal →
// receive → instateReel). This is the BOOK replacement for the old applyGraft being-graft: a being
// is shared/received as a reel-only book (no act-chain — that's the Name's, stays home). Gates the
// receiveReels/instateReel insert+verify via the book path. Delete the reel, receive it back.
import fs from "fs"; import os from "os"; import path from "path"; import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const DB = path.join(os.tmpdir(), "story_receive_being-" + process.pid);
process.env.PORT = "3850"; process.env.TREEOS_STORE_BASE = DB;
fs.rmSync(DB, { recursive: true, force: true });
process.env.JWT_SECRET = process.env.JWT_SECRET || "rcvbeing-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "rcvbeing-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "rcvbeing-src"); fs.rmSync(SRC, { recursive: true, force: true }); fs.mkdirSync(SRC, { recursive: true }); fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;
// (scratch file store fresh-wiped above; no DB to drop)
await import(`${R}/begin.js`);
const { findByName } = await import(`${R}/seed/materials/projections.js`);
const { captureBook } = await import(`${R}/seed/store/book/capture.js`);
const { sealColophon, verifyColophon } = await import(`${R}/seed/store/book/colophon.js`);
const { receive } = await import(`${R}/seed/store/book/receive.js`);
const { kindOf } = await import(`${R}/seed/store/book/book.js`);
const poll = async (fn, t = 20000, e = 300) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, e)); } return await fn(); };
let pass = 0, fail = 0; const ok = (l) => { pass++; console.log("  ✓ " + l); }; const bad = (l, d) => { fail++; console.log("  ✗ " + l); if (d !== undefined) console.log("      " + JSON.stringify(d).slice(0, 240)); };
console.log("\n  verify-receive-being (being-reel book → receive → instateReel)\n");
try {
  const cherub = await poll(() => findByName("being", "cherub", "0"), (v) => !!v);
  const beingId = String(cherub.id);

  // 1. Capture cherub's reel as a being-reel book + seal.
  let book = await captureBook({ title: "cherub", reelOf: { being: beingId, history: "0" } });
  book = sealColophon(book);
  const v = await verifyColophon(book);
  const reel0 = book.body?.reels?.[0];
  (v.ok && reel0 && reel0.being === beingId && reel0.facts.length > 0 && kindOf(book) === "history")
    ? ok(`captured cherub's reel as a book (${reel0.facts.length} facts, kind=${kindOf(book)})`)
    : bad("capture being-reel book failed", { ok: v.ok, facts: reel0?.facts?.length, kind: kindOf(book) });

  // 2. Idempotent receive (cherub's reel already present) → 0 new.
  const r0 = await receive(book, { history: "0" });
  (r0.reels === 0) ? ok(`idempotent receive: ${r0.reels} new fact(s) (reel already present)`) : bad("idempotent receive unexpected", r0);

  // 3. INSERT path: delete cherub's reel rows, then receive → the reel lands verbatim + verifies.
  // FileStore peer of the old Fact.deleteMany({of.kind:being,of.id}) + ReelHead.deleteMany({id,type:being}):
  // truncateReelTo(..., 0) rewrites the reel file empty AND resets its .head to genesis, so the reel rows
  // and the head pointer are both gone, exactly the void instateReel's dedup reads as mode "create".
  // Truncate every history the captured facts span (the same set instateReel's dedup scans).
  const { truncateReelTo } = await import(`${R}/seed/past/fileStore.js`);
  const reelHistories = [...new Set(reel0.facts.map((f) => String(f.history ?? "0")))];
  for (const h of reelHistories) truncateReelTo(h, "being", beingId, 0);
  const r1 = await receive(book, { history: "0" });
  (r1.reels === reel0.facts.length) ? ok(`INSERT receive (after delete): +${r1.reels} fact(s), reel landed + verifyReel passed`) : bad("insert receive unexpected", { got: r1.reels, want: reel0.facts.length });

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
} catch (e) {
  console.log("  ✗ threw: " + e.message); console.log("    " + String(e.stack).split("\n").slice(1, 5).join("\n    "));
  fail++;
  console.log(`\n  ${pass} passed, ${fail} failed\n`);
}
process.exit(fail > 0 ? 1 : 0);
