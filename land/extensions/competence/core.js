/**
 * Competence Core
 *
 * Tracks which queries found answers and which found silence.
 * Builds a competence boundary map from accumulated query history.
 * No LLM calls. Purely observational.
 */

import log from "../../seed/log.js";
import Node from "../../seed/models/node.js";

let _metadata = null;
export function configure({ metadata }) { _metadata = metadata; }

const MAX_QUERIES = 100;

// ─────────────────────────────────────────────────────────────────────────
// RECORDING
// ─────────────────────────────────────────────────────────────────────────

/**
 * Heuristic: did the AI's response actually answer the user's query?
 * Checks for tool usage, note references, and hedging language.
 */
function detectAnswer(response) {
  if (!response) return { hadAnswer: false, confidence: 0 };
  const text = (response || "").toLowerCase();

  // Signals of answering: tool calls happened, notes referenced, specific content cited
  const answerSignals = [
    /\baccording to\b/,
    /\bnotes? (show|indicate|say|mention)/,
    /\bhere('s| is) what/,
    /\bfound\b.*\b(note|entry|record)/,
    /\byou (wrote|created|recorded|noted)/,
    /\bon \d{4}-\d{2}-\d{2}/,  // date references suggest citing real content
  ];

  // Signals of not answering: hedging, suggesting to look elsewhere
  const silenceSignals = [
    /\bi don't (have|see|find) (information|data|notes?|anything)/,
    /\bno (information|data|notes?|records?) (about|on|for|regarding)/,
    /\bi('m| am) not (sure|able|finding)/,
    /\byou (might|could|should) (try|check|look)/,
    /\bthere('s| is) no (data|information|content)/,
    /\bi (can't|cannot) find/,
  ];

  let answerScore = 0;
  let silenceScore = 0;

  for (const p of answerSignals) {
    if (p.test(text)) answerScore++;
  }
  for (const p of silenceSignals) {
    if (p.test(text)) silenceScore++;
  }

  if (answerScore > silenceScore) {
    return { hadAnswer: true, confidence: Math.min(0.5 + answerScore * 0.15, 1.0) };
  }
  if (silenceScore > 0) {
    return { hadAnswer: false, confidence: Math.min(0.5 + silenceScore * 0.15, 1.0) };
  }

  // Ambiguous: assume answered if response is substantial
  return { hadAnswer: text.length > 200, confidence: 0.4 };
}

/**
 * Record a query result on a node.
 */
export async function recordQuery(nodeId, query, hadAnswer, confidence, userId) {
  try {
    const node = await Node.findById(nodeId);
    if (!node) return;

    const meta = _metadata.getExtMeta(node, "competence") || {};
    if (!meta.queries) meta.queries = [];

    meta.queries.push({
      query: (query || "").slice(0, 200),
      hadAnswer,
      confidence,
      timestamp: Date.now(),
      userId,
    });

    // Cap rolling array
    if (meta.queries.length > MAX_QUERIES) {
      meta.queries = meta.queries.slice(-MAX_QUERIES);
    }

    // Recompute topics
    const computed = computeCompetence(meta.queries);
    meta.strongTopics = computed.strongTopics;
    meta.weakTopics = computed.weakTopics;
    meta.answerRate = computed.answerRate;
    meta.lastUpdated = Date.now();

    await _metadata.setExtMeta(node, "competence", meta);
    await node.save();
  } catch (err) {
    log.debug("Competence", `recordQuery failed: ${err.message}`);
  }
}

/**
 * Process an afterLLMCall event to detect competence.
 */
export function processLLMCall({ nodeId, userId, message, answer }) {
  if (!nodeId || !message) return;

  // Only process user queries (not system prompts, not tool responses)
  if (!userId || userId === "SYSTEM") return;

  const { hadAnswer, confidence } = detectAnswer(answer);
  recordQuery(nodeId, message, hadAnswer, confidence, userId);
}

// ─────────────────────────────────────────────────────────────────────────
// COMPUTATION
// ─────────────────────────────────────────────────────────────────────────

/**
 * Extract strong and weak topics from query history via word frequency.
 */
function computeCompetence(queries) {
  if (!queries || queries.length === 0) {
    return { strongTopics: [], weakTopics: [], answerRate: 0 };
  }

  const answered = queries.filter(q => q.hadAnswer);
  const unanswered = queries.filter(q => !q.hadAnswer);
  const answerRate = queries.length > 0 ? answered.length / queries.length : 0;

  // Word frequency in answered vs unanswered queries
  const stopWords = new Set(["the", "a", "an", "is", "are", "was", "were", "what", "how", "when", "where", "why", "who", "can", "do", "does", "did", "will", "would", "should", "could", "have", "has", "had", "been", "being", "this", "that", "these", "those", "for", "with", "about", "from", "into", "but", "and", "not", "any", "all", "some", "more", "most", "you", "your", "my", "me", "its"]);

  function extractWords(queryList) {
    const freq = new Map();
    for (const q of queryList) {
      const words = (q.query || "").toLowerCase().split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
      for (const w of words) {
        freq.set(w, (freq.get(w) || 0) + 1);
      }
    }
    return freq;
  }

  const answeredFreq = extractWords(answered);
  const unansweredFreq = extractWords(unanswered);

  // Strong topics: words that appear frequently in answered queries but rarely in unanswered
  const strongTopics = [...answeredFreq.entries()]
    .filter(([word, count]) => count >= 2 && (!unansweredFreq.has(word) || unansweredFreq.get(word) < count))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word);

  // Weak topics: words that appear frequently in unanswered queries but rarely in answered
  const weakTopics = [...unansweredFreq.entries()]
    .filter(([word, count]) => count >= 2 && (!answeredFreq.has(word) || answeredFreq.get(word) < count))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word);

  return { strongTopics, weakTopics, answerRate };
}

// ─────────────────────────────────────────────────────────────────────────
// READ
// ─────────────────────────────────────────────────────────────────────────

/**
 * Get the competence map for a node.
 */
export async function getCompetence(nodeId) {
  const node = await Node.findById(nodeId).select("metadata").lean();
  if (!node) return null;

  const meta = node.metadata instanceof Map
    ? node.metadata.get("competence") || {}
    : node.metadata?.competence || {};

  return {
    totalQueries: (meta.queries || []).length,
    answered: (meta.queries || []).filter(q => q.hadAnswer).length,
    unanswered: (meta.queries || []).filter(q => !q.hadAnswer).length,
    answerRate: meta.answerRate || 0,
    strongTopics: meta.strongTopics || [],
    weakTopics: meta.weakTopics || [],
    lastUpdated: meta.lastUpdated || null,
  };
}
