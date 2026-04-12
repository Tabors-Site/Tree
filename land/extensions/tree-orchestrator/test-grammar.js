#!/usr/bin/env node
/**
 * Grammar pipeline test. Exercises all pure parsers.
 * Run: node land/extensions/tree-orchestrator/test-grammar.js
 */

// ── Extract pure parsers (copied from orchestrator.js, no imports needed) ──

const TENSE_PAST = /\b(how am i|how did i|how have i|how is|how's|how are|how's my|hows my|show me|check my|check on|look at|looking|where am i|where are we|am i on track|on track|update me|catch me up|give me|tell me how|my progress|progress|status|review|daily|weekly|monthly|stats|streak|history|trend|trends|so far|pattern|patterns|doing|summary|recap|compare|average|averages|report|results|track record|overview|breakdown|analytics|performance)\b/i;
const TENSE_FUTURE = new RegExp([
  "what should i", "should i", "help me", "recommend", "recommendations?",
  "suggest", "suggestions?", "advice", "advise", "guide", "guidance",
  "what do i", "what can i", "tell me what", "tell me how to",
  "coach me", "what next", "whats next", "what'?s next", "next up", "ready for",
  "prepare", "warm up", "ideas?", "options?", "thoughts?", "opinion",
  "any tips", "any advice", "walk me through", "what would",
  "supposed to be", "should be", "actually is", "i meant", "correction",
  "wrong", "mistake", "fix that", "update that", "not right", "oops",
  "why", "explain", "tell me about", "what is", "what are", "how does",
  "how do i", "can you", "do you", "is it", "are there", "would it",
  "could i", "could we", "might i", "is this", "am i ready", "do i need",
  "when should", "where should", "how often", "how much should",
  "^hi$", "^hey$", "^hello$", "^yo$", "^sup$", "^whats up$", "^what's up$",
].map(p => `(?:${p})`).join("|"), "i");
const TENSE_IMPERATIVE = /\b(plan|build|create|make|setup|set up|set\s+.*\b(?:goal|target|weight|value)|structure|organize|define|add|modify|remove|delete|restructure|program|taper|schedule|adjust|change|update|curriculum|configure|redesign|rebuild|swap|replace|rename|initialize|start tracking|stop tracking|enable|disable|turn on|turn off|fix|correct|revise|repair|edit)\b/i;
const NEGATION = /\b(don'?t|do not|not|no|skip|stop|cancel|ignore|forget it|forget that|never mind|nevermind|undo|take.*back|that'?s wrong|wasn'?t|isn'?t|aren'?t|won'?t|hold on|wait|scratch that|scrap that|disregard)\b/i;

const CONDITIONAL_IF = /\b(if|in case|assuming|provided|given that|suppose|supposing)\b\s+(.+?)(?:\s*[,;]\s*|\s+then\s+)/i;
const CONDITIONAL_WHEN = /\b(when|whenever|once|after|as soon as|the moment|next time)\b\s+(.+?)(?:\s*[,;]\s*|\s+then\s+)/i;
const CONDITIONAL_UNLESS = /\b(unless|except if|except when|if not|only if not)\b\s+(.+?)(?:\s*[,;]\s*)/i;
const CONDITIONAL_SHORT = /^(if|when|unless|once|after)\s+(.+?)(?:\s*$)/i;
const CONDITIONAL_ELSE = /(?:,?\s*(?:otherwise|else|if not|or else)\s+)(.+)$/i;

const TEMPORAL_RELATIVE = /\b(yesterday|today|tonight|this morning|last night|recently|lately|just now)\b|\b(last|past|previous|this|next)\s+(week|month|day|year|session|workout|meal|quarter)\b|\b(\d+)\s+(days?|weeks?|months?|years?|hours?)\s+ago\b/i;
const TEMPORAL_ABSOLUTE = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s*(\d{1,2})?\b|\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\b(\d{4}-\d{2}-\d{2})\b|\bthe\s+(\d{1,2})(st|nd|rd|th)\b/i;
const TEMPORAL_DURATION = /\b(?:over|for|during|in|within)\s+(?:the\s+)?(?:past|last|next)?\s*(\d+)?\s*(days?|weeks?|months?|years?|hours?)\b/i;
const TEMPORAL_RANGE = /\b(?:from|between)\s+(.+?)\s+(?:to|and|through|until)\s+(.+?)(?:\s*$|\s*[,.])/i;
const TEMPORAL_SINCE = /\b(?:since|starting|beginning)\s+(.+?)(?:\s*$|\s*[,.])/i;

const QUANTIFIER_UNIVERSAL = /\b(all|every|each|entire|whole)\b/i;
const QUANTIFIER_NUMERIC = /\b(last|first|past|recent|next)\s+(\d+|three|four|five|six|seven|eight|nine|ten|few|couple)\b/i;
const QUANTIFIER_SUPERLATIVE = /\b(best|worst|highest|lowest|most|least|top|bottom)\s+(\w+)/i;
const QUANTIFIER_COMPARATIVE = /\b(compare|versus|vs\.?|between|difference)\b/i;
const QUANTIFIER_TEMPORAL = /\b(this|last|past|next)\s+(week|month|day|year|session|workout|meal)\b/i;

const QUALITY_ADJ = /\b(high|low|good|bad|poor|strong|weak|heavy|light|best|worst|top|most|least)\s+(\w+)|\b(\w+)\s+(poorly|badly|well|terribly|great|consistently|inconsistently)\b/gi;
const STATE_ADJ = /\b(ready for|due for|behind on|ahead on|struggling with|improving|declining|stalled|consistent|overtrained|undertrained|sore|tired|fatigued|energized)\s*(\w*)/gi;

const PASSIVE_VOICE = /\b(has been|have been|was|were|is being|are being|got|gotten|been)\s+(\w+(?:ed|en|t|n))\b|\b(\w+)\s+(has|have)\s+(increased|decreased|dropped|risen|improved|declined|stalled|plateaued|changed|grown|shrunk|affected|worsened)\b|\b(is|are|was|were)\s+(affecting|causing|hurting|helping|improving|ruining|impacting)\b/i;

const CAUSAL_CONNECTORS = /\b(is affecting|affects|affected|causing|caused|because of|due to|led to|leading to|hurting|helping|impacting|influenced by|thanks to|ruining|improving|messing with)\b/i;

// ── Parser functions ──

function parseConditional(message) {
  const lower = message.toLowerCase().trim();
  let match, condEnd = 0, type, keyword, condition;
  if ((match = CONDITIONAL_IF.exec(lower))) { type = "if"; keyword = match[1]; condition = match[2].trim(); condEnd = match.index + match[0].length; }
  else if ((match = CONDITIONAL_UNLESS.exec(lower))) { type = "unless"; keyword = match[1]; condition = match[2].trim(); condEnd = match.index + match[0].length; }
  else if ((match = CONDITIONAL_WHEN.exec(lower))) { type = "when"; keyword = match[1]; condition = match[2].trim(); condEnd = match.index + match[0].length; }
  else if ((match = CONDITIONAL_SHORT.exec(lower))) { const kw = match[1].toLowerCase(); type = kw === "unless" ? "unless" : (kw === "when" || kw === "once" || kw === "after") ? "when" : "if"; keyword = match[1]; condition = match[2].trim(); return { type, keyword, condition, action: null, elseAction: null }; }
  if (!type) return null;
  const remainder = lower.slice(condEnd).trim();
  const elseMatch = CONDITIONAL_ELSE.exec(remainder);
  let action = remainder, elseAction = null;
  if (elseMatch) { action = remainder.slice(0, elseMatch.index).trim(); elseAction = elseMatch[1].trim(); }
  return { type, keyword, condition, action: action || null, elseAction };
}

function parseTemporalScope(message) {
  const lower = message.toLowerCase().trim();
  let match;
  if ((match = TEMPORAL_RANGE.exec(lower))) return { type: "range", raw: match[0].trim(), from: match[1].trim(), to: match[2].trim() };
  if ((match = TEMPORAL_SINCE.exec(lower))) return { type: "since", raw: match[0].trim(), from: match[1].trim() };
  if ((match = TEMPORAL_DURATION.exec(lower))) return { type: "duration", raw: match[0].trim(), count: match[1] ? parseInt(match[1]) : 1, unit: match[2] };
  if ((match = TEMPORAL_RELATIVE.exec(lower))) {
    const raw = match[0].trim();
    if (match[4] && match[5]) return { type: "relative", raw, count: parseInt(match[4]), unit: match[5], direction: "ago" };
    if (match[2] && match[3]) return { type: "relative", raw, direction: match[2], unit: match[3] };
    return { type: "relative", raw };
  }
  if ((match = TEMPORAL_ABSOLUTE.exec(lower))) return { type: "absolute", raw: match[0].trim() };
  return null;
}

function parseQuantifier(message) {
  const lower = message.toLowerCase();
  const quantifiers = [];
  let match;
  if ((match = QUANTIFIER_NUMERIC.exec(lower))) { const numMap = { three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, few: 3, couple: 2 }; quantifiers.push({ type: "numeric", direction: match[1], count: numMap[match[2]] || parseInt(match[2]) || 3 }); }
  if (QUANTIFIER_UNIVERSAL.test(lower)) quantifiers.push({ type: "universal" });
  if ((match = QUANTIFIER_SUPERLATIVE.exec(lower))) quantifiers.push({ type: "superlative", qualifier: match[1], subject: match[2] });
  if (QUANTIFIER_COMPARATIVE.test(lower)) quantifiers.push({ type: "comparative" });
  if ((match = QUANTIFIER_TEMPORAL.exec(lower))) quantifiers.push({ type: "temporal", direction: match[1], unit: match[2] });
  return quantifiers.length > 0 ? quantifiers : null;
}

function parseAdjectives(message) {
  const adjectives = [];
  const lower = message.toLowerCase();
  let match;
  QUALITY_ADJ.lastIndex = 0;
  while ((match = QUALITY_ADJ.exec(lower)) !== null) {
    if (match[1] && match[2]) adjectives.push({ type: "quality", qualifier: match[1], subject: match[2] });
    else if (match[3] && match[4]) adjectives.push({ type: "quality", qualifier: match[4], subject: match[3] });
  }
  STATE_ADJ.lastIndex = 0;
  while ((match = STATE_ADJ.exec(lower)) !== null) {
    adjectives.push({ type: "state", qualifier: match[1], subject: match[2] || null });
  }
  return adjectives;
}

function detectVoice(message) {
  return PASSIVE_VOICE.test(message) ? "passive" : "active";
}

function detectTenseCategory(message) {
  const lower = message.toLowerCase().trim();
  if (NEGATION.test(lower)) return "negated";
  if (TENSE_PAST.test(lower)) return "past";
  if (TENSE_FUTURE.test(lower)) return "future";
  if (TENSE_IMPERATIVE.test(lower)) return "imperative";
  return "present";
}

function predictGraph(message) {
  const cond = parseConditional(message);
  const quant = parseQuantifier(message);
  const tense = detectTenseCategory(message);
  const analyticTenses = ["past", "future", "negated"];

  if (cond) return "FORK";
  // FANOUT only on non-temporal quantifiers (temporal alone = time window, not set)
  const hasSetQuant = quant && quant.some(q => q.type !== "temporal");
  if (hasSetQuant && analyticTenses.includes(tense)) return "FANOUT";
  // Check for conjunction compound
  const CONJUNCTION = /\b(and then|then|after that|afterwards|also|and also|followed by|next)\b/i;
  const hasPast = TENSE_PAST.test(message.toLowerCase());
  const hasFuture = TENSE_FUTURE.test(message.toLowerCase());
  const hasImperative = TENSE_IMPERATIVE.test(message.toLowerCase());
  const tenseCount = [hasPast, hasFuture, hasImperative].filter(Boolean).length;
  if (tenseCount > 1 && CONJUNCTION.test(message.toLowerCase())) return "SEQUENCE";

  return "DISPATCH";
}

// ── Test runner ──

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

function test(message, expected) {
  const tense = detectTenseCategory(message);
  const cond = parseConditional(message);
  const temporal = parseTemporalScope(message);
  const quant = parseQuantifier(message);
  const adj = parseAdjectives(message);
  const voice = detectVoice(message);
  const graph = predictGraph(message);
  const causal = CAUSAL_CONNECTORS.test(message.toLowerCase());

  const parts = [];
  parts.push(`tense=${tense}`);
  if (cond) parts.push(`cond=${cond.type}("${cond.condition}")`);
  if (temporal) parts.push(`time=${temporal.type}(${temporal.raw})`);
  if (quant) parts.push(`quant=[${quant.map(q => q.type).join(",")}]`);
  if (adj.length > 0) parts.push(`adj=[${adj.map(a => a.qualifier).join(",")}]`);
  if (voice === "passive") parts.push(`voice=passive`);
  if (causal) parts.push(`causal=yes`);
  parts.push(`graph=${graph}`);

  const ok = graph === expected.graph;
  const icon = ok ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`;
  console.log(`${icon} "${BOLD}${message}${RESET}"`);
  console.log(`     ${DIM}${parts.join(" | ")}${RESET}`);
  if (!ok) console.log(`     ${RED}expected graph=${expected.graph}, got ${graph}${RESET}`);
  console.log();
  return ok;
}

// ── Test sentences ──

console.log(`\n${BOLD}=== GRAMMAR PIPELINE TESTS ===${RESET}\n`);

let pass = 0, fail = 0;

console.log(`${YELLOW}--- DISPATCH (simple routing) ---${RESET}\n`);
[
  ["ate eggs and toast", { graph: "DISPATCH" }],
  ["bench press 135 5x5", { graph: "DISPATCH" }],
  ["I had a protein shake", { graph: "DISPATCH" }],
  ["ran 3 miles today", { graph: "DISPATCH" }],
].forEach(([m, e]) => test(m, e) ? pass++ : fail++);

console.log(`${YELLOW}--- DISPATCH (tense routing, no quantifier) ---${RESET}\n`);
[
  ["how did I do today", { graph: "DISPATCH" }],
  ["what should I eat next", { graph: "DISPATCH" }],
  ["help me plan my meals", { graph: "DISPATCH" }],
  ["don't log that", { graph: "DISPATCH" }],
  ["create a new exercise", { graph: "DISPATCH" }],
].forEach(([m, e]) => test(m, e) ? pass++ : fail++);

console.log(`${YELLOW}--- TENSE CATEGORY (natural phrasings) ---${RESET}\n`);
// Verify each phrasing resolves to the intended tense category
const tenseTests = [
  // Past tense (review/analyze)
  ["how is my protein looking", "past"],
  ["how's my fitness", "past"],
  ["show me my stats", "past"],
  ["check my progress", "past"],
  ["where am I on protein", "past"],
  ["am I on track", "past"],
  ["my weekly breakdown", "past"],
  // Future tense (coach/guide)
  ["what should I eat", "future"],
  ["any tips for bulking", "future"],
  ["walk me through macros", "future"],
  ["what would you suggest", "future"],
  ["how do I hit my protein", "future"],
  // Imperative (plan/build)
  ["make a new exercise", "imperative"],
  ["set a protein goal of 200g", "imperative"],
  ["define a fiber metric", "imperative"],
  ["start tracking water", "imperative"],
  // Negation (cancel/undo)
  ["scratch that", "negated"],
  ["hold on, wrong meal", "negated"],
  ["nevermind", "negated"],
  ["disregard that", "negated"],
];
for (const [msg, expected] of tenseTests) {
  const got = detectTenseCategory(msg);
  const ok = got === expected;
  const icon = ok ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`;
  console.log(`${icon} "${BOLD}${msg}${RESET}" -> tense=${got}${ok ? "" : ` ${RED}(expected ${expected})${RESET}`}`);
  if (ok) pass++; else fail++;
}
console.log();

console.log(`${YELLOW}--- FORK (conditionals) ---${RESET}\n`);
[
  ["if protein is low, suggest high-protein foods", { graph: "FORK" }],
  ["unless I'm fasting, log breakfast", { graph: "FORK" }],
  ["when I hit 150g protein, review my day", { graph: "FORK" }],
  ["if I haven't worked out today, remind me", { graph: "FORK" }],
  ["if calories are over 2000, show me a breakdown otherwise just say good job", { graph: "FORK" }],
].forEach(([m, e]) => test(m, e) ? pass++ : fail++);

console.log(`${YELLOW}--- FANOUT (quantifier + analytical tense) ---${RESET}\n`);
[
  ["review all my exercises", { graph: "FANOUT" }],
  ["how are all my workouts doing", { graph: "FANOUT" }],
  ["compare every meal this week", { graph: "FANOUT" }],
  // "what's my best exercise" is tense=present (no past/future keyword), superlative only -> DISPATCH
  ["what's my best exercise", { graph: "DISPATCH" }],
  // "show me" now matches past tense, + numeric quantifier -> FANOUT
  ["show me the last 5 workouts", { graph: "FANOUT" }],
  // "how did each" matches present (no "did" in past patterns), + quantifier -> DISPATCH
  ["how did each exercise do this week", { graph: "DISPATCH" }],
].forEach(([m, e]) => test(m, e) ? pass++ : fail++);

console.log(`${YELLOW}--- FANOUT should NOT trigger (quantifier + present/log tense) ---${RESET}\n`);
[
  ["log all my meals", { graph: "DISPATCH" }],
  ["add every exercise to the plan", { graph: "DISPATCH" }],
].forEach(([m, e]) => test(m, e) ? pass++ : fail++);

console.log(`${YELLOW}--- SEQUENCE (compound intent) ---${RESET}\n`);
// SEQUENCE detection requires parseTense with real mode data (async, needs DB).
// At pure regex level, compound detection is limited. These test the grammar parse,
// not the full pipeline. In the live system, parseTense detects multiple tenses
// and conjunction words to produce compound chains.
[
  ["log lunch and then review my day", { graph: "DISPATCH" }],
  ["review my week and then help me plan next week", { graph: "SEQUENCE" }],
].forEach(([m, e]) => test(m, e) ? pass++ : fail++);

console.log(`${YELLOW}--- TEMPORAL SCOPE (data window) ---${RESET}\n`);
[
  ["how did I do last week", { graph: "DISPATCH" }],
  ["review my meals yesterday", { graph: "DISPATCH" }],
  ["show my progress since January", { graph: "DISPATCH" }],
  // "compare" triggers comparative quantifier, which IS a set quantifier -> FANOUT
  ["compare Monday to Friday", { graph: "FANOUT" }],
  ["what did I eat 3 days ago", { graph: "DISPATCH" }],
  ["review all exercises over the past 2 weeks", { graph: "FANOUT" }],
].forEach(([m, e]) => test(m, e) ? pass++ : fail++);

console.log(`${YELLOW}--- VOICE + ADJECTIVES + CAUSALITY ---${RESET}\n`);
[
  ["my bench press has been declining", { graph: "DISPATCH" }],
  ["eating poorly is affecting my workouts", { graph: "DISPATCH" }],
  ["high protein meals this week", { graph: "DISPATCH" }],
  ["I've been struggling with consistency", { graph: "DISPATCH" }],
].forEach(([m, e]) => test(m, e) ? pass++ : fail++);

console.log(`${BOLD}=== RESULTS: ${GREEN}${pass} passed${RESET}${BOLD}, ${fail > 0 ? RED : ""}${fail} failed${RESET}${BOLD} ===${RESET}\n`);

// Show parse details for interesting cases
console.log(`${YELLOW}--- DETAILED PARSE (complex sentences) ---${RESET}\n`);
const complex = [
  "if protein is low, review all my meals this week",
  "unless I've been slacking, compare every workout since Monday",
  "review my top 3 exercises over the past month and then help me plan next week",
  "eating poorly is affecting my workouts lately",
];
for (const msg of complex) {
  console.log(`${BOLD}"${msg}"${RESET}`);
  console.log(`  tense:       ${detectTenseCategory(msg)}`);
  console.log(`  conditional: ${JSON.stringify(parseConditional(msg))}`);
  console.log(`  temporal:    ${JSON.stringify(parseTemporalScope(msg))}`);
  console.log(`  quantifier:  ${JSON.stringify(parseQuantifier(msg))}`);
  console.log(`  adjectives:  ${JSON.stringify(parseAdjectives(msg))}`);
  console.log(`  voice:       ${detectVoice(msg)}`);
  console.log(`  causal:      ${CAUSAL_CONNECTORS.test(msg.toLowerCase())}`);
  console.log(`  graph:       ${predictGraph(msg)}`);
  console.log();
}
