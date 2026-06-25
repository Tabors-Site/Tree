// driftCheck.js — the kernel cannot drift.
//
// Every word in a concept-word body must be one of: a word made BEFORE it (a prior concept — it
// stacks), the grammar the root leaves as syntax (base.word), the host floor, a verb-primitive, a
// word the book itself DEFINES, or a member of the curated genesis vocabulary (ALLOW). Anything
// else is DRIFT — an ungrounded English word with no page: the "rouses" smell, a synonym for a word
// that already exists.
//
// `assertNoDrift()` throws on drift; the boot calls it (axioms.js), so no filler can ever enter the
// kernel unseen. To admit a genuinely NEW word, add its stem to ALLOW on purpose — that explicit
// door is the only one. This is the engine check that the words actually stack and the .word is not
// BS drift.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { CONCEPT_WORDS } from "./conceptWords.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE = path.resolve(__dirname, "../../store/words");
const pos = Object.fromEntries(CONCEPT_WORDS.map((w, i) => [w, i]));
const stem = (w) => {
  w = w.toLowerCase().replace(/['’]s$/, "");
  for (const s of ["ing", "ed", "es", "s", "ly"]) if (w.endsWith(s) && w.length - s.length >= 2) return w.slice(0, -s.length);
  return w;
};

// the grammar/relation words the root leaves as irreducible syntax, plus ordinary function words.
const GRAMMAR = new Set("a an the is are was were be am been of and or but not no to from with by on in at into for it its that this these those who whom what which where when how why any all none each every both either neither may can cannot must has have had as than so then only also just here there now them their they itself oneself themselves more less most least up down out before after over under between within across through beside beyond above below save until again never always ever yet still if while whether else otherwise per about against toward upon off one two single many first last own new other another same such some".split(/\s+/));
// the host floor (axiom bottoms) and the kernel verb-primitives.
const HOST = new Set("host stamp read hash sign key clock lot content order head place point body seal draw reading world present past now".split(/\s+/));
const VERBS = new Set("do act make give take set move grant drop lay see fold name be call hold wake".split(/\s+/));
// ALLOW — the curated genesis vocabulary (the snapshot, 2026-06-23). A stem here has earned its
// page; the gate passes. A new word enters ONLY by being added here, on purpose.
const ALLOW = new Set("abl addres alone already among answer back banish behind bind birth born branch byt children claus com come conditional connect connection consciousnes copi cross death decid declar declaration default di did die disable dropp end equal export facet father file forge fork form generic giv given glb gltf go gone half hand handle heaven histori home http ibpa identity inhabitor inner intent kept kind know leav level made manner mark mine model mother mov my nam nature need noth once open owner parent pas pass path play portal position purg qualiti quality quot releas release renam repli room root scope secret seen send sent session shown signer size source spac speak stand switch tak target test text tim top true truename truth twice type unique verb voice wak web whose without yield".split(/\s+/));

// the terms a single body DEFINES — a subject ("a X is/has", "to X is", "X is/are") or a
// predicate-noun ("is a X"). Defining a word is how the book (or a being) grounds it.
function bodyDefined(body) {
  const defined = new Set();
  const b = String(body).toLowerCase();
  for (const m of b.matchAll(/\b(?:a|an|the|to)\s+([a-z'’]+)\s+(?:is|are|has|have|may|can|makes?|wakes?|grants?|folds?|takes?|does|do|needs?|tests?|reads?|sees?|stamps?|marks?|crosses?|sends?|holds?|wins?)\b/g)) defined.add(stem(m[1]));
  for (const m of b.matchAll(/\bis\s+(?:a|an|the)\s+([a-z'’]+)/g)) defined.add(stem(m[1]));
  for (const m of b.matchAll(/\b([a-z'’]+)\s+(?:is|are)\b/g)) defined.add(stem(m[1]));
  return defined;
}

function definedWords() {
  const defined = new Set();
  for (const w of CONCEPT_WORDS) {
    const body = fs.readFileSync(path.join(STORE, w + ".word"), "utf8").split("\n").filter((l) => l.trim() && !l.startsWith("#")).join(" ");
    for (const s of bodyDefined(body)) defined.add(s);
  }
  return defined;
}

// declarationDrift — the RUNTIME gate, for a word PEOPLE make (the FUSE mirror, or a do:coin).
// Unlike the kernel's FROZEN ALLOW (boot-hard, so the seed cannot drift), a being's word checks the
// LIVE, growing vocabulary: its body may lean on the grammar, the host floor, a verb-primitive, any
// KERNEL word, any word ALREADY DECLARED (declaredStems — pass the fold's current word names), or a
// term it DEFINES itself. So a being is free to coin new DEFINED words; only an ungrounded synonym
// for a word that already exists is drift — the same "rouses" smell, caught live. Returns the
// ungrounded tokens. Advisory by design: warn the maker, do not block a being's word on it.
export function declarationDrift(body, declaredStems = new Set()) {
  if (!body || typeof body !== "string") return [];
  const defined = bodyDefined(body);
  const conceptStems = new Set(CONCEPT_WORDS.map(stem));
  const drift = new Set();
  for (const t of (body.toLowerCase().match(/[a-z][a-z'’]*/g) || [])) {
    const s = stem(t);
    if (GRAMMAR.has(s) || GRAMMAR.has(t) || HOST.has(s) || VERBS.has(s) || conceptStems.has(s) || defined.has(s) || declaredStems.has(s) || declaredStems.has(t)) continue;
    drift.add(t);
  }
  return [...drift];
}

// Read every concept-word body. Returns { drift: {word: Set<token>}, fwdRefs: {word: Set<concept>} }.
export function checkDrift() {
  const conceptStems = new Set(CONCEPT_WORDS.map(stem));
  const defined = definedWords();
  const drift = {}, fwdRefs = {};
  for (const w of CONCEPT_WORDS) {
    const i = pos[w];
    const body = fs.readFileSync(path.join(STORE, w + ".word"), "utf8").split("\n").filter((l) => l.trim() && !l.startsWith("#")).join(" ");
    for (const t of (body.toLowerCase().match(/[a-z][a-z'’]*/g) || [])) {
      const s = stem(t);
      if (s === stem(w)) continue;
      if (pos[s] !== undefined) { if (pos[s] > i) (fwdRefs[w] = fwdRefs[w] || new Set()).add(s); continue; }
      if (GRAMMAR.has(s) || GRAMMAR.has(t) || HOST.has(s) || VERBS.has(s) || conceptStems.has(s) || defined.has(s) || ALLOW.has(s)) continue;
      (drift[w] = drift[w] || new Set()).add(t);
    }
  }
  return { drift, fwdRefs };
}

// The hard gate: throws if any body carries an ungrounded word. Called at boot.
export function assertNoDrift() {
  const { drift } = checkDrift();
  const words = Object.entries(drift);
  if (words.length) {
    const list = words.map(([w, set]) => `${w}{${[...set].join(",")}}`).join(" ");
    throw new Error(`genesis drift — ungrounded words with no page (reword to grounded, or add the stem to driftCheck ALLOW on purpose): ${list}`);
  }
}
