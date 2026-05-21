/**
 * Misroute Core
 *
 * Pure detection and analysis logic. No side effects, no imports of services.
 * Used by index.js which wires these into hooks and user metadata.
 */

// ── Correction detection ──
//
// Phrases that strongly indicate the previous routing was wrong. We require
// reasonably specific patterns to avoid false positives. A stray "no" in a
// normal sentence should not flag a misroute.

// Explicit rejection of prior output ("no that was wrong", "that's not right")
const REJECTION_PATTERNS = [
  /\b(no|wait|hold on|actually)[,\s]+(that'?s|that\s+was|it'?s|it\s+was)\s+(not|the\s+wrong|wrong)\b/i,
  /\b(that\s+(?:was|is)\s+wrong|wrong\s+mode|wrong\s+extension|that\s+isn'?t\s+right)\b/i,
  /\b(why\s+did\s+(?:it|you|that)\s+go\s+to)\b/i,
];

// Explicit correction naming the intended domain ("i meant fitness", "should have been food")
// Captures the domain name in group 1 when possible. The whole-match scan
// fallback in detectCorrection picks up targets from elsewhere in the message
// if the first capture doesn't land on a known extension.
const CORRECTION_PATTERNS = [
  /\bi\s+meant\s+([a-z][a-z0-9_-]+)\b/i,
  /\bthat\s+(?:should|was\s+meant)\s+(?:to\s+)?(?:be(?:\s+in|\s+for)?\s+|for\s+|go\s+to\s+)([a-z][a-z0-9_-]+)\b/i,
  /\bshould\s+(?:have\s+)?(?:been|gone\s+to)\s+([a-z][a-z0-9_-]+)\b/i,
  /\bnot\s+([a-z][a-z0-9_-]+)\s*,?\s+(?:but\s+)?([a-z][a-z0-9_-]+)/i,
  /\b(?:that|it)\s+should\s+be\s+(?:in\s+)?([a-z][a-z0-9_-]+)\b/i,
  // "no, the X mode" / "no, X instead" / "no, X one" short forms where the
  // user contradicts the previous routing and names the correct target.
  /^no[,\s]+(?:the\s+)?([a-z][a-z0-9_-]+)(?:\s+(?:mode|one|instead))?/i,
];

// Explicit tag the user can type as a standalone message.
// Bare form: `!misroute`, `!mistake`, `!wrong` -> log only, no learning.
// Targeted form: `!misroute food` -> log AND name food as the correct extension
//                so the suggestion analyzer fires and the word can auto-promote.
const TAG_PATTERNS = [
  /^!misroute\b/i,
  /^!mistake\b/i,
  /^!wrong\b/i,
];
const TAG_WITH_TARGET = /^!(?:misroute|mistake|wrong)\s+([a-z][a-z0-9_-]+)\b/i;

/**
 * Detect whether a message is a correction of a prior routing decision.
 * Returns { isCorrection, confidence, correctExtension, kind, reason } or null.
 *
 * kind:
 *   "tag"        - explicit !misroute tag, highest confidence
 *   "explicit"   - named the correct extension ("i meant fitness")
 *   "rejection"  - rejected prior output without naming replacement
 */
export function detectCorrection(message, knownExtensions) {
  const trimmed = (message || "").trim();
  if (!trimmed) return null;

  // Targeted tag with extension name: `!misroute food` or `!wrong fitness`.
  // Same confidence as a bare tag, but also names the correct target so the
  // suggestion analyzer fires and the word can promote to vocabulary.
  const targeted = TAG_WITH_TARGET.exec(trimmed);
  if (targeted) {
    const candidate = targeted[1]?.toLowerCase();
    const correct = candidate && knownExtensions?.has(candidate) ? candidate : null;
    return {
      isCorrection: true,
      confidence: 1.0,
      correctExtension: correct,
      kind: "tag",
      reason: correct ? `user tagged !misroute -> ${correct}` : `user tagged !misroute (target "${candidate}" not a known extension)`,
    };
  }

  // Bare tag: highest confidence, but no target.
  for (const p of TAG_PATTERNS) {
    if (p.test(trimmed)) {
      return { isCorrection: true, confidence: 1.0, correctExtension: null, kind: "tag", reason: "user tagged !misroute" };
    }
  }

  // Explicit correction with domain name
  for (const p of CORRECTION_PATTERNS) {
    const m = p.exec(trimmed);
    if (m) {
      // First pass: find which capture group holds a known extension name.
      // This catches simple forms where the regex capture is positioned right.
      let correct = null;
      for (let i = 1; i < m.length; i++) {
        const candidate = m[i]?.toLowerCase();
        if (candidate && knownExtensions && knownExtensions.has(candidate)) {
          correct = candidate;
          break;
        }
      }
      // Fallback: when the captured word isn't an extension (e.g. "i meant
      // the green one" captures "the"), scan the whole message for any
      // known extension name. This catches phrasings like:
      //   "i meant the food one"             -> captures "the", scan finds "food"
      //   "that should have been wrong food" -> captures "wrong", scan finds "food"
      //   "no, the fitness mode"             -> captures "the", scan finds "fitness"
      // We walk the tokens AFTER the first correction keyword to avoid
      // false positives from extension names appearing before the correction
      // (e.g., "food was wrong, should be fitness" - we want fitness).
      if (!correct && knownExtensions) {
        const matchEnd = m.index + m[0].length;
        const afterCorrection = trimmed.slice(Math.max(0, m.index));
        const tokens = afterCorrection.toLowerCase().split(/[^a-z0-9_-]+/).filter(Boolean);
        for (const tok of tokens) {
          if (knownExtensions.has(tok)) {
            correct = tok;
            break;
          }
        }
        // If still nothing found after the correction phrase, scan the whole
        // message as a last resort. Corrections like "food, i meant food"
        // (user naming target before the correction phrase).
        if (!correct) {
          const allTokens = trimmed.toLowerCase().split(/[^a-z0-9_-]+/).filter(Boolean);
          for (const tok of allTokens) {
            if (knownExtensions.has(tok)) {
              correct = tok;
              break;
            }
          }
        }
      }
      return {
        isCorrection: true,
        confidence: correct ? 0.95 : 0.7,
        correctExtension: correct,
        kind: "explicit",
        reason: `explicit correction: "${m[0]}"`,
      };
    }
  }

  // Rejection without a named replacement
  for (const p of REJECTION_PATTERNS) {
    const m = p.exec(trimmed);
    if (m) {
      return {
        isCorrection: true,
        confidence: 0.8,
        correctExtension: null,
        kind: "rejection",
        reason: `rejection: "${m[0]}"`,
      };
    }
  }

  return null;
}

// ── Vocabulary suggestion analysis ──
//
// Given a misroute event, figure out which words caused the wrong routing
// and propose adding them to the correct extension's vocabulary.
//
// Input:
//   {
//     message: "add bill as an exercise",
//     actualRoute: { extension: "finance", posMatches: { verbs: ["bill"], nouns: [], adjectives: [] } },
//     correctExtension: "fitness",
//     correctVocab: { verbs: [...], nouns: [...], adjectives: [...] }  // regex patterns
//   }
//
// Output:
//   [
//     { word: "bill", fromBucket: "verbs", wrongExt: "finance", toExt: "fitness", suggestedBucket: "nouns" },
//     ...
//   ]

export function analyzeMisroute({ message, actualRoute, correctExtension, correctVocab }) {
  const suggestions = [];
  if (!actualRoute?.posMatches || !correctExtension) return suggestions;

  const tripWords = new Set();
  for (const w of actualRoute.posMatches.nouns || []) tripWords.add(w.toLowerCase().trim());
  for (const w of actualRoute.posMatches.verbs || []) tripWords.add(w.toLowerCase().trim());
  for (const w of actualRoute.posMatches.adjectives || []) tripWords.add(w.toLowerCase().trim());

  if (tripWords.size === 0) return suggestions;

  // For each trip word, check if it's already in the correct extension's vocab
  const correctMatches = (word) => {
    if (!correctVocab) return { matched: false, bucket: null };
    for (const bucket of ["nouns", "verbs", "adjectives"]) {
      const patterns = correctVocab[bucket] || [];
      for (const re of patterns) {
        try { if (re.test(word)) return { matched: true, bucket }; } catch {}
      }
    }
    return { matched: false, bucket: null };
  };

  // Heuristic: words that look like proper nouns or concrete things go in nouns,
  // action verbs go in verbs, states go in adjectives. Since we can't POS-tag
  // perfectly, we suggest nouns for unknown words (the strongest signal).
  for (const word of tripWords) {
    const { matched } = correctMatches(word);
    if (matched) continue;
    suggestions.push({
      word,
      wrongExtension: actualRoute.extension,
      correctExtension,
      suggestedBucket: "nouns", // default to nouns (highest weight, most specific)
      reason: `"${word}" triggered ${actualRoute.extension} but message was meant for ${correctExtension}`,
    });
  }

  return suggestions;
}

// ── Extract the latest user message from a messages array ──
//
// Used by beforeLLMCall hook. The messages array contains system + conversation
// history. The latest user turn is what we care about.

export function extractLatestUserMessage(messages) {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user" && typeof messages[i].content === "string") {
      return messages[i].content;
    }
  }
  return null;
}

// ── Constants ──

export const MAX_LOG_ENTRIES = 100;
export const MAX_SUGGESTIONS = 50;

// Auto-promote a suggestion to the extension's learned vocabulary file when
// the same word has triggered the same wrong->correct misroute this many times.
// Default 5. Affects everyone in the land. Tunable per-user or per-extension later.
export const AUTO_PROMOTE_THRESHOLD = 5;

// Auto-promote to PERSONAL vocabulary at this lower threshold. Personal entries
// only affect the single user who triggered the corrections, so we can be
// aggressive: two corrections of the same word from the same user is enough
// signal that THIS user means something specific by it.
export const PERSONAL_PROMOTE_THRESHOLD = 2;

// ── Pattern generation ──
//
// Build a regex pattern source string from a literal word. The grammar's POS
// bucket (`nouns`, `verbs`, `adjectives`) tells us which inflections matter,
// so we can generate one pattern that catches common word forms instead of
// learning every form independently.
//
// Examples:
//   wordToPatternSource("crunch", "nouns")    -> "\\b(?:crunch|crunches)\\b"
//   wordToPatternSource("egg",    "nouns")    -> "\\b(?:egg|eggs)\\b"
//   wordToPatternSource("berry",  "nouns")    -> "\\b(?:berry|berries)\\b"
//   wordToPatternSource("walk",   "verbs")    -> "\\b(?:walk|walks|walked|walking)\\b"
//   wordToPatternSource("bench press", "nouns") -> "\\b(?:bench press|bench presses)\\b"
//
// Multi-word phrases: only the last word is inflected. The leading words
// stay literal. "bench press" -> pluralizes "press" to "presses".
//
// Limitations:
//   - Irregular verbs ("eat" -> "ate") generate wrong forms ("eated") that
//     never match. The alternation just adds a dead branch, no harm done.
//   - Stem-changing nouns ("foot" -> "feet") aren't handled.
//   - Adjective comparative/superlative aren't handled (rare in routing).
//   - Doubled-consonant verbs ("run" -> "running") are not detected; we
//     generate "runing" which won't match. Acceptable for v1.

const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;

function escapeRegexLiteral(s) {
  return s.replace(REGEX_SPECIALS, "\\$&");
}

// Generate plural form for a noun (or 3rd person singular for a verb).
// "crunch" -> "crunches", "egg" -> "eggs", "berry" -> "berries"
function pluralize(word) {
  if (/(?:[sxz]|ch|sh)$/.test(word)) return word + "es";
  if (/[bcdfghjklmnpqrstvwxz]y$/.test(word)) return word.slice(0, -1) + "ies";
  return word + "s";
}

// Generate -ing form for a verb. "walk" -> "walking", "bake" -> "baking".
// Doesn't double consonants ("run" -> "runing", wrong but harmless).
function gerundize(word) {
  if (word.endsWith("e") && word.length > 2) return word.slice(0, -1) + "ing";
  return word + "ing";
}

// Generate -ed form for a verb. "walk" -> "walked", "bake" -> "baked",
// "carry" -> "carried".
function pasten(word) {
  if (word.endsWith("e")) return word + "d";
  if (/[bcdfghjklmnpqrstvwxz]y$/.test(word)) return word.slice(0, -1) + "ied";
  return word + "ed";
}

// Generate the set of word forms to match for a given bucket.
function generateForms(word, bucket) {
  const forms = new Set([word]);
  // All buckets get the plural / 3rd-person form because words flip POS
  // commonly (bench is both noun and verb).
  forms.add(pluralize(word));
  if (bucket === "verbs") {
    forms.add(gerundize(word));
    forms.add(pasten(word));
  }
  return [...forms];
}

export function wordToPatternSource(word, bucket = "nouns") {
  if (!word || typeof word !== "string") return null;
  const cleaned = word.toLowerCase().trim();
  if (!cleaned) return null;

  // Multi-word phrase: split, inflect only the LAST word, escape literally.
  // "bench press" -> "bench (?:press|presses)"
  // "hot dog" -> "hot (?:dog|dogs)"
  const parts = cleaned.split(/\s+/);
  const lastWord = parts[parts.length - 1];
  const leading = parts.slice(0, -1);

  if (!/^[a-z][a-z0-9-]*$/i.test(lastWord)) {
    // Last word has non-alpha chars, fall back to literal pattern (no inflection)
    return `\\b(${escapeRegexLiteral(cleaned)})\\b`;
  }

  const forms = generateForms(lastWord, bucket).map(escapeRegexLiteral);
  const inflected = forms.length === 1 ? forms[0] : `(?:${forms.join("|")})`;
  const leadingLiteral = leading.map(escapeRegexLiteral).join("\\s+");
  const body = leadingLiteral ? `${leadingLiteral}\\s+${inflected}` : inflected;
  return `\\b${body}\\b`;
}
