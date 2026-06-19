// The PAST of a verb is a QUALITY the verb word declares (Tabor): a verb has a present (its
// shape in an ACT) and a past (its shape in a FACT). A verb forms its past with -ed unless it
// declares its own — the same "Its X is Y" quality-setting as matter, pointed at tense. The
// book renders a fact in past tense by READING this, not by guessing: "declare → declared" by
// the rule, "see → saw" by its own past. This is the runtime projection of verbs.word; an
// extension that adds a verb declares its past the same way (declarePast), and regular verbs
// need nothing.

const DECLARED_PAST = new Map([
  ["make", "made"], ["give", "gave"], ["take", "took"], ["see", "saw"], ["do", "did"],
  ["set", "set"], ["be", "was"], ["speak", "spoke"], ["put", "put"], ["cut", "cut"],
  ["read", "read"], ["run", "ran"], ["send", "sent"], ["build", "built"], ["bring", "brought"],
  ["become", "became"], ["begin", "began"], ["hold", "held"], ["leave", "left"], ["let", "let"],
  ["say", "said"],  // call → "said '…'"; reply → replied and call → called fall out of the -ied/-ed rules
  // NOTE: irregular pasts are migrating OUT of this hardcoded map and INTO the foundation words
  // (seed/words/word.word + verbs.word), folded at boot by wordFold.js. `drop`→`dropped` lives in
  // verbs.word now, not here: it is the proof that pastOf reads from the Word, not this map.
  // The entries above remain as the bootstrap until the full migration (9.md Phase 3).
]);

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
