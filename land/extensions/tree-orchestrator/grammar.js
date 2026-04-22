// TreeOS Tree Orchestrator . grammar.js
//
// Grammar tables. Every regex constant the classifier uses lives here.
// Pure data. No functions. No imports. This file is the dictionary the
// grammar pipeline reads from; parsers.js consumes it.
//
// ─────────────────────────────────────────────────────────────────────────
// THE GRAMMAR
//
// The tree has a grammar. You speak naturally. The system parses.
//
//   Nouns        = Nodes (things with identity, position, relationships)
//   Verbs        = Extensions (ways of acting: food tracks, fitness logs)
//   Tense        = Modes (how the verb conjugates for this message)
//   Adjectives   = Metadata (values, goals, status that describe nouns)
//   Adverbs      = Instructions (modify how the verb behaves)
//   Prepositions = Tree structure + scoping (under, above, blocked at)
//   Pronouns     = Position (currentNodeId, rootId, "here", "this")
//   Articles     = Existence (THE bench press = route, A bench press = create)
//
// Five orthogonal axes decompose every message:
//
//   DOMAIN (what thing)         noun, pronoun, preposition
//   SCOPE (how much/when)       quantifiers, temporal scope
//   INTENT (what action)        tense, conditionals
//   INTERPRETATION (how)        adjectives, voice
//   EXECUTION (runtime shape)   dispatch, sequence, fork
//
// The pipeline:
//
// 1. Parse noun        . routing index identifies territory
// 1a Parse pronouns    . resolve "it", "that", "same" from state
// 1b Parse prepositions . "under recovery" shifts target node
// 1c Parse quantifiers . "all", "top 3", "this week" set scope
// 1d Parse conditionals . "if", "when", "unless" branching logic
// 1e Parse temporal    . "yesterday", "last week", "since January" data window
// 2. Parse tense       . review / coach / plan / log
// 2b Confidence check  . if grammar uncertain, escalate to LLM
// 3. Parse adjectives  . quality/focus ("high protein", "ready for")
// 3b Detect voice      . active (execute) vs passive (observe)
// 4. Build graph       . compile intent into dispatch / sequence / fork
// 5. Execute graph     . walk the graph, evaluate forks, run modes
//
// LLM is only used in two places:
//   1. Semantic evaluation (condition checking in forks)
//   2. Generation (the actual mode response)
//
// Everything else is deterministic compilation.
// ─────────────────────────────────────────────────────────────────────────

// ── Tense patterns. Conjugate the verb (extension) into the right mode. ──
//
// Past tense (review):         reflecting on what happened
// Future/subjunctive (coach):  guidance, questions, corrections, conversation
// Imperative (plan):           structural commands, building, modifying
// Negation (coach):            cancels the default action, routes to conversation
// Present tense (log):         recording facts, stating actions (default)

// Past tense (review): looking backwards at what happened.
// Questions about state, progress, history. "How is" / "show me" phrasings.
export const TENSE_PAST = /\b(how am i|how did i|how have i|how is|how's|how are|how's my|hows my|show me|check my|check on|look at|looking|where am i|where are we|am i on track|on track|update me|catch me up|give me|tell me how|my progress|progress|status|review|daily|weekly|monthly|stats|streak|history|trend|trends|so far|pattern|patterns|doing|summary|recap|compare|average|averages|report|results|track record|overview|breakdown|analytics|performance)\b/i;

// Future tense (coach): asking for guidance, suggestions, opinions.
// Conditional/subjunctive phrasings. Questions that seek advice, not facts.
export const TENSE_FUTURE = new RegExp([
  // Asking for guidance
  "what should i", "should i", "help me", "recommend", "recommendations?",
  "suggest", "suggestions?", "advice", "advise", "guide", "guidance",
  "what do i", "what can i", "tell me what", "tell me how to",
  "coach me", "what next", "whats next", "what'?s next", "next up", "ready for",
  "prepare", "warm up", "ideas?", "options?", "thoughts?", "opinion",
  "any tips", "any advice", "walk me through", "what would",
  // Corrections and clarifications
  "supposed to be", "should be", "actually is", "i meant", "correction",
  "wrong", "mistake", "fix that", "update that", "not right", "oops",
  // Conversational and exploratory
  "why", "explain", "tell me about", "what is", "what are", "how does",
  "how do i", "can you", "do you", "is it", "are there", "would it",
  "could i", "could we", "might i", "is this", "am i ready", "do i need",
  "when should", "where should", "how often", "how much should",
  // Interrogative introspection — asking the tree about its own state.
  // "what workouts do i have" was falling through to log mode because
  // none of the above caught the shape "what <noun> do/did/have i <verb>".
  "^(what|which|who|whose|when|where|why|how)\\s",      // sentence-start question word
  "\\b(what|which|when|where|how\\s+many)\\s+\\w+\\s+(do|does|did|have|has|had|can|could|should|would|will|are|is|was|were)\\s+(i|we|my|our)\\b",
  "\\b(do|does|did|have|has|had|can|could|should)\\s+(i|we)\\b",   // "do i", "have i", "did i"
  "\\bhave\\s+(i|we)\\s+(ever|already|been|done)\\b",              // "have i ever"
  // Greetings and small talk
  "^hi$", "^hey$", "^hello$", "^yo$", "^sup$", "^whats up$", "^what's up$",
].map(p => `(?:${p})`).join("|"), "i");

// Imperative tense (plan): commanding a structural change. Building, creating, modifying.
export const TENSE_IMPERATIVE = /\b(plan|build|create|make|setup|set up|set\s+.*\b(?:goal|target|weight|value)|structure|organize|define|add|modify|remove|delete|restructure|program|taper|schedule|adjust|change|update|curriculum|configure|redesign|rebuild|swap|replace|rename|initialize|start tracking|stop tracking|enable|disable|turn on|turn off|fix|correct|revise|repair|edit)\b/i;

// Sentence-start imperative: when a message begins with a classic
// build/action verb, it's always imperative regardless of other matches.
// Catches "Make a tinder app..." / "Build me a server..." / "Write a
// function that..." which could otherwise be mis-classified as present
// indicative when the grammar pipeline is being cautious.
export const SENTENCE_START_IMPERATIVE = /^\s*(please\s+)?(make|build|create|write|scaffold|generate|add|fix|edit|modify|refactor|delete|remove|rename|replace|update|install|setup|set\s+up|implement|design|ship|publish)\b/i;

// Negation: cancels the default action. "Don't do the thing."
// Includes undo intent, course corrections, explicit cancel words.
export const NEGATION = /\b(don'?t|do not|not|no|skip|stop|cancel|ignore|forget it|forget that|never mind|nevermind|undo|take.*back|that'?s wrong|wasn'?t|isn'?t|aren'?t|won'?t|hold on|wait|scratch that|scrap that|disregard)\b/i;

// Conjunction words signal sequencing in compound intent messages:
// "log lunch and then review my week" chains a log with a review.
export const CONJUNCTION = /\b(and then|then|after that|afterwards|also|and also|followed by|next)\b/i;

// Backward-compat aliases. Older imports reference these names.
export const REVIEW_PATTERN = TENSE_PAST;
export const COACH_PATTERN = TENSE_FUTURE;
export const PLAN_PATTERN = TENSE_IMPERATIVE;

// ── Causal connectors: cross-domain cause . effect grammar. ──
//
// "Eating poorly is affecting my workouts" = food(cause) . fitness(effect)
// "Not sleeping enough is hurting my diet" = recovery(cause) . food(effect)
//
// Causal messages don't chain sequentially. They gather context from the
// CAUSE domain and inject it into the EFFECT domain's response. The AI
// at the effect domain sees what's happening in the cause domain and can
// reason about the relationship.
export const CAUSAL_CONNECTORS = /\b(is affecting|affects|affected|causing|caused|because of|due to|led to|leading to|hurting|helping|impacting|influenced by|thanks to|ruining|improving|messing with)\b/i;

// ── Voice: active (execute) vs passive (observe). ──
//
// Active voice: user commands action. "Log this." "Add exercise." "Review my week."
// Passive voice: user observes state. "Bench increased." "Protein was low."
//
// Voice doesn't change routing. It changes response framing. Injected as a
// modifier so the AI knows whether to act or reflect.
export const PASSIVE_VOICE = /\b(increased|decreased|went up|went down|dropped|rose|fell|changed|improved|worsened|got better|got worse|was high|was low|is high|is low|seems|feels|been|is affecting|is hurting|is helping|is impacting|is ruining|is improving|has been|have been|getting worse|getting better)\b/i;

// ── Quantifiers: scope the noun from "one node" to "a set of nodes." ──
//
// They bridge the gap between routing (find one target) and querying
// (find many targets, filter, compare, aggregate).
//
// "All workouts this week" = universal + temporal
// "Last three meals" = numeric + recency
// "Top exercises by volume" = superlative + metric
// "Compare my runs" = comparative (implies set)
export const QUANTIFIER_UNIVERSAL = /\b(all|every|each|entire|whole)\b/i;
export const QUANTIFIER_NUMERIC = /\b(last|first|past|recent|next)\s+(\d+|three|four|five|six|seven|eight|nine|ten|few|couple)\b/i;
export const QUANTIFIER_SUPERLATIVE = /\b(best|worst|highest|lowest|most|least|top|bottom)\s+(\w+)/i;
export const QUANTIFIER_COMPARATIVE = /\b(compare|versus|vs\.?|between|difference)\b/i;
export const QUANTIFIER_TEMPORAL = /\b(this|last|past|next)\s+(week|month|day|year|session|workout|meal)\b/i;

// ── Conditionals: branching logic in natural language. ──
//
// "If protein is low, suggest high-protein foods" = condition . action.
// "When I finish this set, log it" = temporal trigger . action.
// "Unless I'm fasting, log breakfast" = negated condition . action.
//
// Three types:
//   if/when    . condition that gates the action (evaluate first, then act)
//   unless     . negated condition (act UNLESS this is true)
//   after/once . temporal trigger (act when condition becomes true)
export const CONDITIONAL_IF = /\b(if|in case|assuming|provided|given that|suppose|supposing)\b\s+(.+?)(?:\s*[,;]\s*|\s+then\s+)/i;
export const CONDITIONAL_WHEN = /\b(when|whenever|once|after|as soon as|the moment|next time)\b\s+(.+?)(?:\s*[,;]\s*|\s+then\s+)/i;
export const CONDITIONAL_UNLESS = /\b(unless|except if|except when|if not|only if not)\b\s+(.+?)(?:\s*[,;]\s*)/i;
// Fallback: "if X" at the start of the message without a comma (short form)
export const CONDITIONAL_SHORT = /^(if|when|unless|once|after)\s+(.+?)(?:\s*$)/i;
export const CONDITIONAL_ELSE = /(?:,?\s*(?:otherwise|else|if not|or else)\s+)(.+)$/i;

// ── Adjectives: modify the noun by describing quality, state, or focus. ──
//
// They don't change routing. They change what the mode pays attention to.
// "High protein" = focus on protein. "Ready for progression" = evaluate state.
// "Low calorie" = constrain suggestions. "Best workout" = superlative filter.
//
// Pre-noun: "high protein", "bad diet". Post-noun: "eating poorly", "sleeping badly".
export const QUALITY_ADJ = /\b(high|low|good|bad|poor|strong|weak|heavy|light|best|worst|top|most|least)\s+(\w+)|\b(\w+)\s+(poorly|badly|well|terribly|great|consistently|inconsistently)\b/gi;
export const STATE_ADJ = /\b(ready for|due for|behind on|ahead on|struggling with|improving|declining|stalled|consistent|overtrained|undertrained|sore|tired|fatigued|energized)\s*(\w*)/gi;
export const COMPARATIVE_ADJ = /\b(more|less|too much|too little|not enough|enough|plenty of|lacking)\s+(\w+)/gi;

// ── Prepositions: alter WHERE an action happens without changing WHAT. ──
//
// "Log this under recovery" = verb is log, noun shifts to recovery.
// "Compare this with last week" = verb is review, scope shifts to temporal.
// "Move this into finance" = verb is plan, target shifts to finance.
//
// Prepositions turn the tree into a navigable semantic space.
export const PREPOSITION_PATTERN = /\b(?:under|in|into|at|to|from|for|on|within)\s+([a-zA-Z][\w\s-]{1,40}?)(?:\s*$|\s*(?:and|then|,|\.))/i;

// ── Temporal scope: data window the mode operates on. ──
//
// Time is not tense. Tense = intent (review, log, coach, plan).
// Time = data scope (which window of data the mode operates on).
//
// "How did I do last week" has tense=past (review mode) AND time=last week.
// "Log my meal yesterday" has tense=present (log mode) AND time=yesterday.
//
// Four categories:
//   relative:  "yesterday", "last week", "3 days ago", "recently"
//   absolute:  "January", "March 5", "2026-01-15", days of the week
//   duration:  "over 3 months", "the past 2 weeks", "for a year"
//   range:     "from Monday to Friday", "between January and March"
export const TEMPORAL_RELATIVE = /\b(yesterday|today|tonight|this morning|last night|recently|lately|just now)\b|\b(last|past|previous|this|next)\s+(week|month|day|year|session|workout|meal|quarter)\b|\b(\d+)\s+(days?|weeks?|months?|years?|hours?)\s+ago\b/i;
export const TEMPORAL_ABSOLUTE = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s*(\d{1,2})?\b|\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\b(\d{4}-\d{2}-\d{2})\b|\bthe\s+(\d{1,2})(st|nd|rd|th)\b/i;
export const TEMPORAL_DURATION = /\b(?:over|for|during|in|within)\s+(?:the\s+)?(?:past|last|next)?\s*(\d+)?\s*(days?|weeks?|months?|years?|hours?)\b/i;
export const TEMPORAL_RANGE = /\b(?:from|between)\s+(.+?)\s+(?:to|and|through|until)\s+(.+?)(?:\s*$|\s*[,.])/i;
export const TEMPORAL_SINCE = /\b(?:since|starting|beginning)\s+(.+?)(?:\s*$|\s*[,.])/i;
