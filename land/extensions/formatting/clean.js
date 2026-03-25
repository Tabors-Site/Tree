// formatting/clean.js
// Deterministic post-processing for LLM output.

// Emoji ranges: emoticons, dingbats, symbols, transport, flags, supplemental, etc.
// Keeps basic punctuation, arrows, math symbols, and currency signs.
const EMOJI_RE = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2702}-\u{27B0}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu;

/**
 * Strip emojis from text.
 */
export function stripEmojis(text) {
  return text.replace(EMOJI_RE, "");
}

/**
 * Collapse runs of 3+ newlines into 2.
 */
export function normalizeWhitespace(text) {
  return text.replace(/\n{3,}/g, "\n\n");
}

/**
 * Remove trailing filler phrases LLMs like to append.
 * "Let me know if you need anything else!" etc.
 */
const FILLER_RE = /\n{1,2}(?:Let me know if (?:you (?:need|have|want|would like)|there(?:'s| is) anything)|Feel free to (?:ask|reach out|let me know)|Hope (?:this|that) helps|Happy to help|Don't hesitate to)[^\n]*$/i;

export function trimFiller(text) {
  return text.replace(FILLER_RE, "");
}

/**
 * Full cleaning pipeline.
 */
export function clean(text) {
  if (!text || typeof text !== "string") return text;
  let result = text;
  result = stripEmojis(result);
  result = normalizeWhitespace(result);
  result = trimFiller(result);
  result = result.trim();
  return result;
}
