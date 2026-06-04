// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// pastFaceRender.js — turn an act-chain (inward) or a recalled set
// (half) into the past-face block the LLM reads alongside identity
// + capabilities + role-intent.
//
// INNER-FOLD §2:
//   inward — A_b alone, world drops out. Past-face shows every act
//            in act-order; the live world block is empty.
//   half   — world + recalled set. The forward face stays; the
//            past-face surfaces the braid-walked subset.
//
// Each past-act entry is rendered from its facadeSnapshot (the
// bounded record of the face the act was committed under). The
// renderer applies clampForRender so the LLM-budget caps land here,
// not at storage. Acts that pre-date the snapshot field render
// reduced (timestamp + in / out only) and the section is preceded
// by a banner so the LLM doesn't read the absence of role / at /
// capabilities as significance.
//
// This is the room a being walks into when it turns. Not just
// memory — a reasoning surface. An inward moment can seal inner
// acts (per spec §5: ΔF lands only on doer's own reel) and those
// inner acts join A_b. So future inward folds find both the
// reasoned-about past AND the reasoning. The chain stitches
// thinking the same way it stitches deeds.

import { clampForRender } from "../../beats/2-fold/facadeSnapshot.js";

const NULL_SECTION_BANNER =
  "(older acts; less context available — entries below predate facade capture)";

/**
 * Format the start / end message content into a single readable
 * line. Both shapes accept Mixed; stringify objects, trim strings,
 * fall back to the empty string on null.
 */
function formatMessage(msg) {
  if (msg == null) return "";
  if (typeof msg === "string") return msg.trim();
  if (typeof msg === "object") {
    if (typeof msg.content === "string") return msg.content.trim();
    try {
      return JSON.stringify(msg.content ?? msg);
    } catch {
      return "";
    }
  }
  return String(msg);
}

/**
 * Compact occupant list for a single entry. Empty list returns
 * "(nothing)". The trailing truncation sentinel from clampForRender
 * (or storage) becomes "+N more".
 */
function formatOccupants(occupants) {
  if (!Array.isArray(occupants) || occupants.length === 0) return "(nothing)";
  const parts = [];
  for (const o of occupants) {
    if (!o) continue;
    if (o.kind === "truncated") {
      parts.push(`+${o.count} more`);
      continue;
    }
    const label = o.name || o.id || "(?)";
    const kind = o.kind ? `${o.kind}:` : "";
    parts.push(`${kind}${label}`);
  }
  return parts.length > 0 ? parts.join(", ") : "(nothing)";
}

/**
 * Compact capability list for a single entry. Same truncation-
 * sentinel handling. Empty list collapses to "[]".
 */
function formatCapList(list) {
  if (!Array.isArray(list) || list.length === 0) return "[]";
  const parts = list.map(v => {
    if (v && typeof v === "object" && v.kind === "truncated") return `+${v.count} more`;
    return typeof v === "string" ? v : String(v ?? "");
  });
  return `[${parts.join(", ")}]`;
}

/**
 * Render one past-act entry. The clamp is applied before formatting
 * so the LLM never sees a 50KB occupant name. Null snapshots render
 * reduced (timestamp + in / out only) so legacy entries don't crash
 * and don't fabricate context.
 */
function renderEntry(index, row) {
  const snap = clampForRender(row?.facadeSnapshot);
  const stamp = row?.stampedAt ? new Date(row.stampedAt).toISOString() : "(no time)";
  const inLine = formatMessage(row?.startMessage);
  const outLine = formatMessage(row?.endMessage);

  if (!snap) {
    return [
      `[${index}] ${stamp}`,
      inLine  ? `  in:  ${inLine}`  : null,
      outLine ? `  out: ${outLine}` : null,
    ].filter(Boolean).join("\n");
  }

  const headerSuffix = snap.role ? `  role: ${snap.role}` : "";
  const where = snap.space?.name
    ? `at ${snap.space.name} with ${formatOccupants(snap.occupants)}`
    : null;
  const could = `do=${formatCapList(snap.capabilities?.canDo)}, summon=${formatCapList(snap.capabilities?.canSummon)}, be=${formatCapList(snap.capabilities?.canBe)}`;

  const lines = [`[${index}] ${stamp}${headerSuffix}`];
  if (where) lines.push(`  ${where}`);
  lines.push(`  could: ${could}`);
  if (inLine)  lines.push(`  in:  ${inLine}`);
  if (outLine) lines.push(`  out: ${outLine}`);
  return lines.join("\n");
}

/**
 * Render the inward past-face block. INNER-FOLD §2: the face is the
 * being's own line of deeds. The world drops out — this block is the
 * being's whole perceptual frame this moment, alongside identity +
 * capabilities + role-intent. The forward world block (preloaded
 * canSee descriptors) is omitted by llmMoment when ω=inward; this
 * block stands in its place.
 *
 * Acts arrive in act-order (oldest first) from loadActChain. We
 * keep that order so the numbered list reads chronologically.
 */
export function renderInwardPastFace(actChain) {
  const acts = Array.isArray(actChain) ? actChain : [];
  if (acts.length === 0) {
    return "[Inward fold]\nYour act-chain is empty. No prior acts to reflect on.";
  }

  const anyLegacy = acts.some(r => !r?.facadeSnapshot);
  const header = anyLegacy
    ? `[Inward fold]\nYour acts so far, in order:\n${NULL_SECTION_BANNER}`
    : "[Inward fold]\nYour acts so far, in order:";

  const entries = acts.map((row, i) => renderEntry(i + 1, row));
  return [header, ...entries].join("\n\n");
}

/**
 * Render the half past-face block. INNER-FOLD §2 / §3: the recalled
 * set is past acts that stitched a reel of an entity currently
 * present in the forward face. The half-turn shows the world AND
 * these surfaced acts; the forward world block stays where it is,
 * this block is appended alongside.
 *
 * Recalled entries arrive ranked by braid distance (most-recent
 * stitch first per the current implementation). The render groups
 * by stitched reel so the LLM can see WHY each surfaced.
 */
export function renderHalfPastFace(recalled) {
  const acts = Array.isArray(recalled) ? recalled : [];
  if (acts.length === 0) return "";

  const anyLegacy = acts.some(r => !r?.facadeSnapshot);

  const byReel = new Map();
  for (const row of acts) {
    const key = row?.stitchedReel
      ? `${row.stitchedReel.kind}:${row.stitchedReel.id}`
      : "(unknown)";
    if (!byReel.has(key)) byReel.set(key, []);
    byReel.get(key).push(row);
  }

  const sections = [];
  let index = 1;
  for (const [reelKey, rows] of byReel) {
    sections.push(`Acts that touched ${reelKey}:`);
    for (const row of rows) {
      sections.push(renderEntry(index++, row));
    }
  }

  const header = anyLegacy
    ? `[Half fold — past acts surfacing from the braid]\n${NULL_SECTION_BANNER}`
    : "[Half fold — past acts surfacing from the braid]";

  return [header, ...sections].join("\n\n");
}
