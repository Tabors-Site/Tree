// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// innerFaceFormat.js . LLM-side presentation of the canonical inner
// face. Pure formatter . takes ctx.innerFace and renders the canSee
// blocks into the prompt prose the LLM expects.
//
// Per philosophy/names/innerFace.md: per-soul reformatting is allowed
// at the presentation layer. The 2-fold beat builds the canonical face
// once (orientation + role + position + capabilities + blocks); this
// file turns the blocks into the [<label>]\n<JSON> shape the existing
// prompt builder feeds the model.
//
// String payloads pass through verbatim (a SEE resolver that framed
// its own block keeps that framing). Object payloads JSON-pretty-
// print under the block's label header. Empty / null faces and empty
// blocks lists return "".

/**
 * Format an inner face's blocks into the LLM prompt's perception
 * section. Pure function.
 *
 * @param {object|null} innerFace . the canonical face built by
 *   buildInnerFace (or null when no face is on hand).
 * @returns {string} the rendered block, or "" when nothing to render.
 */
export function formatInnerFaceBlocksForPrompt(innerFace) {
  if (!innerFace || !Array.isArray(innerFace.blocks) || innerFace.blocks.length === 0) {
    return "";
  }
  const out = [];
  for (const block of innerFace.blocks) {
    if (!block || block.kind === "truncated") continue;
    const rendered = renderBlock(block);
    if (rendered) out.push(rendered);
  }
  return out.join("\n\n");
}

function renderBlock(block) {
  const label = block.label || block.key || "(block)";
  const payload = block.payload;
  if (payload == null) return null;
  if (typeof payload === "string") {
    return payload.length > 0 ? payload : null;
  }
  try {
    return `[${label}]\n${JSON.stringify(payload, null, 2)}`;
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────
// Word-native face render (14.md §1 + §4 step 1, the face half)
// ────────────────────────────────────────────────────────────────────
//
// The being's face — the canSee blocks folded from the being/space/matter reels at its position
// (Tabor: "the words loaded = its role + whatever's in the reels at where it is") — rendered as
// WORD, present tense, not the [label]\n{JSON} shape. String payloads pass through verbatim (a SEE
// resolver that already framed its own Word); object payloads render as readable present-tense
// lines. The richer book-weave (assembleStory's past-tense recall) is the follow-on; this is the
// forward-SEE face as Word — the half that pairs with renderVocabularyAsWord (the role's words).

export function formatInnerFaceBlocksAsWord(innerFace) {
  if (!innerFace || !Array.isArray(innerFace.blocks) || innerFace.blocks.length === 0) return "";
  const out = [];
  for (const block of innerFace.blocks) {
    if (!block || block.kind === "truncated") continue;
    const w = blockToWord(block);
    if (w) out.push(w);
  }
  return out.join("\n\n");
}

function blockToWord(block) {
  const label = block.label || block.key || "the face";
  const p = block.payload;
  if (p == null) return null;
  if (typeof p === "string") return p.length > 0 ? p : null; // already Word
  const lines = wordLines(p, 1);
  return lines.length ? `${label}:\n${lines.join("\n")}` : null;
}

function wordLines(obj, depth) {
  const pad = "  ".repeat(depth);
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v == null || v === "") continue;
    if (Array.isArray(v)) {
      if (v.length === 0) continue;
      if (v.every((e) => e == null || typeof e !== "object")) {
        out.push(`${pad}${k}: ${v.filter((e) => e != null).map(String).join(", ")}`);
      } else {
        out.push(`${pad}${k}:`);
        for (const e of v) out.push(`${pad}  - ${compactObj(e)}`);
      }
    } else if (typeof v === "object") {
      out.push(`${pad}${k}:`);
      out.push(...wordLines(v, depth + 1));
    } else {
      out.push(`${pad}${k}: ${v}`);
    }
  }
  return out;
}

function compactObj(e) {
  if (e == null) return "";
  if (typeof e !== "object") return String(e);
  return Object.entries(e)
    .filter(([, v]) => v != null && typeof v !== "object")
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
}
