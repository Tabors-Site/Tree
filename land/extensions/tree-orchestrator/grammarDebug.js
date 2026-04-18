// TreeOS Tree Orchestrator . grammarDebug.js
//
// Grammar parse tree debug formatter. One function, one purpose: given a
// message and the parsed axes (noun, tense, pronouns, adjectives, voice,
// graph, etc.), log a human-readable parse tree through seed/log.
//
// Called from every orchestration path so developers see what the grammar
// pipeline decided. Pure formatter. Produces no side effects except log
// output.

import log from "../../seed/log.js";
import { describeGraph } from "./graph.js";

export function logParseTree(message, {
  noun, nounSource, nounConf,
  tense, tensePattern, tenseConf,
  resolvedMode, negated, compound,
  pronoun, quantifiers, adjectives, voice,
  preposition, prepTarget, temporal, conditional,
  forcedMode, graph,
  posMatches, posScore, posLocality, posAllScores,
}) {
  const debugLines = [];
  debugLines.push(`📖 Parse: "${(message || "").slice(0, 80)}"`);
  debugLines.push(`   noun: ${noun || "?"} (${nounSource || "?"}, conf=${(nounConf || 0).toFixed(2)})`);
  debugLines.push(`   tense: ${tense || "?"} (${tensePattern || "?"}, conf=${(tenseConf || 0).toFixed(2)})`);
  if (negated) debugLines.push(`   negation: YES`);
  if (compound) debugLines.push(`   compound: ${compound.join(" -> ")}`);
  if (pronoun) debugLines.push(`   pronoun: ${pronoun}`);
  if (quantifiers && quantifiers.length > 0) {
    debugLines.push(`   quantifiers: ${quantifiers.map(q =>
      q.type === "numeric" ? `${q.direction} ${q.count}` :
      q.type === "temporal" ? `${q.direction} ${q.unit}` :
      q.type === "superlative" ? `${q.qualifier} ${q.subject}` :
      q.type,
    ).join(", ")}`);
  }
  if (adjectives && adjectives.length > 0) {
    debugLines.push(`   adjectives: ${adjectives.map(a => `${a.qualifier} ${a.subject || ""}`).join(", ")}`);
  }
  if (voice === "passive") debugLines.push(`   voice: passive`);
  if (preposition) debugLines.push(`   preposition: "${preposition}" -> ${prepTarget}`);
  if (temporal) debugLines.push(`   temporal: ${temporal}`);
  if (conditional) debugLines.push(`   conditional: ${conditional.type} (${conditional.keyword}) "${conditional.condition}"`);
  if (forcedMode) debugLines.push(`   forced: ${forcedMode}`);
  if (graph) debugLines.push(`   graph: ${describeGraph(graph)}`);

  // Per-POS routing matches: which words hit which extension's vocabulary,
  // including the locality bonus applied to the winner.
  if (posMatches && (posMatches.verbs.length > 0 || posMatches.nouns.length > 0 || posMatches.adjectives.length > 0)) {
    const parts = [];
    if (posMatches.nouns.length > 0) parts.push(`n:${posMatches.nouns.join(",")}`);
    if (posMatches.verbs.length > 0) parts.push(`v:${posMatches.verbs.join(",")}`);
    if (posMatches.adjectives.length > 0) parts.push(`a:${posMatches.adjectives.join(",")}`);
    const locTag = posLocality ? " LOCALITY" : "";
    debugLines.push(`   matched: score=${posScore || 0}${locTag} [${parts.join(" ")}]`);
  }
  if (posAllScores && posAllScores.length > 1) {
    const rivals = posAllScores.slice(1).map(s => `${s.extName}=${s.score}${s.locality ? "(loc)" : ""}`).join(" ");
    debugLines.push(`   rivals: ${rivals}`);
  }

  const compositeConf = ((nounConf || 0.5) * 0.6) + ((tenseConf || 0.5) * 0.4);
  debugLines.push(`   confidence: ${compositeConf.toFixed(2)}${compositeConf < 0.65 ? " (LOW)" : ""}`);
  debugLines.push(`   dispatch: ${resolvedMode || "?"}`);
  for (const line of debugLines) log.info("Grammar", line);
}
