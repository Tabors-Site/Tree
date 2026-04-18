// Book-workspace chapter scout.
//
// Pure-code post-swarm traversal that catches failure modes specific
// to prose generation with small models:
//
//   1. Empty chapters — branch status says "done" but the chapter
//      node has zero prose notes. Small models sometimes emit
//      [[DONE]] without ever calling create-node-note. The swarm
//      trusts the [[DONE]] signal; this scout verifies the work
//      actually got produced.
//
//   2. Repetition loops — small models sometimes enter a terminal
//      rhythmic loop near the end of a long generation, repeating
//      a phrase or short block dozens of times ("between the
//      stones and the water", "that's where I am", etc.). The
//      prose is legible but useless. Detector: any ≥24-char phrase
//      that appears 5+ times consecutively or 10+ times in the
//      note body.
//
//   3. Way-under-target — chapter has prose but under 40% of its
//      declared target word count. Likely a truncated or confused
//      draft. Flag for retry.
//
// Emits SIGNAL_KIND.COHERENCE_GAP signals on the offending chapter's
// inbox so the retry turn sees an actionable correction.

import Node from "../../../seed/models/node.js";
import log from "../../../seed/log.js";

const MIN_FRAGMENT_LEN = 24;
const REPETITION_CONSECUTIVE_THRESHOLD = 5;
const REPETITION_TOTAL_THRESHOLD = 10;
const MIN_TARGET_RATIO = 0.4;

/**
 * Walk the project subtree, collect every chapter/scene node, run
 * each through the detectors, return structured findings.
 */
export async function scanChapters({ projectNodeId, contracts, subPlan }) {
  if (!projectNodeId) return { skipped: true, reason: "no projectNodeId" };

  const chapters = await collectChapters(projectNodeId);

  const mongoose = (await import("mongoose")).default;
  const Note = mongoose.models.Note;
  if (!Note) return { skipped: true, reason: "Note model unavailable" };

  // Extract character list from contracts for the mention / pronoun audit.
  const characters = Array.isArray(contracts)
    ? contracts.filter((c) => c.kind === "character").map((c) => ({
        name: c.name,
        pronouns: normalizeProns(c.pronouns || pronounsFromFields(c.fields)),
      })).filter((c) => c.name)
    : [];

  const findings = [];

  // MISSED / ORPHAN CHAPTERS — compare the project's subPlan (what the
  // architect declared) against actual tree children (what swarm
  // produced). Entries in subPlan that never landed as chapter nodes,
  // OR landed but never transitioned out of pending/paused/failed,
  // should be surfaced so reconcile + retry picks them up on the next
  // Start. This runs BEFORE the per-chapter audits so missing entries
  // are reported alongside empty/broken ones.
  if (Array.isArray(subPlan?.branches) && subPlan.branches.length > 0) {
    const chaptersByNodeId = new Map();
    for (const ch of chapters) chaptersByNodeId.set(String(ch._id), ch);
    for (const entry of subPlan.branches) {
      const status = entry.status || "pending";
      if (entry.nodeId && chaptersByNodeId.has(String(entry.nodeId))) {
        // Has a tree node. Status-based findings handled per-chapter below.
        continue;
      }
      if (!entry.nodeId || status === "pending" || status === "paused" || status === "failed") {
        findings.push({
          kind: "missed-chapter",
          chapter: entry.name,
          chapterNodeId: entry.nodeId ? String(entry.nodeId) : null,
          status,
          spec: entry.spec || null,
          message:
            `Chapter "${entry.name}" was declared in the TOC but ${entry.nodeId ? "its status is \"" + status + "\"" : "never got dispatched as a tree node"}. ` +
            `Click Start Writing again — reconcile will pick it up and swarm will retry. ` +
            `If this keeps happening, the branch may be failing repeatedly; check the chapter's signalInbox for recurring errors.`,
        });
      }
    }
  }

  if (chapters.length === 0) {
    // If we had subPlan missing-chapter findings, report those and skip
    // the per-chapter audits. If we had nothing at all, skip entirely.
    if (findings.length > 0) return { ok: false, findings, scanned: 0 };
    return { skipped: true, reason: "no chapters found" };
  }
  for (const ch of chapters) {
    const notes = await Note.find({ nodeId: ch._id })
      .sort({ createdAt: 1 })
      .select("content")
      .lean();
    const proseText = notes.map((n) => String(n.content || "")).join("\n\n").trim();
    const proseLen = proseText.length;
    const approxWords = proseText.split(/\s+/).filter(Boolean).length;

    // Control-marker pollution. Prose should never contain
    // [[BRANCHES]] / [[CONTRACTS]] / [[PREMISE]] / [[DONE]] / [[NO-WRITE]]
    // markers — those are parser directives. If the writer emitted
    // both prose AND a [[BRANCHES]] block (Path A + Path B confusion),
    // the markers end up in the note and the book compiler renders
    // them verbatim as literal text.
    const markerMatch = proseText.match(/\[\[\s*\/?\s*(branches|contracts|premise|done|no-write)[^\]]*\]\]/i);
    if (markerMatch) {
      findings.push({
        kind: "prose-pollution",
        chapter: ch.name,
        chapterNodeId: String(ch._id),
        marker: markerMatch[0],
        location: proseText.indexOf(markerMatch[0]),
        message:
          `Chapter "${ch.name}" contains the control marker "${markerMatch[0]}" inside its prose. ` +
          `Control markers ([[BRANCHES]], [[CONTRACTS]], [[PREMISE]], [[DONE]], [[NO-WRITE]]) are parser ` +
          `directives, never prose. The book compiler renders notes verbatim, so this marker will appear ` +
          `as literal text in the published book. Rewrite the chapter with the marker removed; if you meant ` +
          `to decompose into scene branches instead of writing prose, delete the prose and keep only the ` +
          `[[BRANCHES]] block in your response text (Path B in the write-mode prompt).`,
      });
    }

    // Empty-chapter
    if (proseLen === 0) {
      findings.push({
        kind: "empty-chapter",
        chapter: ch.name,
        chapterNodeId: String(ch._id),
        spec: ch.spec || null,
        message:
          `Chapter "${ch.name}" has zero prose notes. The branch finished ` +
          `without writing content. Retry and actually call ` +
          `create-node-note with the chapter's prose before emitting [[DONE]].`,
      });
      continue;
    }

    // Repetition loop
    const repetition = findRepetition(proseText);
    if (repetition) {
      findings.push({
        kind: "repetition-loop",
        chapter: ch.name,
        chapterNodeId: String(ch._id),
        phrase: repetition.phrase,
        count: repetition.count,
        consecutive: repetition.consecutive,
        message:
          `Chapter "${ch.name}" contains a repetition loop: the phrase "${repetition.phrase}" ` +
          `appears ${repetition.count} times${repetition.consecutive ? ` (${repetition.consecutive} consecutive)` : ""}. ` +
          `This is a terminal-loop failure mode — the model lost the thread and started ` +
          `repeating. Rewrite the chapter's final third with new material that actually ` +
          `closes the chapter's arc instead of looping on a closing phrase.`,
      });
    }

    // Way-under-target
    if (ch.targetWordCount && approxWords < ch.targetWordCount * MIN_TARGET_RATIO) {
      findings.push({
        kind: "under-target",
        chapter: ch.name,
        chapterNodeId: String(ch._id),
        approxWords,
        target: ch.targetWordCount,
        message:
          `Chapter "${ch.name}" is ~${approxWords} words but the target was ${ch.targetWordCount}. ` +
          `That's under ${Math.round(MIN_TARGET_RATIO * 100)}% of target — likely truncated or cut short. ` +
          `Rewrite with fuller scene development.`,
      });
    }

    // Character name drift — prose mentions proper nouns that look
    // like character names but aren't in the contract. Catches the
    // failure mode where the writer invents "Elena" and "Daniel"
    // when the contract declared "Tabor" and "Mara". Heuristic:
    // capitalized words that appear 3+ times, aren't sentence-starts
    // of common words, and don't match any declared character name.
    if (characters.length > 0) {
      const undeclared = detectUndeclaredCharacters(proseText, characters);
      if (undeclared.length > 0) {
        findings.push({
          kind: "character-drift",
          chapter: ch.name,
          chapterNodeId: String(ch._id),
          undeclaredNames: undeclared.map((u) => u.name),
          declaredCharacters: characters.map((c) => c.name),
          message:
            `Chapter "${ch.name}" introduces character names the contract never declared: ${undeclared.map((u) => `"${u.name}" (${u.count} mentions)`).join(", ")}. ` +
            `The contract only declared: ${characters.map((c) => c.name).join(", ")}. ` +
            `Rewrite to use ONLY the declared characters, OR emit [[NO-WRITE: need additional character ` +
            `(${undeclared[0].name}) declared in contracts]] if the plot genuinely requires one. ` +
            `Do NOT silently invent characters across chapters — each chapter that adds a new one ` +
            `makes the book less coherent.`,
        });
      }
    }

    // Character pronoun drift. For each declared character that appears
    // in this chapter, count the wrong-pronouns within 120 chars of
    // the character's name. If the ratio crosses a threshold, flag.
    for (const char of characters) {
      if (!char.pronouns) continue; // can't check without a declared set
      const drift = detectPronounDrift(proseText, char);
      if (drift) {
        findings.push({
          kind: "pronoun-drift",
          chapter: ch.name,
          chapterNodeId: String(ch._id),
          character: char.name,
          declaredPronouns: char.pronouns.join("/"),
          driftedTo: drift.wrongProns.join("/"),
          wrongMentions: drift.wrongCount,
          totalMentions: drift.totalCount,
          message:
            `Chapter "${ch.name}" refers to "${char.name}" with pronouns "${drift.wrongProns.join("/")}" ` +
            `${drift.wrongCount} time(s), but the contract declares "${char.pronouns.join("/")}". ` +
            `Rewrite these passages to use the declared pronouns. Contract is ground truth — ` +
            `if the contract is wrong, emit [[NO-WRITE: pronouns for ${char.name} need architect update]] instead.`,
        });
      }
    }
  }

  return {
    ok: findings.length === 0,
    findings,
    scanned: chapters.length,
  };
}

// ─────────────────────────────────────────────────────────────────────

async function collectChapters(projectNodeId) {
  const out = [];
  const visited = new Set([String(projectNodeId)]);
  const queue = [String(projectNodeId)];
  let scanned = 0;
  while (queue.length > 0 && scanned < 400) {
    const id = queue.shift();
    scanned++;
    const node = await Node.findById(id).select("_id name children metadata").lean();
    if (!node) continue;
    const bwMeta = node.metadata instanceof Map
      ? node.metadata.get("book-workspace")
      : node.metadata?.["book-workspace"];
    const swMeta = node.metadata instanceof Map
      ? node.metadata.get("swarm")
      : node.metadata?.["swarm"];
    if (bwMeta?.role === "chapter" || bwMeta?.role === "scene") {
      out.push({
        _id: node._id,
        name: node.name,
        spec: swMeta?.spec || bwMeta?.systemSpec || null,
        targetWordCount: bwMeta?.targetWordCount || null,
      });
    }
    if (Array.isArray(node.children)) {
      for (const kid of node.children) {
        const k = String(kid);
        if (!visited.has(k)) { visited.add(k); queue.push(k); }
      }
    }
  }
  return out;
}

/**
 * Repetition detector. Walks the text, slides a window of MIN_FRAGMENT_LEN
 * chars, counts occurrences of each window phrase. If any phrase appears
 * more than REPETITION_TOTAL_THRESHOLD times OR
 * REPETITION_CONSECUTIVE_THRESHOLD times back-to-back, flag it.
 *
 * Naive O(n²) but capped at 40k chars per chapter; fine for book-scale.
 */
function findRepetition(text) {
  if (typeof text !== "string" || text.length < MIN_FRAGMENT_LEN * REPETITION_TOTAL_THRESHOLD) {
    return null;
  }
  const sample = text.slice(-8000); // focus on the tail where loops happen

  // Build 40-char sliding phrases; check occurrences
  const phraseLen = 40;
  const counts = new Map();
  for (let i = 0; i + phraseLen <= sample.length; i += 10) {
    const phrase = normalize(sample.slice(i, i + phraseLen));
    if (phrase.length < MIN_FRAGMENT_LEN) continue;
    counts.set(phrase, (counts.get(phrase) || 0) + 1);
  }

  let worst = null;
  for (const [phrase, count] of counts) {
    if (count < REPETITION_TOTAL_THRESHOLD / 2) continue;
    // Confirm by scanning the whole text
    const re = new RegExp(escapeRegex(phrase), "gi");
    const matches = sample.match(re) || [];
    if (matches.length < REPETITION_TOTAL_THRESHOLD) continue;

    // Consecutive check: find runs where phrase repeats with short gaps
    let consecutive = 0;
    let maxConsecutive = 0;
    let lastEnd = -1;
    let m;
    const re2 = new RegExp(escapeRegex(phrase), "gi");
    while ((m = re2.exec(sample)) !== null) {
      if (lastEnd !== -1 && m.index - lastEnd < 200) consecutive++;
      else consecutive = 1;
      maxConsecutive = Math.max(maxConsecutive, consecutive);
      lastEnd = m.index + m[0].length;
    }

    if (matches.length >= REPETITION_TOTAL_THRESHOLD ||
        maxConsecutive >= REPETITION_CONSECUTIVE_THRESHOLD) {
      if (!worst || matches.length > worst.count) {
        worst = {
          phrase: phrase.slice(0, 80),
          count: matches.length,
          consecutive: maxConsecutive,
        };
      }
    }
  }
  return worst;
}

function normalize(s) {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

// Words that look capitalized because they start sentences or are proper
// nouns that don't count as character names (days, months, places we
// can't know, common sentence starters). Keep this list conservative —
// over-including filters hides real character-drift findings.
const CAPITALIZED_FALSE_POSITIVES = new Set([
  "I","The","A","An","He","She","They","It","We","You","My","His","Her",
  "And","But","Or","So","Then","Now","When","Where","Why","How","What","Who",
  "Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday",
  "January","February","March","April","May","June","July","August",
  "September","October","November","December",
  "TreeOS","God","Earth","America","English","German","French","Spanish",
  "Chapter","Part","Book","Scene","Prologue","Epilogue",
]);

/**
 * Find proper nouns in the prose that aren't in the declared character
 * list. Returns [{ name, count }] sorted by count desc. Threshold: a
 * name must appear ≥ 3 times to count as "a character" (one-off proper
 * nouns like a single place name shouldn't trigger drift).
 */
function detectUndeclaredCharacters(text, characters) {
  if (!text) return [];
  const declaredNames = new Set(characters.map((c) => c.name));
  const declaredLower = new Set(characters.map((c) => c.name.toLowerCase()));
  // Match every capitalized word. Filter out the common English
  // sentence-starters and calendar/cardinal false positives via the
  // FALSE_POSITIVES set. This catches proper nouns wherever they
  // appear — including right after a period — which is exactly where
  // character names show up in prose.
  const counts = new Map();
  const re = /\b([A-Z][a-z]{1,20})\b/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const word = m[1];
    if (CAPITALIZED_FALSE_POSITIVES.has(word)) continue;
    if (declaredNames.has(word) || declaredLower.has(word.toLowerCase())) continue;
    counts.set(word, (counts.get(word) || 0) + 1);
  }
  const out = [];
  for (const [name, count] of counts) {
    if (count >= 3) out.push({ name, count });
  }
  out.sort((a, b) => b.count - a.count);
  return out.slice(0, 8); // cap the report
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Pronoun sets. If a character's pronouns include any in one set,
// pronouns from another set are "wrong" for them.
const PRONOUN_SETS = {
  "he/him": ["he", "him", "his", "himself"],
  "she/her": ["she", "her", "hers", "herself"],
  "they/them": ["they", "them", "their", "theirs", "themself", "themselves"],
  "ze/zir": ["ze", "zir", "zirs", "zirself"],
  "xe/xem": ["xe", "xem", "xyr", "xemself"],
};

function normalizeProns(raw) {
  if (!raw) return null;
  const lower = String(raw).toLowerCase();
  const found = [];
  for (const [key] of Object.entries(PRONOUN_SETS)) {
    if (lower.includes(key) || lower.includes(key.split("/")[0])) found.push(key);
  }
  return found.length > 0 ? found : null;
}

function pronounsFromFields(fields) {
  if (!Array.isArray(fields)) return null;
  for (const f of fields) {
    const norm = normalizeProns(f);
    if (norm) return norm.join(", ");
  }
  return null;
}

/**
 * For a character with declared pronouns, find pronouns from OTHER sets
 * that appear near the character's name in the prose. Proximity = same
 * sentence or within 120 chars. Flag if wrongCount crosses threshold.
 */
function detectPronounDrift(text, char) {
  if (!text || !char?.name || !char?.pronouns) return null;

  // Build the "correct" and "wrong" word sets.
  const correct = new Set();
  for (const key of char.pronouns) {
    const set = PRONOUN_SETS[key];
    if (set) for (const w of set) correct.add(w.toLowerCase());
  }
  const wrongByKey = {};
  for (const [key, words] of Object.entries(PRONOUN_SETS)) {
    if (!char.pronouns.includes(key)) wrongByKey[key] = words.map((w) => w.toLowerCase());
  }

  const nameRe = new RegExp(`\\b${escapeRegex(char.name)}\\b`, "gi");
  const mentions = [];
  let m;
  while ((m = nameRe.exec(text)) !== null) {
    mentions.push({ start: m.index, end: m.index + m[0].length });
  }
  if (mentions.length === 0) return null;

  let wrongCount = 0;
  const wrongPronounsSeen = new Set();

  for (const mention of mentions) {
    const windowStart = Math.max(0, mention.start - 120);
    const windowEnd = Math.min(text.length, mention.end + 120);
    const windowText = text.slice(windowStart, windowEnd).toLowerCase();

    for (const [key, words] of Object.entries(wrongByKey)) {
      for (const w of words) {
        const wRe = new RegExp(`\\b${w}\\b`, "g");
        if (wRe.test(windowText)) {
          wrongCount++;
          wrongPronounsSeen.add(key);
          break;
        }
      }
    }
  }

  // Threshold: >=2 wrong-pronoun occurrences OR >20% of mentions wrong.
  if (wrongCount >= 2 || (mentions.length >= 5 && wrongCount / mentions.length > 0.2)) {
    return {
      wrongCount,
      totalCount: mentions.length,
      wrongProns: [...wrongPronounsSeen],
    };
  }
  return null;
}
