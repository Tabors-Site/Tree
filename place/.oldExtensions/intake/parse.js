// Parse [[PREMISE]]...[[/PREMISE]] blocks from intake responses.
//
// The intake mode emits a structured premise block that the next-stage
// architect consumes verbatim. Block shape (loose — intake can add
// fields as the domain requires, architect only consumes what it
// recognizes):
//
//   [[PREMISE]]
//   title: short working title
//   genre: one or two words
//   structure: short-story | novella | novel | epic | code-project | research-paper | ...
//   summary: one-paragraph premise in natural language
//   protagonist: Name (pronouns) — description
//   antagonist: Name (pronouns) — description
//   setting: where, when, constraints
//   voice: POV + tense + register
//   themes: comma-separated
//   sources: URLs and files that were fetched
//   [[/PREMISE]]
//
// Each domain's architect mode knows how to turn these lines into its
// own contract shape. book-plan maps protagonist + antagonist → two
// character contracts. code-plan ignores most of these and uses
// summary + structure to decide decomposition.

const PREMISE_OPEN = /\[\[\s*premise\s*\]\]/i;
const PREMISE_CLOSE_TIGHT = /\[\[\s*\]?\s*\/\s*premise\s*\]\]/i;
const PREMISE_CLOSE_LOOSE = /\[\[[^\[\]]*(\/|end)[^\[\]]*premise[^\[\]]*\]\]/i;

/**
 * Parse a [[PREMISE]] block. Returns { premise, fields, raw, cleaned }.
 *   premise  — the raw block body (string)
 *   fields   — parsed key/value map of known lines
 *   raw      — the full block with markers
 *   cleaned  — response text with the block removed
 *
 * If no block is found: { premise: null, fields: {}, raw: null, cleaned: responseText }.
 *
 * Same tight/loose/line-based closer detection the swarm parsers use
 * so malformed closers from small models still get caught.
 */
export function parsePremise(responseText) {
  if (typeof responseText !== "string" || !responseText) {
    return { premise: null, fields: {}, raw: null, cleaned: responseText };
  }
  const openMatch = responseText.match(PREMISE_OPEN);
  if (!openMatch) {
    return { premise: null, fields: {}, raw: null, cleaned: responseText };
  }

  const openEnd = openMatch.index + openMatch[0].length;
  const rest = responseText.slice(openEnd);

  let closeMatch = rest.match(PREMISE_CLOSE_TIGHT);
  let closeIdxInRest = closeMatch?.index;
  let closeLength = closeMatch?.[0]?.length || 0;

  if (closeIdxInRest == null) {
    closeMatch = rest.match(PREMISE_CLOSE_LOOSE);
    closeIdxInRest = closeMatch?.index;
    closeLength = closeMatch?.[0]?.length || 0;
  }

  if (closeIdxInRest == null) {
    const lines = rest.split("\n");
    let lastBracketLineIdx = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (/^\s*\[\[/.test(lines[i])) {
        lastBracketLineIdx = i;
        break;
      }
    }
    if (lastBracketLineIdx > 0) {
      const upToThatLine = lines.slice(0, lastBracketLineIdx).join("\n");
      closeIdxInRest = upToThatLine.length + 1;
      closeLength = (lines[lastBracketLineIdx] || "").length;
    }
  }

  if (closeIdxInRest == null) {
    // Unclosed block. Treat as absent rather than guessing where it ended.
    return { premise: null, fields: {}, raw: null, cleaned: responseText };
  }

  const body = rest.slice(0, closeIdxInRest).trim();
  const fields = parsePremiseFields(body);

  const openStart = openMatch.index;
  const closeEnd = openEnd + closeIdxInRest + closeLength;
  const raw = responseText.slice(openStart, closeEnd);
  const cleaned = (responseText.slice(0, openStart) + responseText.slice(closeEnd)).trimEnd();

  return { premise: body, fields, raw, cleaned };
}

/**
 * Parse the key/value lines inside a premise block. Multi-line values
 * are joined. Repeated keys (protagonist: ..., protagonist: ...) get
 * collected as arrays.
 */
function parsePremiseFields(body) {
  const fields = {};
  const lines = body.split("\n");
  let currentKey = null;
  let currentLines = [];

  const flush = () => {
    if (!currentKey) return;
    const value = currentLines.join(" ").trim();
    if (value) {
      const existing = fields[currentKey];
      if (existing == null) fields[currentKey] = value;
      else if (Array.isArray(existing)) existing.push(value);
      else fields[currentKey] = [existing, value];
    }
    currentKey = null;
    currentLines = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    if (line.startsWith("#") || line.startsWith("//")) continue;
    const kvMatch = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/);
    if (kvMatch) {
      flush();
      currentKey = kvMatch[1].toLowerCase();
      if (kvMatch[2]) currentLines.push(kvMatch[2]);
    } else if (currentKey) {
      currentLines.push(line);
    }
  }
  flush();
  return fields;
}
