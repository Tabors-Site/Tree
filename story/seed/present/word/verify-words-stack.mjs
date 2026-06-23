// verify-words-stack.mjs — the drift check.
//
// A genesis word may only lean on words made BEFORE it (it stacks), the grammar the root leaves as
// syntax, or the host floor. Any other word is DRIFT: an ungrounded English word with no place in
// the vocabulary (the "rouses" smell — a synonym for a word that already exists).
//
// This surfaces, per concept word, every body-token that is NOT a prior concept / grammar / host /
// verb-primitive, sorted globally by how many words use it. A token used in only one word is the
// strongest drift candidate (introduced ad-hoc, never reused). Concept words that appear FORWARD
// (a body leaning on a later word) are flagged too — the body must stack, not just the header.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE = path.resolve(__dirname, "../../store/words");
const { CONCEPT_WORDS } = await import("./conceptWords.js");
const pos = Object.fromEntries(CONCEPT_WORDS.map((w, i) => [w, i]));

const stem = (w) => {
  w = w.toLowerCase().replace(/['’]s$/, "");
  for (const s of ["ing", "ed", "es", "s", "ly"]) if (w.endsWith(s) && w.length - s.length >= 2) return w.slice(0, -s.length);
  return w;
};

// the grammar/relation words the root leaves as irreducible syntax (base.word), plus the ordinary
// function words any sentence needs.
const GRAMMAR = new Set("a an the is are was were be am been of and or but not no to from with by on in at into for it its that this these those who whom what which where when how why any all none each every both either neither may can cannot must has have had as than so then only also just here there now them then their they itself oneself themselves more less most least up down out before after over under between within across through beside beyond above below save until again never always ever yet still if while whether else otherwise per about against toward upon off one two single many first last own new other another same such some that".split(/\s+/));
// the host floor (axiom bottoms) + the verb-primitives the kernel grounds (do/see + their ops).
const HOST = new Set("host stamp read hash sign key clock lot content order head place point body seal draw reading world present past now".split(/\s+/));
const VERBS = new Set("do act make give take set move grant drop lay see fold name be call hold wake".split(/\s+/));

const conceptStems = new Set(CONCEPT_WORDS.map(stem));
const inWords = {}; // stem -> Set of concept words whose body uses it
const fwdRefs = {}; // concept word -> Set of later-concept words it leans on

for (const w of CONCEPT_WORDS) {
  const i = pos[w];
  const text = fs.readFileSync(path.join(STORE, w + ".word"), "utf8");
  const body = text.split("\n").filter((l) => l.trim() && !l.startsWith("#")).join(" ");
  for (const t of (body.toLowerCase().match(/[a-z][a-z'’]*/g) || [])) {
    const s = stem(t);
    if (s === stem(w)) continue;
    if (pos[s] !== undefined) { if (pos[s] > i) (fwdRefs[w] = fwdRefs[w] || new Set()).add(s); continue; }
    if (GRAMMAR.has(s) || GRAMMAR.has(t) || HOST.has(s) || VERBS.has(s) || conceptStems.has(s)) continue;
    (inWords[s] = inWords[s] || new Set()).add(w);
  }
}

const entries = Object.entries(inWords).map(([s, set]) => [s, [...set]]).sort((a, b) => a[1].length - b[1].length || a[0].localeCompare(b[0]));
console.log("=== ungrounded body-words (count = #words using it; rare = drift candidate) ===");
for (const [s, ws] of entries) console.log(`${String(ws.length).padStart(2)}  ${s.padEnd(16)} ${ws.join(" ")}`);
const once = entries.filter(([, ws]) => ws.length === 1);
console.log(`\n${entries.length} distinct ungrounded · ${once.length} used in ONE word (drift candidates)`);
console.log("\n=== forward references (a body leaning on a LATER word — does not stack) ===");
const fwd = Object.entries(fwdRefs);
if (!fwd.length) console.log("  none — every body stacks on prior words");
for (const [w, set] of fwd) console.log(`  ${w} -> ${[...set].join(", ")}`);
