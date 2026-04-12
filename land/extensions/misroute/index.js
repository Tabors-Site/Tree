/**
 * Misroute Extension
 *
 * Feedback loop for routing correctness. Hooks beforeLLMCall to watch for
 * correction phrases and the !misroute tag. When the current message is a
 * correction, the most recent routing decision for the same user is logged
 * as a misroute, analyzed, and a vocabulary suggestion is generated.
 *
 * Storage: per-user metadata on the User document, namespace "misroute":
 *
 *   user.metadata.misroute = {
 *     log: [{ ts, message, actualRoute, correctExtension, correctionText, ... }, ...],
 *     suggestions: [{ word, wrongExtension, correctExtension, suggestedBucket, count, lastSeen }, ...],
 *   }
 *
 * The log is capped at MAX_LOG_ENTRIES, suggestions accumulate with counts
 * so repeated trip words surface first. No kernel changes, no new models.
 */

import log from "../../seed/log.js";
import User from "../../seed/models/user.js";
import { getUserMeta, setUserMeta } from "../../seed/tree/userMetadata.js";
import { getLoadedExtensionNames, getVocabularyForExtension, getExtensionDir } from "../loader.js";
import {
  detectCorrection,
  analyzeMisroute,
  extractLatestUserMessage,
  wordToPatternSource,
  MAX_LOG_ENTRIES,
  MAX_SUGGESTIONS,
  AUTO_PROMOTE_THRESHOLD,
  PERSONAL_PROMOTE_THRESHOLD,
} from "./core.js";
import {
  appendLearnedPattern,
  removeLearnedPattern,
  listLearnedEntries,
} from "./learnedFile.js";
import {
  appendPersonalPattern,
  removePersonalPattern,
  listPersonalEntries,
  invalidatePersonalVocabCache,
} from "./personalVocab.js";

export async function init(core) {
  // Cache of known extension names for correction parsing. Refreshed lazily.
  let knownExtensions = null;
  function refreshKnown() {
    knownExtensions = new Set(getLoadedExtensionNames().map(n => n.toLowerCase()));
  }

  // ── beforeLLMCall: detect corrections and log misroutes ──
  //
  // This hook fires right before every LLM call. It runs BEFORE the actual
  // model generation, so we can cheaply inspect the incoming user message
  // without adding latency to anything except the detection itself (regex).
  // We never cancel the call. This hook is observational.
  core.hooks.register("beforeLLMCall", async ({ userId, rootId, mode, messages }) => {
    try {
      if (!userId || !messages) return;
      const message = extractLatestUserMessage(messages);
      if (!message) return;

      if (!knownExtensions) refreshKnown();

      const correction = detectCorrection(message, knownExtensions);
      if (!correction?.isCorrection) return;

      // Pull the routing ring from the tree-orchestrator. The orchestrator
      // calls recordRoutingDecision BEFORE dispatching the mode that fires
      // this hook, so the current message's routing is already at ring[0].
      // The PREVIOUS message (the one being corrected) is at ring[1].
      const { getExtension } = await import("../loader.js");
      const treeOrch = getExtension("tree-orchestrator");
      if (!treeOrch?.exports?.getLastRoutingRing) return;

      // visitorId convention: tree=`${rootId}:${userId}`, home=`home:${userId}`,
      // land=`land:${userId}`. See seed/llm/conversation.js around line 2017.
      const visitorId = rootId ? `${rootId}:${userId}` : `home:${userId}`;
      const ring = treeOrch.exports.getLastRoutingRing(visitorId);
      if (!ring || ring.length < 2) return; // need at least previous + current

      // ring[0] is the current message (the correction itself).
      // ring[1] is the message being corrected.
      const lastRouting = ring[1];
      if (!lastRouting) return;

      // Filter 1: stale routings. Don't log a correction of something the
      // user said long ago — almost certainly unrelated.
      const STALE_MS = 5 * 60 * 1000; // 5 minutes
      if (lastRouting.ts && Date.now() - lastRouting.ts > STALE_MS) return;

      // Filter 2: don't log a correction of a correction. If the previous
      // routing was itself triggered by a correction phrase, bail to avoid
      // cascading false positives.
      if (detectCorrection(lastRouting.message || "", knownExtensions)) return;

      // Filter 3: the previous routing must have actually been an extension
      // dispatch (not a conversational fallback). The recorded entry will
      // have a real extName for extension dispatches; converse/fallback
      // routes don't get recorded with rich metadata.
      if (!lastRouting.extName || lastRouting.extName === "converse") return;

      // Fire-and-forget the bookkeeping save so the LLM call isn't blocked
      // on a database round trip. Errors get logged at warn level inside
      // logMisroute itself; we attach a catch to surface anything that
      // escapes the function (otherwise an unhandled rejection would crash).
      logMisroute({
        userId,
        rootId,
        correction,
        lastRouting,
        correctionText: message,
      }).catch(err => log.warn("Misroute", `logMisroute background error: ${err.message}`));

      // Note: active reroute is handled in the orchestrator's entry point
      // (orchestrateTreeRequest -> checkForCorrectionReroute) so the
      // substitution happens BEFORE classification and produces ONE response
      // instead of two. This hook remains as a backup observer for cases
      // where the orchestrator path doesn't catch the correction (e.g.,
      // converse path, or extensions that bypass the standard pipeline).
    } catch (err) {
      log.warn("Misroute", `beforeLLMCall error: ${err.message}\n${err.stack || ""}`);
    }
  }, "misroute");

  // Pick the best mode for an extension given the original message's tense.
  // Past tense -> review, future -> coach, imperative -> plan, default -> log.
  // Falls back to any mode the extension owns if the preferred suffix doesn't exist.
  async function resolveTargetMode(extName, tense) {
    try {
      const { getModesOwnedBy } = await import("../../seed/tree/extensionScope.js");
      const modes = getModesOwnedBy(extName);
      if (!modes || modes.length === 0) return null;
      const find = (...suffixes) => {
        for (const s of suffixes) {
          const m = modes.find(k => k.endsWith(`-${s}`));
          if (m) return m;
        }
        return null;
      };
      switch (tense) {
        case "past":       return find("review", "ask") || modes[0];
        case "future":     return find("coach")         || modes[0];
        case "imperative": return find("plan")          || modes[0];
        case "negated":    return find("coach")         || modes[0];
        default:           return find("log", "tell")   || modes[0];
      }
    } catch {
      return null;
    }
  }

  // ── Early intercept: detect correction + return reroute intent ──
  //
  // Called by the orchestrator at the very top of orchestrateTreeRequest,
  // BEFORE classification or recordRoutingDecision. At this point ring[0]
  // is the previous message's routing (the one being corrected), not the
  // current correction.
  //
  // If a correction is detected with a known target extension, returns a
  // substitution intent so the orchestrator can replace the current message
  // with the original and forceMode to the correct extension. This produces
  // ONE orchestration call instead of two and the user only sees one response.
  //
  // The misroute event is logged in the background (fire-and-forget).
  //
  // Returns: { rerouteMessage, forceMode, correctExtension } or null.
  async function checkForCorrectionReroute({ message, visitorId, userId, rootId }) {
    try {
      if (!message || !visitorId || !userId) return null;

      if (!knownExtensions) refreshKnown();
      const correction = detectCorrection(message, knownExtensions);
      if (!correction?.isCorrection) return null;
      if (!correction.correctExtension) return null; // need a named target to substitute

      // Look up the previous routing. At this stage we're BEFORE
      // recordRoutingDecision for the current message, so ring[0] is the
      // previous message (the one being corrected).
      const { getExtension } = await import("../loader.js");
      const treeOrch = getExtension("tree-orchestrator");
      if (!treeOrch?.exports?.getLastRoutingRing) return null;

      const ring = treeOrch.exports.getLastRoutingRing(visitorId);
      if (!ring || ring.length === 0) return null;
      const lastRouting = ring[0];
      if (!lastRouting) return null;

      // Same filters as the beforeLLMCall hook (stale, double-correction, ext sanity)
      const STALE_MS = 5 * 60 * 1000;
      if (lastRouting.ts && Date.now() - lastRouting.ts > STALE_MS) return null;
      if (detectCorrection(lastRouting.message || "", knownExtensions)) return null;
      if (!lastRouting.extName || lastRouting.extName === "converse") return null;

      // Resolve the target mode for the correct extension
      const targetMode = await resolveTargetMode(
        correction.correctExtension,
        lastRouting.tense || "present",
      );
      if (!targetMode) return null;

      // Log the misroute event in the background (don't block the orchestration)
      logMisroute({
        userId,
        rootId,
        correction,
        lastRouting,
        correctionText: message,
      }).catch(err => log.warn("Misroute", `bg log error: ${err.message}`));

      log.info("Misroute",
        `🔄 intercept rerouting "${lastRouting.message.slice(0, 50)}" -> ${targetMode}`,
      );

      return {
        rerouteMessage: lastRouting.message,
        forceMode: targetMode,
        correctExtension: correction.correctExtension,
        originalCorrection: message,
      };
    } catch (err) {
      log.warn("Misroute", `checkForCorrectionReroute error: ${err.message}`);
      return null;
    }
  }

  // ── Storage helpers ──

  async function loadMisroute(userId) {
    const user = await User.findById(userId);
    if (!user) return { user: null, data: null };
    const data = getUserMeta(user, "misroute") || { log: [], suggestions: [] };
    if (!Array.isArray(data.log)) data.log = [];
    if (!Array.isArray(data.suggestions)) data.suggestions = [];
    return { user, data };
  }

  async function saveMisroute(user, data) {
    // Cap the log at MAX_LOG_ENTRIES, keep newest
    if (data.log.length > MAX_LOG_ENTRIES) {
      data.log = data.log.slice(0, MAX_LOG_ENTRIES);
    }
    // Cap suggestions at MAX_SUGGESTIONS, keep highest count
    if (data.suggestions.length > MAX_SUGGESTIONS) {
      data.suggestions.sort((a, b) => (b.count || 0) - (a.count || 0));
      data.suggestions = data.suggestions.slice(0, MAX_SUGGESTIONS);
    }
    setUserMeta(user, "misroute", data);
    await user.save();
  }

  async function logMisroute({ userId, rootId, correction, lastRouting, correctionText }) {
    const { user, data } = await loadMisroute(userId);
    if (!user) {
      log.warn("Misroute", `logMisroute: user not found for userId=${String(userId).slice(0, 8)}`);
      return;
    }

    // Flatten the log entry to keep it within the kernel's max nesting depth
    // of 5. We unfold actualRoute and posMatches into top-level fields rather
    // than nested objects. The page renderer reads these flattened fields.
    const pos = lastRouting.posMatches || {};
    const entry = {
      ts: Date.now(),
      rootId: rootId || null,
      message: lastRouting.message,
      actualExtension: lastRouting.extName,
      actualMode: lastRouting.mode,
      actualConfidence: lastRouting.confidence,
      actualPosNouns: Array.isArray(pos.nouns) ? pos.nouns : [],
      actualPosVerbs: Array.isArray(pos.verbs) ? pos.verbs : [],
      actualPosAdjectives: Array.isArray(pos.adjectives) ? pos.adjectives : [],
      actualPosScore: lastRouting.posScore || 0,
      actualPosLocality: !!lastRouting.posLocality,
      correctExtension: correction.correctExtension,
      correctionText: correctionText.slice(0, 200),
      detectionKind: correction.kind,
      detectionConfidence: correction.confidence,
      repeatCount: 1,
    };

    // Dedup: if the most recent log entry is the SAME message + actual ext +
    // correct ext within a 60s window, increment its repeatCount and update
    // ts/correctionText instead of pushing a new entry. Keeps the log clean
    // when a user retypes the same misrouted message multiple times in a row.
    const DEDUP_WINDOW_MS = 60 * 1000;
    const newest = data.log[0];
    const isDuplicate = newest
      && newest.message === entry.message
      && newest.actualExtension === entry.actualExtension
      && newest.correctExtension === entry.correctExtension
      && (Date.now() - (newest.ts || 0)) < DEDUP_WINDOW_MS;

    if (isDuplicate) {
      newest.repeatCount = (newest.repeatCount || 1) + 1;
      newest.ts = Date.now();
      newest.correctionText = entry.correctionText;
    } else {
      // Newest first
      data.log.unshift(entry);
    }

    // Generate vocabulary suggestions if we know the correct extension
    const promotionsToRun = [];
    if (correction.correctExtension) {
      const correctVocab = getVocabularyForExtension(correction.correctExtension);
      const newSuggestions = analyzeMisroute({
        message: lastRouting.message,
        actualRoute: {
          extension: lastRouting.extName,
          posMatches: lastRouting.posMatches,
        },
        correctExtension: correction.correctExtension,
        correctVocab,
      });

      // Merge into existing suggestions, incrementing count on duplicates.
      // After merge, check both promotion thresholds:
      //   personal (count >= 2) -> write to user.metadata.personalVocab
      //   global   (count >= 5) -> write to extension's vocabulary.learned.json
      // Both can fire on the same correction. Personal is per-user, global is
      // land-wide. Higher count means broader scope.
      const personalPromotions = [];
      for (const sug of newSuggestions) {
        const key = `${sug.word}->${sug.correctExtension}`;
        const existing = data.suggestions.find(s =>
          `${s.word}->${s.correctExtension}` === key
        );
        let target;
        if (existing) {
          existing.count = (existing.count || 1) + 1;
          existing.lastSeen = Date.now();
          target = existing;
        } else {
          target = { ...sug, count: 1, lastSeen: Date.now(), autoApplied: false, personalApplied: false };
          data.suggestions.push(target);
        }

        // Personal threshold crossed and not yet personal-applied
        if (!target.personalApplied && (target.count || 0) >= PERSONAL_PROMOTE_THRESHOLD) {
          personalPromotions.push({ suggestion: target, userId });
        }

        // Global threshold crossed and not yet auto-applied
        if (!target.autoApplied && (target.count || 0) >= AUTO_PROMOTE_THRESHOLD) {
          promotionsToRun.push({ suggestion: target, userId });
        }
      }

      // ── Auto-promote to personal vocabulary (lower threshold) ──
      // Personal entries live on user.metadata.personalVocab and only affect
      // this single user's routing. No file changes, no land-wide impact.
      for (const { suggestion, userId: srcUserId } of personalPromotions) {
        const promoted = await promotePersonal(suggestion, srcUserId);
        if (promoted) {
          suggestion.personalApplied = true;
          suggestion.personalAppliedAt = Date.now();
          suggestion.personalPattern = promoted.pattern;
        }
      }
    }

    // ── Auto-promote crossed-threshold suggestions to learned sidecar file ──
    // Each promotion writes to land/extensions/{ext}/vocabulary.learned.json,
    // marks the suggestion as autoApplied, and triggers a routing index rebuild
    // for the affected tree so the new vocabulary takes effect immediately.
    const promotedExts = new Set();
    for (const { suggestion, userId: srcUserId } of promotionsToRun) {
      const promoted = await promoteSuggestion(suggestion, srcUserId);
      if (promoted) {
        suggestion.autoApplied = true;
        suggestion.appliedAt = Date.now();
        suggestion.appliedPattern = promoted.pattern;
        promotedExts.add(suggestion.correctExtension);
      }
    }

    await saveMisroute(user, data);

    log.info("Misroute",
      `captured ${correction.kind} "${lastRouting.message.slice(0, 50)}" routed=${lastRouting.extName}` +
      (correction.correctExtension ? ` -> correct=${correction.correctExtension}` : " (correct unknown)"),
    );

    // Hot-reload routing index for the current tree so promoted vocabulary
    // takes effect on the very next message. We rebuild only the tree the
    // misroute happened in to keep the cost bounded.
    if (promotedExts.size > 0 && rootId) {
      try {
        const { getExtension } = await import("../loader.js");
        const treeOrch = getExtension("tree-orchestrator");
        if (treeOrch?.exports?.rebuildIndexForRoot) {
          await treeOrch.exports.rebuildIndexForRoot(rootId);
          log.info("Misroute", `routing index rebuilt for root ${String(rootId).slice(0, 8)} after promoting ${promotedExts.size} extension(s)`);
        }
      } catch (err) {
        log.debug("Misroute", `index rebuild failed: ${err.message}`);
      }
    }
  }

  // ── Promote a suggestion to the user's personal vocabulary ──
  // Personal entries are scoped to a single user and never touch files.
  // Returns { pattern, bucket, extName } on success, or null on failure.
  async function promotePersonal(suggestion, srcUserId) {
    if (!suggestion?.correctExtension || !suggestion?.word || !srcUserId) return null;
    const bucket = suggestion.suggestedBucket || "nouns";
    const pattern = wordToPatternSource(suggestion.word, bucket);
    if (!pattern) return null;

    const result = await appendPersonalPattern(srcUserId, suggestion.correctExtension, bucket, {
      pattern,
      addedAt: new Date().toISOString(),
      trigger: `${suggestion.count} corrections from ${suggestion.wrongExtension}`,
    });

    if (result.added || result.reason === "duplicate-incremented") {
      log.info("Misroute",
        `personal-promoted "${suggestion.word}" -> ${suggestion.correctExtension}.${bucket} ` +
        `for user ${String(srcUserId).slice(0, 8)} (${suggestion.count} corrections)`,
      );
      return { pattern, bucket, extName: suggestion.correctExtension };
    }
    log.warn("Misroute", `personal promotion failed for "${suggestion.word}": ${result.reason}`);
    return null;
  }

  // ── Promote a suggestion to the target extension's learned vocabulary file ──
  // Returns { pattern, bucket, extName } on success, or null on failure.
  async function promoteSuggestion(suggestion, srcUserId) {
    if (!suggestion?.correctExtension || !suggestion?.word) return null;
    const extDir = getExtensionDir(suggestion.correctExtension);
    if (!extDir) {
      log.warn("Misroute", `cannot promote: extension dir for ${suggestion.correctExtension} not found`);
      return null;
    }
    const bucket = suggestion.suggestedBucket || "nouns";
    const pattern = wordToPatternSource(suggestion.word, bucket);
    if (!pattern) return null;

    const result = appendLearnedPattern(extDir, bucket, {
      pattern,
      addedAt: new Date().toISOString(),
      trigger: `${suggestion.count} misroutes from ${suggestion.wrongExtension}`,
      fromUserId: srcUserId || null,
    });

    if (result.added) {
      log.info("Misroute",
        `auto-promoted "${suggestion.word}" -> ${suggestion.correctExtension}.${bucket} ` +
        `(${suggestion.count} corrections from ${suggestion.wrongExtension})`,
      );
      return { pattern, bucket, extName: suggestion.correctExtension };
    }
    if (result.reason === "duplicate") {
      // Already in the file from a prior promotion. Mark as applied anyway.
      return { pattern, bucket, extName: suggestion.correctExtension };
    }
    log.warn("Misroute", `promotion failed for "${suggestion.word}": ${result.reason}`);
    return null;
  }

  // ── HTTP routes for CLI commands and the HTML page ──
  const express = (await import("express")).default;
  const router = express.Router();

  // GET /user/:userId/misroute - HTML page (rendered when ?html is present)
  router.get("/user/:userId/misroute", authenticated, async (req, res, next) => {
    if (!("html" in req.query)) return next();
    try {
      if (req.userId !== req.params.userId) {
        return res.status(403).json({ status: "error", error: { code: "FORBIDDEN", message: "Not your account" } });
      }
      const { renderMisroutePage } = await import("./pages/misroutePage.js");
      const user = await User.findById(req.params.userId).select("username metadata").lean();
      if (!user) return res.status(404).json({ status: "error", error: { code: "USER_NOT_FOUND" } });
      const data = (user.metadata instanceof Map ? user.metadata.get("misroute") : user.metadata?.misroute)
        || { log: [], suggestions: [] };
      const personalEntries = await listPersonalEntries(req.params.userId);
      res.send(renderMisroutePage({
        userId: req.params.userId,
        username: user.username,
        data,
        personalEntries,
        token: req.query.token || null,
        inApp: !!req.query.inApp,
      }));
    } catch (err) {
      log.warn("Misroute", `HTML page error: ${err.message}`);
      res.status(500).json({ status: "error", error: { code: "INTERNAL", message: "Failed to load misroute page" } });
    }
  });

  // GET /user/:userId/misroute - JSON (same data, no html flag)
  router.get("/user/:userId/misroute", authenticated, async (req, res) => {
    if (req.userId !== req.params.userId) {
      return res.status(403).json({ status: "error", error: { code: "FORBIDDEN" } });
    }
    const { data } = await loadMisroute(req.userId);
    if (!data) return res.json({ status: "ok", data: { log: [], suggestions: [] } });
    res.json({ status: "ok", data });
  });

  // GET /misroute - same as list, used by bare `misroute` command
  router.get("/misroute", authenticated, async (req, res) => {
    const { data } = await loadMisroute(req.userId);
    if (!data) return res.json({ status: "ok", data: { log: [], suggestions: [] } });
    res.json({ status: "ok", data: {
      log: data.log.slice(0, 20),
      suggestions: data.suggestions.slice(0, 20),
      totalLog: data.log.length,
      totalSuggestions: data.suggestions.length,
    } });
  });

  // GET /misroute/list - recent misroutes
  router.get("/misroute/list", authenticated, async (req, res) => {
    const { data } = await loadMisroute(req.userId);
    if (!data) return res.json({ status: "ok", data: [] });
    res.json({ status: "ok", data: data.log.slice(0, 50) });
  });

  // GET /misroute/suggestions - proposed vocabulary additions
  router.get("/misroute/suggestions", authenticated, async (req, res) => {
    const { data } = await loadMisroute(req.userId);
    if (!data) return res.json({ status: "ok", data: [] });
    // Sort by count descending so the most-triggered suggestions surface first
    const sorted = [...data.suggestions].sort((a, b) => (b.count || 0) - (a.count || 0));
    res.json({ status: "ok", data: sorted });
  });

  // DELETE /misroute - clear the log
  router.delete("/misroute", authenticated, async (req, res) => {
    const { user, data } = await loadMisroute(req.userId);
    if (!user) return res.status(404).json({ status: "error", error: { code: "USER_NOT_FOUND" } });
    data.log = [];
    data.suggestions = [];
    await saveMisroute(user, data);
    res.json({ status: "ok", data: { cleared: true } });
  });

  // GET /misroute/stats - counts by wrong -> correct pair
  router.get("/misroute/stats", authenticated, async (req, res) => {
    const { data } = await loadMisroute(req.userId);
    if (!data) return res.json({ status: "ok", data: { pairs: [], total: 0 } });
    const pairs = {};
    for (const entry of data.log) {
      const from = entry.actualRoute?.extension || "unknown";
      const to = entry.correctExtension || "unknown";
      const key = `${from}->${to}`;
      pairs[key] = (pairs[key] || 0) + 1;
    }
    const sorted = Object.entries(pairs)
      .map(([k, v]) => ({ pair: k, count: v }))
      .sort((a, b) => b.count - a.count);
    res.json({ status: "ok", data: { pairs: sorted, total: data.log.length } });
  });

  // GET /misroute/learned - list all auto-promoted vocabulary across extensions
  router.get("/misroute/learned", authenticated, async (req, res) => {
    const all = [];
    for (const extName of getLoadedExtensionNames()) {
      const extDir = getExtensionDir(extName);
      if (!extDir) continue;
      const entries = listLearnedEntries(extDir, extName);
      if (entries.length > 0) all.push(...entries);
    }
    res.json({ status: "ok", data: all });
  });

  // GET /misroute/personal - list this user's personal vocabulary entries
  router.get("/misroute/personal", authenticated, async (req, res) => {
    const entries = await listPersonalEntries(req.userId);
    res.json({ status: "ok", data: entries });
  });

  // POST /misroute/personal/revert - remove a personal vocabulary entry
  // Body: { extension, bucket, pattern }
  router.post("/misroute/personal/revert", authenticated, async (req, res) => {
    try {
      const { extension, bucket, pattern } = req.body || {};
      if (!extension || !bucket || !pattern) {
        return res.status(400).json({ status: "error", error: { code: "INVALID_INPUT", message: "extension, bucket, pattern required" } });
      }
      const result = await removePersonalPattern(req.userId, extension, bucket, pattern);
      if (!result.removed) {
        return res.status(404).json({ status: "error", error: { code: "NOT_FOUND", message: result.reason } });
      }

      // Clear personalApplied marker on the matching suggestion so it can re-promote
      // if the misroute pattern reoccurs.
      const { user, data } = await loadMisroute(req.userId);
      if (user && data) {
        for (const sug of data.suggestions) {
          if (sug.personalPattern === pattern && sug.correctExtension === extension) {
            sug.personalApplied = false;
            sug.personalPattern = null;
            sug.personalAppliedAt = null;
          }
        }
        await saveMisroute(user, data);
      }

      res.json({ status: "ok", data: { reverted: true } });
    } catch (err) {
      log.warn("Misroute", `personal revert error: ${err.message}`);
      res.status(500).json({ status: "error", error: { code: "INTERNAL", message: err.message } });
    }
  });

  // POST /misroute/revert - remove a learned pattern from an extension's sidecar
  // Body: { extension: "fitness", bucket: "nouns", pattern: "\\b(bill)\\b" }
  // Also clears the autoApplied flag on the matching suggestion so it can
  // re-promote later if it crosses the threshold again.
  router.post("/misroute/revert", authenticated, async (req, res) => {
    try {
      const { extension, bucket, pattern } = req.body || {};
      if (!extension || !bucket || !pattern) {
        return res.status(400).json({ status: "error", error: { code: "INVALID_INPUT", message: "extension, bucket, pattern required" } });
      }
      const extDir = getExtensionDir(extension);
      if (!extDir) {
        return res.status(404).json({ status: "error", error: { code: "EXTENSION_NOT_FOUND" } });
      }
      const result = removeLearnedPattern(extDir, bucket, pattern);
      if (!result.removed) {
        return res.status(404).json({ status: "error", error: { code: "NOT_FOUND", message: result.reason } });
      }

      // Clear autoApplied marker on the matching suggestion so it can be re-promoted
      // if the misroute pattern reoccurs. Counter is preserved so the next correction
      // immediately triggers re-promotion.
      const { user, data } = await loadMisroute(req.userId);
      if (user && data) {
        for (const sug of data.suggestions) {
          if (sug.appliedPattern === pattern && sug.correctExtension === extension) {
            sug.autoApplied = false;
            sug.appliedPattern = null;
            sug.appliedAt = null;
          }
        }
        await saveMisroute(user, data);
      }

      // Hot-reload the routing index for the user's current trees so the revert
      // takes effect on the next message. We don't know which root they're on,
      // so we rebuild all indexed roots. Cheap.
      try {
        const { getExtension } = await import("../loader.js");
        const treeOrch = getExtension("tree-orchestrator");
        if (treeOrch?.exports?.getAllIndexedRoots && treeOrch?.exports?.rebuildIndexForRoot) {
          for (const rid of treeOrch.exports.getAllIndexedRoots()) {
            await treeOrch.exports.rebuildIndexForRoot(rid);
          }
        }
      } catch {}

      res.json({ status: "ok", data: { reverted: true } });
    } catch (err) {
      log.warn("Misroute", `revert error: ${err.message}`);
      res.status(500).json({ status: "error", error: { code: "INTERNAL", message: err.message } });
    }
  });

  // ── Register a slot in the user profile quick links ──
  // Falls back gracefully if treeos-base isn't loaded (e.g., headless deploys).
  try {
    const { getExtension } = await import("../loader.js");
    const base = getExtension("treeos-base");
    base?.exports?.registerSlot?.("user-quick-links", "misroute", ({ userId, queryString }) =>
      `<li><a href="/api/v1/user/${userId}/misroute${queryString}">Misroutes</a></li>`,
      { priority: 60 }
    );
  } catch {}

  log.info("Misroute", "Loaded. Listening for corrections on beforeLLMCall.");

  return {
    router,
    exports: {
      detectCorrection,
      analyzeMisroute,
      // Early intercept for rerouting (called by orchestrator at entry).
      // Returns { rerouteMessage, forceMode, correctExtension } or null.
      checkForCorrectionReroute,
      // Personal vocabulary lookup for the routing index. Returns
      // { extName: { nouns, verbs, adjectives } } as RegExp arrays.
      // Cached per user with a 5-minute TTL.
      async getPersonalVocabularyForUser(userId) {
        const { getPersonalVocabularyForUser } = await import("./personalVocab.js");
        return getPersonalVocabularyForUser(userId);
      },
      // Cache invalidation hook for external writes.
      invalidatePersonalVocabCache,
    },
  };
}

// Lightweight auth middleware wrapper. Attaches userId from the authenticated
// session. If the user isn't authenticated, return 401.
async function authenticated(req, res, next) {
  try {
    const mod = await import("../../seed/middleware/authenticate.js");
    const authenticate = mod.default;
    return authenticate(req, res, next);
  } catch {
    if (req.userId) return next();
    return res.status(401).json({ status: "error", error: { code: "UNAUTHORIZED" } });
  }
}
