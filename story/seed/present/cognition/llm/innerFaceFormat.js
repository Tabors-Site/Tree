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
