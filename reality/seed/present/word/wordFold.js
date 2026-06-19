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
import log from "../../seedReality/log.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED = path.resolve(__dirname, "../.."); // seed/

// The foundation words, in descent order: the root first (grounds the structure), then the verb
// instances. As more `.word`s gather into seed/words/, they join this list.
const FOUNDATION_WORDS = [
  path.join(SEED, "words", "word.word"),
  path.join(SEED, "present", "word", "verbs.word"),
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
