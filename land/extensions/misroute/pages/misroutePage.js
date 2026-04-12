/**
 * Misroute review page. Two sections:
 *   1. Vocabulary suggestions: words that triggered the wrong extension and
 *      should probably be added to the correct one. Sorted by trip count.
 *   2. Recent log: chronological list of detected misroutes with the parse
 *      details so the operator can verify the suggestion is right.
 *
 * Operator workflow: glance at suggestions, decide which to apply, edit the
 * relevant manifest, restart land. The page itself doesn't auto-apply
 * vocabulary changes — manifest edits stay manual on purpose.
 */

import { page } from "../../html-rendering/html/layout.js";
import { esc, timeAgo } from "../../html-rendering/html/utils.js";
import { glassCardStyles, responsiveBase } from "../../html-rendering/html/baseStyles.js";

export function renderMisroutePage({ userId, username, data, personalEntries, token, inApp }) {
  const tokenParam = token ? `&token=${esc(token)}` : "";
  const queryString = `?html${tokenParam}`;

  const log = Array.isArray(data?.log) ? data.log : [];
  const suggestions = Array.isArray(data?.suggestions) ? data.suggestions : [];
  const personal = Array.isArray(personalEntries) ? personalEntries : [];

  // Sort suggestions by count desc, then split into pending vs auto-applied.
  // "Pending" excludes both global-applied AND personal-applied so we don't
  // double-show entries that already exist in the personal vocabulary section.
  const sortedSuggestions = [...suggestions].sort((a, b) => (b.count || 0) - (a.count || 0));
  const pendingSuggestions = sortedSuggestions.filter(s => !s.autoApplied && !s.personalApplied);
  const appliedSuggestions = sortedSuggestions.filter(s => s.autoApplied);

  // Aggregate stats. Log entries store the wrong route's extension as
  // entry.actualExtension (flattened from the old entry.actualRoute.extension
  // shape to stay within the kernel's max nesting depth).
  const pairCounts = {};
  for (const entry of log) {
    const from = entry.actualExtension || entry.actualRoute?.extension || "?";
    const to = entry.correctExtension || "unknown";
    const key = `${from} -> ${to}`;
    pairCounts[key] = (pairCounts[key] || 0) + 1;
  }
  const sortedPairs = Object.entries(pairCounts)
    .map(([k, v]) => ({ pair: k, count: v }))
    .sort((a, b) => b.count - a.count);

  const css = `
    ${glassCardStyles}
    ${responsiveBase}

    .mis-container { max-width: 820px; margin: 0 auto; padding: 12px 20px 60px; }

    .page-header { text-align: center; padding: 32px 20px 12px; }
    .page-title { font-size: 1.4rem; color: #e6e8eb; margin-bottom: 6px; }
    .page-subtitle { color: #9ba1ad; font-size: 0.85rem; }

    .section { margin-top: 28px; }
    .section-title {
      font-size: 0.95rem;
      font-weight: 600;
      color: #c4c8d0;
      margin: 0 0 10px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .section-title .count {
      font-size: 0.7rem;
      color: #6b7280;
      font-weight: 400;
    }

    .stat-row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 14px;
    }
    .stat-pill {
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 999px;
      padding: 4px 12px;
      font-size: 0.75rem;
      color: #c4c8d0;
    }
    .stat-pill .num { color: #e6e8eb; font-weight: 600; margin-left: 4px; }

    .sug-card {
      background: rgba(251,146,60,0.04);
      border: 1px solid rgba(251,146,60,0.18);
      border-radius: 10px;
      padding: 12px 16px;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .sug-card:hover { border-color: rgba(251,146,60,0.32); }
    .sug-card.applied {
      background: rgba(123,160,116,0.04);
      border-color: rgba(123,160,116,0.22);
    }
    .sug-card.applied:hover { border-color: rgba(123,160,116,0.4); }
    .sug-card.personal {
      background: rgba(96,165,250,0.04);
      border-color: rgba(96,165,250,0.22);
    }
    .sug-card.personal:hover { border-color: rgba(96,165,250,0.4); }
    .sug-card.personal .sug-target { color: #60a5fa; }
    .sug-applied-meta {
      color: #6b7280;
      font-size: 0.7rem;
      margin-top: 4px;
    }
    .sug-word {
      font-family: monospace;
      font-size: 0.95rem;
      color: #fb923c;
      font-weight: 600;
    }
    .sug-arrow { color: #6b7280; font-size: 0.85rem; padding: 0 4px; }
    .sug-target {
      color: #c4c8d0;
      font-size: 0.85rem;
    }
    .sug-bucket {
      display: inline-block;
      padding: 2px 8px;
      background: rgba(123,160,116,0.12);
      border: 1px solid rgba(123,160,116,0.25);
      color: #7ba074;
      border-radius: 4px;
      font-size: 0.7rem;
      margin-left: 8px;
    }
    .sug-count {
      background: rgba(255,255,255,0.06);
      color: #9ba1ad;
      font-size: 0.7rem;
      padding: 3px 10px;
      border-radius: 999px;
      flex-shrink: 0;
    }

    .log-card {
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.07);
      border-radius: 10px;
      padding: 12px 16px;
      margin-bottom: 8px;
    }
    .log-card:hover { border-color: rgba(255,255,255,0.12); }

    .log-message {
      color: #e6e8eb;
      font-size: 0.9rem;
      line-height: 1.4;
      margin-bottom: 6px;
      word-break: break-word;
    }
    .log-meta {
      color: #6b7280;
      font-size: 0.72rem;
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: center;
    }
    .log-pill {
      padding: 2px 8px;
      border-radius: 4px;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
    }
    .log-pill.wrong {
      background: rgba(200,100,100,0.08);
      border-color: rgba(200,100,100,0.2);
      color: #c97e6a;
    }
    .log-pill.correct {
      background: rgba(123,160,116,0.08);
      border-color: rgba(123,160,116,0.22);
      color: #7ba074;
    }
    .log-pill.kind {
      color: #9ba1ad;
    }
    .log-pill.repeat {
      background: rgba(167,139,250,0.10);
      border-color: rgba(167,139,250,0.30);
      color: #a78bfa;
      font-weight: 600;
    }
    .log-words {
      font-family: monospace;
      font-size: 0.72rem;
      color: #6b7280;
      margin-top: 6px;
    }
    .log-words .pos { color: #fb923c; }

    .mis-empty {
      color: #6b7280;
      font-size: 0.85rem;
      padding: 32px 0;
      text-align: center;
    }

    .back-link {
      display: inline-block;
      color: #9ba1ad;
      text-decoration: none;
      font-size: 0.85rem;
      margin-bottom: 8px;
    }
    .back-link:hover { color: #e6e8eb; }

    .actions {
      display: flex;
      gap: 8px;
      margin-bottom: 16px;
    }
    .btn {
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.1);
      color: #c4c8d0;
      border-radius: 8px;
      padding: 6px 14px;
      font-size: 0.8rem;
      cursor: pointer;
      font-family: inherit;
    }
    .btn:hover { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.18); }
    .btn.danger {
      border-color: rgba(200,100,100,0.25);
      color: rgba(200,100,100,0.85);
    }
    .btn.danger:hover {
      background: rgba(200,100,100,0.1);
      border-color: rgba(200,100,100,0.4);
    }
    .btn.small {
      padding: 4px 10px;
      font-size: 0.72rem;
      flex-shrink: 0;
    }
    .revert-btn {
      border-color: rgba(200,100,100,0.25);
      color: rgba(200,100,100,0.7);
    }
    .revert-btn:hover {
      background: rgba(200,100,100,0.1);
      border-color: rgba(200,100,100,0.4);
      color: #c97e6a;
    }

    .status-msg {
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 0.85rem;
      margin-bottom: 12px;
      display: none;
    }
    .status-msg.success { display: block; background: rgba(123,160,116,0.12); border: 1px solid rgba(123,160,116,0.25); color: #7ba074; }
    .status-msg.error { display: block; background: rgba(200,100,100,0.12); border: 1px solid rgba(200,100,100,0.25); color: #c97e6a; }

    .explanation {
      background: rgba(167,139,250,0.04);
      border-left: 3px solid rgba(167,139,250,0.4);
      border-radius: 0 8px 8px 0;
      padding: 12px 16px;
      margin-bottom: 20px;
      color: #c4c8d0;
      font-size: 0.82rem;
      line-height: 1.6;
    }
  `;

  function renderPendingSuggestion(s) {
    return `
      <div class="sug-card">
        <div>
          <span class="sug-word">${esc(s.word || "?")}</span>
          <span class="sug-arrow">should belong to</span>
          <span class="sug-target">${esc(s.correctExtension || "?")}</span>
          <span class="sug-bucket">${esc(s.suggestedBucket || "nouns")}</span>
        </div>
        <span class="sug-count">${s.count || 1}x</span>
      </div>
    `;
  }

  function renderAppliedSuggestion(s) {
    const ts = s.appliedAt ? timeAgo(new Date(s.appliedAt)) : "";
    const pattern = esc(s.appliedPattern || "");
    const bucket = esc(s.suggestedBucket || "nouns");
    const ext = esc(s.correctExtension || "?");
    return `
      <div class="sug-card applied" data-pattern="${pattern}" data-extension="${ext}" data-bucket="${bucket}">
        <div>
          <span class="sug-word">${esc(s.word || "?")}</span>
          <span class="sug-arrow">added to</span>
          <span class="sug-target">${ext}</span>
          <span class="sug-bucket">${bucket}</span>
          <div class="sug-applied-meta">applied ${ts} after ${s.count || 0} corrections</div>
        </div>
        <button class="btn small revert-btn"
                onclick="revertEntry('${ext}', '${bucket}', this.closest('.sug-card').dataset.pattern)">
          revert
        </button>
      </div>
    `;
  }

  function renderPersonalEntry(p) {
    const ts = p.addedAt ? timeAgo(new Date(p.addedAt)) : "";
    const pattern = esc(p.pattern || "");
    const bucket = esc(p.bucket || "nouns");
    const ext = esc(p.extName || "?");
    return `
      <div class="sug-card personal" data-pattern="${pattern}" data-extension="${ext}" data-bucket="${bucket}">
        <div>
          <span class="sug-word">${esc(p.pattern || "?")}</span>
          <span class="sug-arrow">your override for</span>
          <span class="sug-target">${ext}</span>
          <span class="sug-bucket">${bucket}</span>
          <div class="sug-applied-meta">added ${ts}${p.trigger ? " · " + esc(p.trigger) : ""}</div>
        </div>
        <button class="btn small revert-btn"
                onclick="revertPersonal('${ext}', '${bucket}', this.closest('.sug-card').dataset.pattern)">
          revert
        </button>
      </div>
    `;
  }

  function renderLogEntry(entry) {
    // Read flattened fields with fallbacks to the old nested shape so older
    // log entries written before the flattening still render correctly.
    const wrongExt = entry.actualExtension || entry.actualRoute?.extension || "?";
    const correctExt = entry.correctExtension || "unknown";
    const kind = entry.detectionKind || "?";
    const ts = entry.ts ? timeAgo(new Date(entry.ts)) : "";
    const repeats = entry.repeatCount || 1;

    const nouns = entry.actualPosNouns || entry.actualRoute?.posMatches?.nouns || [];
    const verbs = entry.actualPosVerbs || entry.actualRoute?.posMatches?.verbs || [];
    const adjs = entry.actualPosAdjectives || entry.actualRoute?.posMatches?.adjectives || [];
    const wordParts = [];
    if (nouns.length) wordParts.push(`<span class="pos">n:</span>${esc(nouns.join(","))}`);
    if (verbs.length) wordParts.push(`<span class="pos">v:</span>${esc(verbs.join(","))}`);
    if (adjs.length) wordParts.push(`<span class="pos">a:</span>${esc(adjs.join(","))}`);
    const wordsLine = wordParts.length > 0 ? `<div class="log-words">${wordParts.join(" ")}</div>` : "";
    const repeatBadge = repeats > 1 ? `<span class="log-pill repeat">×${repeats}</span>` : "";

    return `
      <div class="log-card">
        <div class="log-message">"${esc(entry.message || "")}"</div>
        <div class="log-meta">
          <span class="log-pill wrong">${esc(wrongExt)}</span>
          <span>&rarr;</span>
          <span class="log-pill correct">${esc(correctExt)}</span>
          <span class="log-pill kind">${esc(kind)}</span>
          ${repeatBadge}
          <span>${ts}</span>
        </div>
        ${wordsLine}
      </div>
    `;
  }

  const body = `
    <div class="mis-container">
      ${!inApp ? `<a class="back-link" href="/api/v1/user/${userId}/profile${queryString}">&larr; Profile</a>` : ""}

      <div class="page-header">
        <div class="page-title">Misroutes</div>
        <div class="page-subtitle">Routing mistakes ${esc(username || "")} caught the system making</div>
      </div>

      <div class="explanation">
        When a message gets sent to the wrong extension, you can correct it by saying things like
        <code>i meant fitness</code> or <code>no that should have been food</code>, or by typing
        <code>!misroute food</code> (or <code>!misroute fitness</code>, etc.) as your next message.
        Bare <code>!misroute</code> alone just logs the event without learning anything because the
        system has no idea where it should have gone. The named form teaches.
        After <strong>2 corrections</strong> the word gets added to <em>your personal vocabulary</em>
        (affects you only). After <strong>5 corrections</strong> it gets promoted to the target
        extension's global <code>vocabulary.learned.json</code> sidecar file (affects everyone in
        this land). Both layers can fire on the same correction. Revert any entry below if it's wrong.
      </div>

      <div id="statusMsg" class="status-msg"></div>

      ${log.length > 0 ? `
        <div class="stat-row">
          <div class="stat-pill">total<span class="num">${log.length}</span></div>
          ${sortedPairs.slice(0, 5).map(p => `
            <div class="stat-pill">${esc(p.pair)}<span class="num">${p.count}</span></div>
          `).join("")}
        </div>
      ` : ""}

      <div class="actions">
        ${log.length > 0 ? `<button class="btn danger" onclick="clearAll()">Clear log</button>` : ""}
      </div>

      ${log.length === 0 && sortedSuggestions.length === 0 && personal.length === 0 ? `
        <div class="mis-empty">
          No misroutes recorded yet. Once you correct a routing mistake the evidence shows up here.
        </div>
      ` : ""}

      ${personal.length > 0 ? `
        <div class="section">
          <h3 class="section-title">
            Your personal vocabulary
            <span class="count">${personal.length} entries · only affects you</span>
          </h3>
          ${personal.map(renderPersonalEntry).join("")}
        </div>
      ` : ""}

      ${appliedSuggestions.length > 0 ? `
        <div class="section">
          <h3 class="section-title">
            Land-wide auto-applied vocabulary
            <span class="count">${appliedSuggestions.length} learned · affects everyone</span>
          </h3>
          ${appliedSuggestions.map(renderAppliedSuggestion).join("")}
        </div>
      ` : ""}

      ${pendingSuggestions.length > 0 ? `
        <div class="section">
          <h3 class="section-title">
            Pending suggestions
            <span class="count">${pendingSuggestions.length} below threshold</span>
          </h3>
          ${pendingSuggestions.map(renderPendingSuggestion).join("")}
        </div>
      ` : ""}

      ${log.length > 0 ? `
        <div class="section">
          <h3 class="section-title">
            Recent misroutes
            <span class="count">last ${Math.min(log.length, 50)}</span>
          </h3>
          ${log.slice(0, 50).map(renderLogEntry).join("")}
        </div>
      ` : ""}
    </div>
  `;

  const js = `
    async function clearAll() {
      if (!confirm("Wipe the misroute log and suggestions? This cannot be undone.")) return;
      try {
        const res = await fetch("/api/v1/misroute", {
          method: "DELETE",
          credentials: "include",
        });
        const data = await res.json();
        if (data.status === "ok") {
          showStatus("Cleared.", "success");
          setTimeout(function() { window.location.reload(); }, 800);
        } else {
          showStatus((data.error && data.error.message) || "Failed to clear.", "error");
        }
      } catch (err) {
        showStatus("Network error: " + err.message, "error");
      }
    }

    async function revertEntry(extension, bucket, pattern) {
      if (!confirm("Remove this learned word from " + extension + "? The suggestion will be reset and can re-promote if it triggers again.")) return;
      try {
        const res = await fetch("/api/v1/misroute/revert", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ extension: extension, bucket: bucket, pattern: pattern }),
        });
        const data = await res.json();
        if (data.status === "ok") {
          showStatus("Reverted. Routing index reloaded.", "success");
          setTimeout(function() { window.location.reload(); }, 800);
        } else {
          showStatus((data.error && data.error.message) || "Failed to revert.", "error");
        }
      } catch (err) {
        showStatus("Network error: " + err.message, "error");
      }
    }

    async function revertPersonal(extension, bucket, pattern) {
      if (!confirm("Remove this from your personal vocabulary for " + extension + "?")) return;
      try {
        const res = await fetch("/api/v1/misroute/personal/revert", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ extension: extension, bucket: bucket, pattern: pattern }),
        });
        const data = await res.json();
        if (data.status === "ok") {
          showStatus("Removed from your personal vocabulary.", "success");
          setTimeout(function() { window.location.reload(); }, 800);
        } else {
          showStatus((data.error && data.error.message) || "Failed to revert.", "error");
        }
      } catch (err) {
        showStatus("Network error: " + err.message, "error");
      }
    }

    function showStatus(msg, type) {
      var el = document.getElementById("statusMsg");
      el.textContent = msg;
      el.className = "status-msg " + type;
      setTimeout(function() { el.className = "status-msg"; }, 3000);
    }
  `;

  return page({ title: "Misroutes", css, body, js });
}
