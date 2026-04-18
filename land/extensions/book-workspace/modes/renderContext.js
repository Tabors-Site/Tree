/**
 * Render enrichedContext keys into the system prompt block. Same pattern
 * as code-workspace/modes/renderContext.js — each populated key gets a
 * labeled section. Order puts contracts first (wire protocol of the
 * book: characters, voice, tone), then position, then siblings.
 */
export default function renderEnrichedContextBlock(enriched) {
  if (!enriched || typeof enriched !== "object") return "";
  const sections = [];

  // Incoming premise from the intake drone goes FIRST — the architect
  // should see this before anything else. It's the distilled version of
  // the user's raw input (URLs fetched, long text summarized, ambiguity
  // surfaced as open-questions). Honor it, don't re-do its work.
  if (enriched.incomingPremise) {
    sections.push(
      `## Distilled Premise (from intake drone)\n\n` +
      `The intake drone fetched / read / distilled the user's raw input ` +
      `and produced the premise below. Treat it as your starting point. ` +
      `Extend with concrete decisions the drone deferred to you (open-questions), ` +
      `but do NOT contradict its distillation — the drone fetched the actual ` +
      `source material; you did not.\n\n` +
      enriched.incomingPremise,
    );
  }

  if (Array.isArray(enriched.declaredContracts) && enriched.declaredContracts.length > 0) {
    const lines = ["## Declared Contracts (shared invariants across chapters)"];
    const byKind = new Map();
    for (const c of enriched.declaredContracts) {
      const list = byKind.get(c.kind) || [];
      list.push(c);
      byKind.set(c.kind, list);
    }
    for (const [kind, items] of byKind) {
      lines.push("");
      lines.push(`${kind}:`);
      for (const c of items) {
        // Characters get their pronouns pulled out front so the model
        // can't miss them. Pronoun drift was the chapter-4 bug.
        if (kind === "character" && c.pronouns) {
          const rest = (c.fields || []).filter((f) => f !== c.pronouns);
          const restStr = rest.length > 0 ? ` — ${rest.join(", ")}` : "";
          lines.push(`  - ${c.name} (pronouns: ${c.pronouns})${restStr}`);
        } else {
          const fieldList = c.fields?.length ? ` { ${c.fields.join(", ")} }` : "";
          lines.push(`  - ${c.name}${fieldList}`);
        }
      }
    }
    sections.push(lines.join("\n"));
  }

  if (enriched.bookPosition) {
    sections.push(`## Your Position\n${enriched.bookPosition}`);
  }

  if (enriched.bookTOC) {
    sections.push(`## Table of Contents\n${enriched.bookTOC}`);
  }

  if (Array.isArray(enriched.priorChapters) && enriched.priorChapters.length > 0) {
    sections.push(renderPriorChapters(enriched.priorChapters));
  }

  if (Array.isArray(enriched.upcomingChapters) && enriched.upcomingChapters.length > 0) {
    sections.push(renderUpcomingChapters(enriched.upcomingChapters));
  }

  if (Array.isArray(enriched.siblingBranches) && enriched.siblingBranches.length > 0 &&
      !Array.isArray(enriched.priorChapters)) {
    // Fallback: legacy sibling render when the new TOC-aware lists aren't populated.
    sections.push(renderSiblingChapters(enriched.siblingBranches));
  }

  if (enriched.consistencyFlags) {
    sections.push(`## Consistency Flags from Prior Review\n${enriched.consistencyFlags}`);
  }

  if (sections.length === 0) return "";
  return `=================================================================
CONTEXT FOR THIS TURN
=================================================================

${sections.join("\n\n")}`;
}

/**
 * Render prior chapters with recency-weighted fidelity. Immediate prior
 * gets full prose (truncated to 3000 chars). Near-prior chapters get a
 * first-paragraph excerpt. Far-prior chapters get a one-line summary.
 *
 * This is the sliding-window pattern: the further back a chapter is,
 * the less of it you need. You always see the chapter that ended where
 * you're about to start in full, so continuity is possible.
 */
function renderPriorChapters(prior) {
  const lines = ["## Prior Chapters (what's been established — READ before writing)"];
  lines.push("");
  for (const ch of prior) {
    const icon = ch.status === "done" ? "✓" : ch.status === "failed" ? "✗" : "⏳";
    lines.push(`### ${icon} ${ch.name}`);
    if (ch.spec) lines.push(`*Spec:* ${truncate(ch.spec, 220)}`);
    if (ch.summary) lines.push(`*Summary:* ${truncate(ch.summary, 220)}`);

    const files = (ch.nodes || []).filter((n) => Array.isArray(n.notes) && n.notes.length > 0);
    if (files.length > 0) {
      const proseText = files
        .map((f) => (f.notes || []).map((n) => n.content || "").join("\n\n"))
        .join("\n\n")
        .trim();
      if (ch.recency === "immediate") {
        lines.push("");
        lines.push("*Prose (FULL — this chapter ended where yours begins):*");
        lines.push(truncate(proseText, 3000));
      } else if (ch.recency === "near") {
        const firstPara = proseText.split(/\n\n/)[0] || proseText;
        lines.push("");
        lines.push("*Opens with:*");
        lines.push(truncate(firstPara, 600));
      } else {
        const opener = firstSentence(proseText);
        if (opener) lines.push(`*Opens:* "${truncate(opener, 180)}"`);
      }
    } else {
      lines.push("(no prose written — branch may have failed; do NOT assume what it would have said)");
    }
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Render upcoming chapters as spec-only — the writer needs to know what
 * comes next so it doesn't foreshadow past its scope or write a plot
 * beat that belongs to a later chapter. But no prose to read, since
 * those chapters don't exist yet.
 */
function renderUpcomingChapters(upcoming) {
  const lines = ["## Upcoming Chapters (what comes AFTER yours — do NOT resolve their plot beats)"];
  lines.push("");
  for (const ch of upcoming) {
    lines.push(`⏳ ${ch.name}`);
    if (ch.spec) lines.push(`   ${truncate(ch.spec, 240)}`);
  }
  lines.push("");
  lines.push("Your chapter ends when its own arc lands. Leave threads for the chapters above to pick up.");
  return lines.join("\n");
}

/**
 * Legacy sibling render (used as fallback when TOC isn't populated —
 * e.g. at the project root or before the book is initialized).
 */
function renderSiblingChapters(siblings) {
  const lines = ["## Other Chapters (read-only summaries)"];
  lines.push("");
  for (const sib of siblings) {
    const icon =
      sib.status === "done" ? "✓" :
      sib.status === "failed" ? "✗" :
      sib.status === "running" ? "🟡" : "⏳";
    lines.push(`### ${icon} ${sib.name}  [${sib.status}]`);
    if (sib.spec) lines.push(`Premise: ${truncate(sib.spec, 280)}`);
    if (sib.summary) lines.push(`Summary: ${truncate(sib.summary, 280)}`);

    const files = (sib.nodes || []).filter((n) => Array.isArray(n.notes) && n.notes.length > 0);
    if (files.length > 0) {
      // Grab the first note on the sibling root as the "opening".
      const root = files.find((f) => f.path === "" || f.path == null);
      if (root?.notes?.length > 0) {
        const opener = firstSentence(root.notes[0].content);
        if (opener) lines.push(`Opens with: "${truncate(opener, 200)}"`);
      }
      if (files.length > 1) {
        lines.push(`Has ${files.length} nodes (scenes / sections).`);
      }
    } else {
      lines.push("(not yet drafted)");
    }
    lines.push("");
  }
  return lines.join("\n");
}

function firstSentence(text) {
  if (!text) return null;
  const trimmed = String(text).trim();
  // Find first sentence ending, prefer ones that come after a quote or paragraph
  const match = trimmed.match(/^([^.!?]*[.!?])/);
  if (match) return match[1].trim();
  return trimmed.slice(0, 200);
}

function truncate(s, n) {
  const str = String(s || "");
  return str.length > n ? str.slice(0, n - 1) + "…" : str;
}
