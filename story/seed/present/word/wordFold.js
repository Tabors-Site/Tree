// wordFold.js . the boot reads the foundation words and folds their declared verb pasts
// into the runtime tense lookup.
//
// This is what makes verbTense.js's "runtime projection of verbs.word" literally true: after
// the fold, `pastOf` reads from the Word, not from a hardcoded map. The root (seed/words/word.word)
// grounds the structure (a verb has a present and a past); the verb instances and their pasts are
// declared (verbs.word). The host reads them and calls `declarePast`, the same hook an extension
// uses. (9.md Phase 2: the boot reads word.word first and self-describes up to the surface.)
//
// SELF-DESCRIPTION IS NOT SELF-IMPLEMENTATION (9.md §2): the .words DECLARE the pasts; THIS file,
// in the kernel, is the host escape that turns the declaration into runtime behavior.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { declarePast } from "./verbTense.js";
import log from "../../seedStory/log.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED = path.resolve(__dirname, "../.."); // seed/
const STORE = path.join(SEED, "store"); // seed/store — the words live here now

// The foundation words, in descent order: the root first (grounds the structure), then the verb
// instances. As more `.word`s gather into seed/words/, they join this list.
const FOUNDATION_WORDS = [
  path.join(STORE, "words", "word.word"),
  path.join(STORE, "words", "verbs.word"),
];

// Parse "X is a verb." / "Its past is Y." pairs and declare each past. A verb's FIRST declared
// past is canonical; a later "Its past is were, for many." (a plural refinement) is ignored here.
// "A verb is a word." and "A verb has a past." do NOT match (the subject is not the verb's lemma),
// so the root's structural lines pass through untouched.
function foldVerbPasts(text) {
  let current = null;
  const declared = new Set();
  let count = 0;
  for (const line of text.split("\n")) {
    const v = line.match(/^\s*([A-Za-z][A-Za-z-]*) is a verb\b/);
    if (v) { current = v[1].toLowerCase(); continue; }
    const p = line.match(/^\s*Its past is ([A-Za-z][A-Za-z-]*)/);
    if (p && current && !declared.has(current)) {
      declarePast(current, p[1].toLowerCase());
      declared.add(current);
      count++;
    }
  }
  return count;
}

// Read the foundation words and fold their pasts. Idempotent: re-declaring a past is harmless.
// Called once at boot, before the surface (the book) renders any past tense.
export function foldWords() {
  let total = 0;
  for (const file of FOUNDATION_WORDS) {
    try {
      total += foldVerbPasts(fs.readFileSync(file, "utf8"));
    } catch (err) {
      log.warn("WordFold", `could not fold ${path.basename(file)}: ${err.message}`);
    }
  }
  log.verbose("WordFold", `folded ${total} declared verb pasts from the foundation words`);
  return total;
}

// ── the concept fold: declare each concept .word as an I_AM declare-word fact ──
//
// The companion to foldVerbPasts. Where that folds verbs.word's PASTS into the tense lookup, this
// folds the twenty concept .words onto the chain, one bindWord each, carrying {kind:"concept", says,
// axiom}. Same path as the do-ops (wordStore.declareOpsToFold) and the verb pasts: no separate
// truth-system. The descent order is declare-before-use, so the story reads the seed build on itself.
const CONCEPT_WORDS = [
  "word", "iam", "base", "chain", "history", "story", "fold", "weave",
  "see", "do", "name", "being", "space", "matter", "be", "call", "can", "recall", "role", "roleflow",
];

// Split a .word into its declaration body (the `says`) and its # header (the axiom + host pointer).
function readConceptWord(name) {
  const text = fs.readFileSync(path.join(STORE, "words", `${name}.word`), "utf8");
  const header = [], body = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("#")) header.push(line.replace(/^#\s?/, ""));
    else body.push(line);
  }
  return { says: body.join("\n").trim(), axiom: header.join("\n").trim() };
}

// Declare every concept word into the fold, in descent order, each through bindWord as an I_AM
// declare-word fact carrying {kind:"concept", says, axiom}. Dedup by word is the wordStore guard.
export async function declareConcepts({ moment = null, branch = "0" } = {}) {
  const { bindWord } = await import("./wordStore.js");
  let count = 0;
  for (const name of CONCEPT_WORDS) {
    try {
      const { says, axiom } = readConceptWord(name);
      await bindWord(name, { kind: "concept", says, axiom }, { moment, branch, skipIfUnchanged: true });
      count++;
    } catch (err) {
      log.warn("WordFold", `could not declare concept word ${name}: ${err.message}`);
    }
  }
  log.verbose("WordFold", `declared ${count} concept words into the fold`);
  return count;
}

// ── the genesis fold: one boot step, six shapes, one fold ──
//
// (1) the verb pasts → declarePast (the runtime tense, sync); (2) the concept .words → bindWord
// ({kind:"concept"}); (3) the do-ops → wordStore.declareOpsToFold ({kind:"op"}); (4) the matter
// types → wordStore.declareTypesToFold ({kind:"type"}); (5) the reducers → declareReducersToFold
// ({kind:"reducer"}, the per-kind fold logic); (6) the role-words → declareRoleWordsToFold
// ({kind:"roleword"}, role:op -> .word source). All land as declare-word facts, folded together,
// read by kind. After this the story reads the seed in full: the concepts as their bodies, the ops,
// types, reducers, and role-words declared beside them. This is the shared seam, the one boot call
// both halves meet at; wire it after the story is established, before the surface renders.
export async function seedFold({ moment = null, branch = "0" } = {}) {
  foldWords();                                 // verb pasts, sync, the tense lookup
  await declareConcepts({ moment, branch });   // the concept descent, this half
  const store = await import("./wordStore.js");
  if (typeof store.declareOpsToFold === "function") {
    await store.declareOpsToFold({ moment, branch }); // the do-ops, the wordStore half
  }
  if (typeof store.declareTypesToFold === "function") {
    await store.declareTypesToFold({ moment, branch }); // the matter types, same shape (kind:"type")
  }
  if (typeof store.declareReducersToFold === "function") {
    await store.declareReducersToFold({ moment, branch }); // the per-kind reducers (kind:"reducer")
  }
  if (typeof store.declareRoleWordsToFold === "function") {
    await store.declareRoleWordsToFold({ moment, branch }); // the role-words (kind:"roleword")
  }
  return true;
}
