// grammarFold.js — the metacircular loop's first cut: the grammar reads itself from the Word.
//
// "The verse and the parser are the same thing" (Tabor): a grammar rule is a Word, not host
// machinery. This file lifts two rules — `owns` (two capture groups, proving the substitution path
// GENERALIZES) and `i-am` (the genesis verse, "in the beginning was the Word" made literal) — from
// parser.js's hardcoded RULES table into the FOLD, as coin facts on I's reel. Mirrors
// read-trail.js's declareViewsToFold exactly: a word pointing at host logic by a ref.
//
// THE FLOOR BOUNDARY (9.md §2 two-face — state it so the proof is never mistaken for more):
//   * LIFTS into the fold (becomes coin-fact DATA): the rule's EXISTENCE, its KIND (kind:"rule"),
//     and its emitted NODE-SHAPE ({kind:"act",…} for i-am; {kind:"owns",subject:"$1",of:"$2"} for
//     owns). Editing what a rule produces becomes a fold edit, not a JS edit.
//   * STAYS a host AXIOM (behind a ref): the regex-match PRIMITIVE — `(line) => line.match(re)`. A
//     function can't serialize as a fact (a fact is data), so it is named in the Word and run by the
//     kernel — the same bottom-turtle shape as a view-word's column-puller or a reducer's fold-fn.
//   * The matcher is the AXIOM behind the ref; the rule's structure is the LIFTED data. "Declared in
//     Word for self-description, implemented in the kernel for behavior" (9.md §2).
//
// NOT done here (named, deferred): lifting the parse LOGIC (regex/builders stays host); expressing
// the grammar as `.word` prose (circular for the parser, strictly later). The regexes below are
// duplicated from parser.js BY DESIGN during the hybrid; a later step removes the parser.js copies.

// The lifted set — two rules, explicit and tiny. Keep in lockstep with parser.js's GRAMMAR_RULE_WORDS.
//   owns-rule: /^(I|[A-Z][\w.-]*) owns? (?:the |a |an )?([\w.-]+)\.$/  → {kind:"owns", subject:"$1", of:"$2"}
//   i-am-rule: /^I am "what?" I am\.$/i                                → {kind:"act", verb:"name", act:"i-am", by:"I"}
//
// declareGrammarRulesToFold — coin the two rule-words onto the fold at genesis (called from
// wordFold.seedFold, after the views block). `history="0"` is the heaven seed-vocabulary pin
// (deliberate, like the sibling declarers); seedFold passes the boot history explicitly. The two
// regex matchers register as host handlers (refs the rule-words point at); skipIfUnchanged keeps a
// reboot from re-coining.
export async function declareGrammarRulesToFold({ moment = null, history = "0" } = {}) {
  const { registerHostHandler, bindWord } = await import("./wordStore.js");

  // The host AXIOMS: the regex-match primitive behind a ref (the bottom turtle for parsing — JS that
  // can't serialize as a fact). Duplicated from parser.js's RULES during the hybrid (parser.js:88, :165).
  registerHostHandler("rule:owns", (line) =>
    line.match(/^(I|[A-Z][\w.-]*) owns? (?:the |a |an )?([\w.-]+)\.$/),
  );
  registerHostHandler("rule:i-am", (line) => line.match(/^I am "what\?" I am\.$/i));

  // The LIFTED data: each rule's existence + kind + emitted node-shape, as a coin fact. `parse.ref`
  // names the host matcher; `node` is the shape the parser clones, substituting "$N" with capture m[N].
  await bindWord(
    "owns-rule",
    { kind: "rule", parse: { ref: "rule:owns" }, node: { kind: "owns", subject: "$1", of: "$2" } },
    { moment, history, skipIfUnchanged: true },
  );
  await bindWord(
    "i-am-rule",
    { kind: "rule", parse: { ref: "rule:i-am" }, node: { kind: "act", verb: "name", act: "i-am", by: "I" } },
    { moment, history, skipIfUnchanged: true },
  );

  return 2;
}
