// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// word-worker.mjs — the JS WRITE delegate behind the Rust front door (treeos `POST /word`).
//
// The microkernel seam: the Rust kernel owns the store + chain + transport + the READ side; this worker
// is the JS Word/write runtime behind it. Rust spawns it, pipes a JSON request on stdin, and relays the
// JSON result it prints on stdout. Today it performs the real JS stamp (commitMoment — the stamper, one
// act = one fact). The full Word evaluator (runWordToStore: parse IR -> run deeds -> seal moments) plugs
// in at this same point — it is just a richer branch of `handle()` below.
//
//   node word-worker.mjs <storeRoot>   # request JSON on stdin, result JSON on stdout
//
// Request:  { facts: [{ history, kind, id, spec }], act?: {...} }
// Response: { ok, stamped: {factIds, actId}, reels: [{ history, kind, id, facts:[...] }] }  | { ok:false, error }

import { readFileSync } from "node:fs";
import { configureStore, commitMoment, readReel } from "../../past/fileStore.js";

async function handle(req) {
  const facts = Array.isArray(req.facts) ? req.facts : [];
  if (!facts.length) {
    return { ok: false, error: "request has no facts (expected { facts: [{ history, kind, id, spec }] })" };
  }
  // The real JS write. (Swap in runWordToStore here to delegate full Word execution.)
  const stamped = await commitMoment({ act: req.act || null, facts });

  // Read the affected reels back so the caller sees what landed (the round-trip proof).
  const seen = new Set();
  const reels = [];
  for (const f of facts) {
    const key = `${f.history}:${f.kind}:${f.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    reels.push({ history: f.history, kind: f.kind, id: f.id, facts: readReel(f.history, f.kind, f.id) });
  }
  return { ok: true, stamped, reels };
}

async function main() {
  const storeRoot = process.argv[2] || null;
  configureStore(storeRoot ? { root: storeRoot } : {});
  let req = {};
  try {
    const raw = readFileSync(0, "utf8").trim(); // stdin
    req = raw ? JSON.parse(raw) : {};
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, error: `bad request json: ${e.message}` }) + "\n");
    return;
  }
  const out = await handle(req);
  process.stdout.write(JSON.stringify(out) + "\n");
}

main().catch((e) => {
  process.stdout.write(JSON.stringify({ ok: false, error: String((e && e.message) || e) }) + "\n");
});
