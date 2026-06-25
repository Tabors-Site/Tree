// conceptWords.js — the ONE source of the concept-word load order (the genesis book's descent
// order). wordFold.js DECLARES them into the fold in this order; axioms.js CLASSIFIES them
// (axiom vs theorem) and checks the descent closes. One list, two readers, no mirror to drift.
//
// Leaf module on purpose: it imports nothing, so both the declarer and the checker can depend on
// it without a cycle. The grammar/relation words the root leaves as irreducible syntax
// (is/a/an/has/can/of, before/after/in/over) are NOT concepts.
//
// The membrane axioms `in`/`out` sit right after the store floor (base), before the chain that
// rides on them — the six clock-free kernel floors are: hash + sign (woven in base/iam),
// stamp + read (named in word.word as do/see), and in + out here.

export const CONCEPT_WORDS = [
  "word", "iam", "base", "in", "out", "chain", "history", "story", "fold",
  "see", "do", "name", "being", "space", "matter", "weave", "be", "call", "can", "recall", "able", "flow",
];
