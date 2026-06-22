// axioms.js — the axiom anchor + the descent symmetry guard (9.md Phase 4-5; 17.md STEP 7).
//
// 9.md §2: SELF-DESCRIPTION IS NOT SELF-IMPLEMENTATION. A concept word DECLARES what it is; the
// host IMPLEMENTS it. word.word now names the distinction itself:
//   "A word that bottoms out in the host is an axiom. A word made of other words is a theorem."
// An AXIOM is the kernel floor — the bottom turtle (20.md): its meaning bottoms out in the host
// (the crypto/CAS/IO/verb primitives). A THEOREM composes from other words. Each concept .word
// declares its own kind in its `#` header: "bottoms out in the host (…)" marks an axiom, "Descends
// from …" names its grounding.
//
// This module READS the concept words from the FOLD (not the files — the Word checks itself), gives
// the machine-readable AXIOM ANCHOR (which words are axioms vs theorems), and asserts the descent
// CLOSES: every concept is in the fold, every "descends from" names a declared word, every clean
// host pointer resolves. A clean run IS "kernel == word.word" — the Word's self-description is
// complete and consistent with the host that implements it. The honest seam (20.md) stays: this
// NAMES and CHECKS the host floor, it does not remove it.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import log from "../../seedStory/log.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED = path.resolve(__dirname, "../.."); // seed/
const STORY = path.resolve(SEED, ".."); // story/ (host refs are written "seed/…", rooted at story/)

// The concept words, in descent order (the set the anchor classifies). Mirror of
// wordFold.CONCEPT_WORDS; the FOLD is the source of their content. The grammar/relation words the
// root leaves as irreducible syntax (is/a/an/has/can/of, before/after/in/over) are not concepts.
export const CONCEPT_WORDS = [
  "word", "iam", "base", "chain", "history", "story", "fold", "weave",
  "see", "do", "name", "being", "space", "matter", "be", "call", "can", "recall", "role", "roleflow",
];

// Classify one concept word from its `#` axiom header.
function classify(name, axiomHeader) {
  const axiom = String(axiomHeader || "");
  // A word is an AXIOM when its header CLAIMS host-grounding — the canonical "bottoms out in the
  // host", or "the host … delivers/implements it" (call's phrasing). Merely NAMING a host file for
  // reference ("the host registry is …", as role/roleflow do) is not a grounding claim → theorem.
  const isAxiom =
    /bottoms?\s+out\s+in\s+the\s+host/i.test(axiom) ||
    /\bthe\s+host\b[\s\S]{0,80}?\b(delivers|implements)\b/i.test(axiom);
  // Clean host pointers the header names (some axioms ground in prose — "the SEE verb" — with no
  // path; still axioms). We can only existence-check the ones written as `seed/…` paths. Strip
  // trailing punctuation (a path at a sentence end captures the period: "…/registry.js.").
  const hostRefs = [...new Set((axiom.match(/seed\/[A-Za-z0-9_./-]+/g) || []).map((r) => r.replace(/[./]+$/, "")))];
  // Descent: the comma-separated `X.word` list after "Descends from". The list itself contains
  // periods ("word.word, do.word"), so match the run of `X.word` tokens directly rather than
  // stopping at the first ".".
  let descendsFrom = [];
  const dm = axiom.match(/Descends? from\s+((?:[a-z][a-z-]*\.word(?:,?\s*)?)+)/i);
  if (dm) {
    descendsFrom = [...new Set((dm[1].match(/([a-z][a-z-]*)\.word/gi) || []).map((s) => s.replace(/\.word$/i, "").toLowerCase()))];
  }
  return { word: name, kind: isAxiom ? "axiom" : "theorem", isAxiom, hostRefs, descendsFrom };
}

/**
 * getAxiomAnchor — read the concept words from the fold and classify each (9.md Phase 4). Returns
 * [{ word, kind:"axiom"|"theorem", isAxiom, hostRefs, descendsFrom, inFold }] in descent order.
 * @param {(name:string)=>any} getWordSync  the fold reader (wordStore.getWordSync)
 */
export function getAxiomAnchor(getWordSync) {
  return CONCEPT_WORDS.map((name) => {
    const w = getWordSync ? getWordSync(name) : null;
    return { ...classify(name, w?.axiom), inFold: !!w };
  });
}

/**
 * assertDescentSymmetry — the boot guard (9.md Phase 5 / 17.md STEP 7). Checks:
 *   (1) every concept word is in the fold (the descent landed — self-description is complete);
 *   (2) every "descends from" names a declared concept (no dangling descent);
 *   (3) every clean `seed/…` host pointer exists (the named host implementation is present).
 * A clean run is "kernel == word.word". SOFT by default (logs, returns) during the transition;
 * pass { strict:true } to throw (a boot error) once the foundation is clean.
 * @returns {{ axioms:string[], theorems:string[], issues:string[], ok:boolean, anchor:object[] }}
 */
export function assertDescentSymmetry(getWordSync, { strict = false } = {}) {
  const anchor = getAxiomAnchor(getWordSync);
  const declared = new Set(anchor.map((a) => a.word));
  const issues = [];

  for (const a of anchor) {
    if (!a.inFold) { issues.push(`concept "${a.word}" is not in the fold (descent incomplete)`); continue; }
    for (const dep of a.descendsFrom) {
      if (!declared.has(dep)) issues.push(`"${a.word}" descends from "${dep}.word", which is not a declared concept`);
    }
    for (const ref of a.hostRefs) {
      if (!fs.existsSync(path.resolve(STORY, ref))) issues.push(`"${a.word}" names host "${ref}", which does not exist`);
    }
  }

  const axioms = anchor.filter((a) => a.isAxiom).map((a) => a.word);
  const theorems = anchor.filter((a) => !a.isAxiom).map((a) => a.word);
  const ok = issues.length === 0;

  if (ok) {
    log.verbose("Axioms", `kernel == word.word: ${axioms.length} axioms bottom out in the host, ${theorems.length} theorems compose; descent closes.`);
  } else {
    log.warn("Axioms", `kernel/word.word symmetry — ${issues.length} issue(s): ${issues.slice(0, 5).join("; ")}${issues.length > 5 ? "; …" : ""}`);
    if (strict) throw new Error(`assertDescentSymmetry (strict): ${issues.join("; ")}`);
  }
  return { axioms, theorems, issues, ok, anchor };
}
