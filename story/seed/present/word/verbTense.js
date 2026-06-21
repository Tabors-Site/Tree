// The PAST of a verb is a QUALITY the verb word declares (Tabor): a verb has a present (its
// shape in an ACT) and a past (its shape in a FACT). A verb forms its past with -ed unless it
// declares its own — the same "Its X is Y" quality-setting as matter, pointed at tense. The
// book renders a fact in past tense by READING this, not by guessing: "declare → declared" by
// the rule, "see → saw" by its own past. This is the runtime projection of verbs.word; an
// extension that adds a verb declares its past the same way (declarePast), and regular verbs
// need nothing.

// The irregular pasts now ALL live in the foundation words (verbs.word), folded at boot by wordFold.js
// (foldWords → declarePast). This map starts EMPTY and is filled from the Word: the full migration
// (9.md Phase 3) is DONE — pastOf reads from the Word, never a hardcoded map. An extension that adds a
// verb declares its past the same way (declarePast); regular verbs need nothing (the -ed rule fills them).
const DECLARED_PAST = new Map();

// the present → past of a verb: its declared past, or the -ed rule for regulars
export function pastOf(verb) {
  const v = String(verb || "").toLowerCase();
  if (DECLARED_PAST.has(v)) return DECLARED_PAST.get(v);   // the verb declared its own past
  if (/e$/.test(v)) return v + "d";                        // declare → declared, move → moved
  if (/[^aeiou]y$/.test(v)) return v.slice(0, -1) + "ied"; // deny → denied
  return v + "ed";                                         // grant → granted, connect → connected
}

// fold a declared past in — when verbs.word lands on the chain, or an extension declares a verb
export function declarePast(verb, past) {
  DECLARED_PAST.set(String(verb).toLowerCase(), String(past));
}
