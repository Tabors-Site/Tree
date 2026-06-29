// gen_corpus_vectors.mjs — the WORD-ENGINE CONFORMANCE generator. Drives the REAL JS parser
// (seed/present/word/parser.js) over every parseable statement in the real `.word` vocabulary and
// writes corpus.vectors.json — the golden IR the Rust `treeword` parser must reproduce byte-for-byte.
//
// The `.word` files are doctrine PROSE interleaved with machine statements; the parser throws on prose.
// So we segment each file into statements (an indent-0 line + its indented flow-body lines) and keep
// only the ones the REAL parser accepts — that set IS the live grammar the port must cover. Run:
//   node rust/treeword/tests/gen_corpus_vectors.mjs
// (Node is a dev-time source-of-truth here; the Rust runtime needs no Node — the committed JSON is read.)

import { parse } from "../../../seed/present/word/parser.js";
import { readFileSync, readdirSync, writeFileSync, statSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const here = dirname(fileURLToPath(import.meta.url));
const SEED = join(here, "../../../seed");

function wordFilesUnder(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...wordFilesUnder(p));
    else if (e.endsWith(".word")) out.push(p);
  }
  return out;
}

// a STATEMENT = an indent-0 line + its immediately-following indented (flow-body) lines; blanks and
// # comments end the current statement (matching how the parser groups a flow header with its body).
function statementsOf(src) {
  const out = [];
  let cur = null;
  for (const ln of src.split("\n")) {
    if (/^\s*#/.test(ln) || ln.trim() === "") {
      if (cur) { out.push(cur); cur = null; }
      continue;
    }
    const indent = ln.length - ln.trimStart().length;
    if (indent === 0) { if (cur) out.push(cur); cur = ln; }
    else { cur = cur ? cur + "\n" + ln : ln; }
  }
  if (cur) out.push(cur);
  return out;
}

const files = wordFilesUnder(SEED).sort();
const seen = new Set();
const vectors = [];
let total = 0, prose = 0;
for (const f of files) {
  let src;
  try { src = readFileSync(f, "utf8"); } catch { continue; }
  for (const stmt of statementsOf(src)) {
    total++;
    if (seen.has(stmt)) continue;
    seen.add(stmt);
    try {
      const ir = parse(stmt);
      vectors.push({ text: stmt, ir });
    } catch {
      prose++; // doctrine prose (or a JS gap) — not part of the live grammar to conform to
    }
  }
}

// stable order so the committed JSON is diff-friendly across regenerations.
vectors.sort((a, b) => (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));
const outPath = join(here, "corpus.vectors.json");
writeFileSync(outPath, JSON.stringify({ vectors }, null, 0) + "\n");
console.log(`files=${files.length} statements=${total} parsed=${vectors.length} prose/skipped=${prose}`);
console.log(`wrote ${vectors.length} golden vectors -> ${outPath}`);
