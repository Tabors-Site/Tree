import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import { findDestination, listPositions } from "./core.js";

const router = express.Router();

// Format a destination for human display: "<path> [<id>] · <extension>"
// with a cd hint. Works for both single-match and ambiguous-list cases.
function shortId(id) { return id ? String(id).slice(0, 8) : "?"; }
function formatDest(d) {
  if (!d) return "";
  const tag = d.extension ? ` · ${d.extension}` : "";
  return `${d.path || d.name || "?"}  [${shortId(d.nodeId)}]${tag}`;
}
function buildAnswer(result) {
  if (!result) return null;
  if (result.found === false) {
    return `No match for "${result.query}". Try: go (no args) to list positions.`;
  }
  if (result.ambiguous && Array.isArray(result.options) && result.options.length > 0) {
    const rows = result.options.map((o) => "  " + formatDest(o)).join("\n");
    const tail = `\nUse: cd -r <name>  or  cd <id>  to pick one.`;
    return `Multiple matches:\n${rows}${tail}`;
  }
  if (result.destination) {
    const d = result.destination;
    const bare = d.name && d.path
      ? (d.path.split("/").pop() || d.name)
      : (d.name || "");
    const hint = bare ? `Use: cd -r ${bare}  or  cd ${d.nodeId}` : `Use: cd ${d.nodeId}`;
    return `→ ${formatDest(d)}\n${hint}`;
  }
  // Fallback: list-positions shape { trees: [...], extensions: [...] }
  return null;
}

router.get("/go", authenticate, async (req, res) => {
  try {
    const query = req.query.q || req.query.destination || "";
    const result = query.trim()
      ? await findDestination(query, req.userId)
      : await listPositions(req.userId);

    // Attach a pre-formatted `answer` string so the CLI's generic
    // response printer renders a clean, ID-bearing hint instead of
    // dumping the raw destination/options JSON. The underlying
    // nodeId/path/extension fields stay on the object for any
    // programmatic caller.
    if (result && typeof result === "object" && !Array.isArray(result)) {
      const answer = buildAnswer(result);
      if (answer) result.answer = answer;
    }

    sendOk(res, result);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
