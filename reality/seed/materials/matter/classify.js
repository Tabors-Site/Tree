// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// classify.js — "what matter type will this become?"
//
// The place flow takes anything (a file, a URL, bare text) and the
// story answers with a TYPE before anything is saved. Registry-
// driven: every type's `claims` block advertises what it claims
// (mime patterns, file extensions, url patterns, schemes), so
// extension types participate in classification the moment they
// register — no portal changes, no special wiring. The seed floor
// catches what nothing claims: an http link is website content
// (http), an IBP address is a doorway (ibpa), a .glb is a model,
// unknown bytes are a file, bare text is generic.
//
// Two consumers, one function:
//   - createMatterHandler runs classifyMatter when the caller omits
//     `type` — "it just becomes whatever was uploaded." The server
//     stays authoritative; contentKinds/mime enforcement still gates
//     a lying client.
//   - the `classify-matter` SEE op (registered below) exposes the
//     same answer over the wire. Classification is a pure read; SEE
//     is the verb that never stamps facts. Portals also classify
//     locally from discovery's matterTypes catalog (zero round-trips
//     per keystroke) using this same scoring table — keep the
//     constants in sync with portal/flat/matter-composer.js.
//
// Scoring (highest candidate wins; per-type claims.priority is a
// flat bump for tiebreaks and opt-in overrides):
//   mime exact        100
//   extension          90
//   mime wildcard      80   ("image/*"; "*/*" matches any mime)
//   url pattern        70   (substring of host+path)
//   scheme             60
//   text base          20   (types whose contentKinds include text,
//                            when the input is bare text — extensions
//                            outrank the generic floor by declaring
//                            claims.priority > 30)
//   seed floor         50   (url→http, ibpa→ibpa, model ext/mime→
//                            model, binary mime→file, text→generic)

import { listMatterTypes, getMatterType } from "./types.js";

const SCORE = Object.freeze({
  MIME_EXACT: 100,
  EXTENSION: 90,
  MIME_WILDCARD: 80,
  URL_PATTERN: 70,
  SCHEME: 60,
  FLOOR: 50,
  TEXT_BASE: 20,
});

function bareMime(mimeType) {
  if (typeof mimeType !== "string" || !mimeType.length) return null;
  return mimeType.split(";")[0].trim().toLowerCase() || null;
}

function extOf(fileName) {
  if (typeof fileName !== "string") return null;
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0 || dot === fileName.length - 1) return null;
  return fileName.slice(dot).toLowerCase();
}

function parseUrl(url) {
  if (typeof url !== "string" || !url.length) return null;
  const m = url.match(/^([a-z][a-z0-9+.-]*):\/\/(.+)$/i);
  if (!m) return null;
  return { scheme: m[1].toLowerCase(), rest: m[2].toLowerCase() };
}

// IBPA shape — a doorway address. Kept in sync with IBPA_RE in
// materials/portalOp.js (form-portal's validator). url and ibpa are
// completely different reference worlds with their own input fields;
// this regex only validates the ibpa field's shape.
const IBPA_SHAPE_RE = /^(?:[a-zA-Z0-9.\-_]+(?:#[^/]+)?|#[^/]+)\/.*$/;

function mimeMatches(pattern, mime) {
  if (!pattern || !mime) return null;
  if (pattern === mime) return "exact";
  if (pattern === "*/*") return "wildcard";
  if (pattern.endsWith("/*") && mime.startsWith(pattern.slice(0, -1))) return "wildcard";
  return null;
}

/**
 * Classify an input into ranked matter-type candidates.
 *
 * `url` and `ibpa` are DIFFERENT reference worlds, not two spellings
 * of one field: a url is an HTTP link into the WWW (http matter —
 * website content, renders/embeds); an ibpa is an IBP address into
 * another story / branch / position (ibpa matter — a doorway the
 * four verbs go through, never an iframe).
 *
 * @param {object} input
 * @param {string} [input.text]      bare text content (a context chunk)
 * @param {string} [input.url]       an HTTP link (the WWW)
 * @param {string} [input.ibpa]      an IBP address (another world)
 * @param {string} [input.mimeType]  the file's mime, if known
 * @param {string} [input.fileName]  the file's name (extension matters)
 * @param {number} [input.size]      bytes (unused in scoring today)
 * @returns {Array<{type: string, score: number, reason: string}>}
 *   sorted best-first; empty only when the input itself is empty
 */
export function classifyMatter(input = {}) {
  const mime = bareMime(input?.mimeType);
  const ext = extOf(input?.fileName);
  const rawUrl = typeof input?.url === "string" ? input.url.trim() : null;
  const parsedUrl = parseUrl(rawUrl);
  const rawIbpa = typeof input?.ibpa === "string" ? input.ibpa.trim() : null;
  const hasText = typeof input?.text === "string" && input.text.length > 0;
  const hasFileSignal = !!(mime || ext);

  if (!mime && !ext && !rawUrl && !rawIbpa && !hasText) return [];

  const candidates = new Map(); // type → {score, reason}
  const propose = (type, score, reason) => {
    const cur = candidates.get(type);
    if (!cur || score > cur.score) candidates.set(type, { score, reason });
  };

  for (const def of listMatterTypes()) {
    const c = def.claims;
    const prio = c?.priority || 0;
    if (c) {
      if (mime && c.mimeTypes) {
        for (const pattern of c.mimeTypes) {
          const kind = mimeMatches(pattern, mime);
          if (kind === "exact") propose(def.name, SCORE.MIME_EXACT + prio, `mime ${mime}`);
          else if (kind === "wildcard") propose(def.name, SCORE.MIME_WILDCARD + prio, `mime ${pattern}`);
        }
      }
      if (ext && c.extensions?.includes(ext)) {
        propose(def.name, SCORE.EXTENSION + prio, `extension ${ext}`);
      }
      if (parsedUrl && c.urlPatterns) {
        for (const pattern of c.urlPatterns) {
          if (pattern && parsedUrl.rest.includes(pattern)) {
            propose(def.name, SCORE.URL_PATTERN + prio, `url matches "${pattern}"`);
          }
        }
      }
      if (parsedUrl && c.schemes?.includes(parsedUrl.scheme)) {
        propose(def.name, SCORE.SCHEME + prio, `scheme ${parsedUrl.scheme}`);
      }
    }
    // Bare text: every text-capable type is a candidate at a low
    // base, so extensions can opt in above the generic floor with
    // claims.priority.
    if (hasText && !hasFileSignal && !rawUrl && !rawIbpa && def.contentKinds.includes("text")) {
      propose(def.name, SCORE.TEXT_BASE + prio, "accepts text");
    }
  }

  // Seed floor — what nothing claims still becomes something. The
  // url and ibpa fields each DECLARE their reference world (the WWW
  // vs other realities); the field decides the floor, not string
  // sniffing.
  if (rawUrl && getMatterType("http")) {
    propose("http", SCORE.FLOOR, "an http link — website content");
  }
  if (rawIbpa && IBPA_SHAPE_RE.test(rawIbpa) && getMatterType("ibpa")) {
    propose("ibpa", SCORE.FLOOR, "an IBP address — a doorway to another world");
  }
  if ((ext === ".glb" || ext === ".gltf" || mime === "model/gltf-binary" || mime === "model/gltf+json")
      && getMatterType("model")) {
    propose("model", SCORE.FLOOR, "a 3D model");
  }
  if (hasFileSignal && !rawUrl && !rawIbpa && getMatterType("file")) {
    propose("file", SCORE.FLOOR - 1, "bytes of a file");
  }
  if (hasText && !hasFileSignal && !rawUrl && !rawIbpa && getMatterType("generic")) {
    propose("generic", SCORE.FLOOR, "bare text — a context chunk");
  }

  return [...candidates.entries()]
    .map(([type, { score, reason }]) => ({ type, score, reason }))
    .sort((a, b) => b.score - a.score || a.type.localeCompare(b.type));
}

/**
 * The type catalog as discovery ships it — everything a composer
 * needs to classify locally and render a type picker. Claims ride
 * along so the portal's local ranker uses the SAME data this module
 * scores against.
 */
export function serializeTypeCatalog() {
  return listMatterTypes().map((def) => ({
    name:         def.name,
    description:  def.description,
    contentKinds: [...def.contentKinds],
    mimeTypes:    def.mimeTypes ? [...def.mimeTypes] : null,
    ops:          [...def.ops],
    render:       def.render ? { ...def.render } : null,
    claims:       def.claims
      ? {
          mimeTypes:   def.claims.mimeTypes ? [...def.claims.mimeTypes] : null,
          extensions:  def.claims.extensions ? [...def.claims.extensions] : null,
          urlPatterns: def.claims.urlPatterns ? [...def.claims.urlPatterns] : null,
          schemes:     def.claims.schemes ? [...def.claims.schemes] : null,
          priority:    def.claims.priority,
        }
      : null,
    ownerExtension: def.ownerExtension,
  }));
}

// ── classify-matter as a SEE op ─────────────────────────────────────
// The wire-facing form of the same pure read. CLI / LLM / extension
// callers ask "what would this become?" without the discovery catalog.
import { registerSeeOperation } from "../../ibp/seeOps.js";

registerSeeOperation("classify-matter", {
  description: "Rank which matter type an input (file mime/name, http url, IBP address, or bare text) would become.",
  args: {
    mimeType: { type: "text", label: "Mime type (file inputs)", required: false },
    fileName: { type: "text", label: "File name (extension matters)", required: false },
    url:      { type: "text", label: "HTTP link (the WWW)", required: false },
    ibpa:     { type: "text", label: "IBP address (another story/branch/position)", required: false },
    text:     { type: "text", label: "Bare text", required: false },
  },
  handler: async ({ args }) => ({ candidates: classifyMatter(args || {}) }),
});
