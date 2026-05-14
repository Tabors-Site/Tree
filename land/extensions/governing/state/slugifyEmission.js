// slugifyEmission. Turn an emission's reasoning headline (or any short
// text) into a kebab-case slug suitable for a node name. Drops common
// stopwords, takes the first 4-6 meaningful words, and lowercases.
//
// Why slugs instead of "emission-N":
//   - Walking the tree page-by-page tells you what each emission is
//     about without expanding it.
//   - The numeric ordinal stays in metadata.governing.ordinal for
//     ordering; the visible node name is descriptive.
//   - No new LLM call needed; the data already exists in the
//     reasoning field the role just produced.
//
// Examples:
//   "Decomposed by client/server domain split"
//     → "client-server-domain-split"
//   "Single React component with canvas, toolbar, and core drawing features"
//     → "single-react-component-canvas-toolbar"
//   "Identified shared vocabulary for game canvas events"
//     → "shared-vocabulary-game-canvas-events"
//
// Falls back to "emission-${ordinal}" when reasoning is empty or
// produces no usable words after filtering.

const STOPWORDS = new Set([
  // articles, prepositions, conjunctions
  "a", "an", "the", "and", "or", "but", "of", "in", "on", "at", "to",
  "for", "with", "by", "from", "as", "into", "onto", "upon", "than",
  "that", "this", "these", "those", "it", "its", "is", "are", "was",
  "were", "be", "been", "being", "have", "has", "had", "do", "does",
  "did", "will", "would", "should", "could", "may", "might", "must",
  // generic verbs that don't add identifying meaning
  "decomposed", "decomposing", "split", "splits", "splitting",
  "identified", "identifying", "drafted", "drafting", "created",
  "creating", "produces", "producing", "uses", "using", "via",
  // generic project nouns that appear too often to discriminate
  "plan", "contracts", "contract", "execution", "run", "runs",
  "project", "step", "steps", "scope",
]);

const MIN_WORDS = 3;
const MAX_WORDS = 6;
const MAX_LENGTH = 60;

/**
 * Slugify an emission reasoning headline. Returns a kebab-case string
 * of 3-6 meaningful words, capped at 60 chars. Falls back to
 * "emission-${ordinal}" when input is unusable.
 */
export function slugifyEmission(reasoning, ordinal) {
  const fallback = `emission-${ordinal != null ? ordinal : "1"}`;
  if (typeof reasoning !== "string" || !reasoning.trim()) return fallback;

  // Take the first sentence/clause. The full reasoning paragraph is
  // too long to slugify; the first sentence is the headline by
  // convention.
  const headline = reasoning.split(/[.!?\n]/)[0] || reasoning;

  // Tokenize to lowercase alphanumerics. Slashes become spaces so
  // "client/server" yields two tokens. Underscores/hyphens treated
  // as word separators inside CamelCase compounds.
  const tokens = headline
    .toLowerCase()
    .replace(/[/_\-]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  // Drop stopwords and very short tokens (single chars, pure numbers
  // alone). Keep tokens of length >= 2.
  const meaningful = tokens.filter((t) => {
    if (STOPWORDS.has(t)) return false;
    if (t.length < 2) return false;
    return true;
  });

  if (meaningful.length < MIN_WORDS) return fallback;

  const slug = meaningful.slice(0, MAX_WORDS).join("-").slice(0, MAX_LENGTH);
  // Trim trailing dash if a slice landed mid-word.
  return slug.replace(/-+$/, "") || fallback;
}
