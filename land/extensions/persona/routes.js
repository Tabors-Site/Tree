import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import Node from "../../seed/models/node.js";
import { getExtMeta, setExtMeta } from "../../seed/tree/extensionMetadata.js";
import { resolvePersonaFromChain, getAncestorChainFn } from "./index.js";

const router = express.Router();

const MAX_PERSONA_BYTES = 4096;
const VALID_FIELDS = new Set(["name", "voice", "traits", "boundaries", "greeting", "pronoun", "_inherit"]);

function validatePersona(persona) {
  if (!persona || typeof persona !== "object") return "Persona must be an object";
  const size = Buffer.byteLength(JSON.stringify(persona), "utf8");
  if (size > MAX_PERSONA_BYTES) return `Persona exceeds ${MAX_PERSONA_BYTES} byte limit (${size} bytes)`;
  if (persona.name && typeof persona.name !== "string") return "name must be a string";
  if (persona.name && persona.name.length > 100) return "name must be 100 characters or fewer";
  if (persona.voice && typeof persona.voice !== "string") return "voice must be a string";
  if (persona.voice && persona.voice.length > 2000) return "voice must be 2000 characters or fewer";
  if (persona.traits && !Array.isArray(persona.traits)) return "traits must be an array";
  if (persona.traits && persona.traits.length > 20) return "traits limited to 20 entries";
  if (persona.boundaries && !Array.isArray(persona.boundaries)) return "boundaries must be an array";
  if (persona.boundaries && persona.boundaries.length > 20) return "boundaries limited to 20 entries";
  if (persona.pronoun && typeof persona.pronoun !== "string") return "pronoun must be a string";
  if (persona.greeting !== undefined && persona.greeting !== null && typeof persona.greeting !== "string") return "greeting must be a string or null";
  return null;
}

// GET /persona?nodeId=X - show effective persona at position with inheritance source
router.get("/persona", authenticate, async (req, res) => {
  try {
    const nodeId = req.query.nodeId;
    if (!nodeId) return sendError(res, 400, ERR.INVALID_INPUT, "nodeId required");

    const getAncestorChain = getAncestorChainFn();
    if (!getAncestorChain) return sendError(res, 500, ERR.INTERNAL, "Ancestor cache not available");

    const chain = await getAncestorChain(nodeId);
    if (!chain) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Node not found");

    const persona = resolvePersonaFromChain(chain);
    if (!persona) return sendOk(res, { persona: null, source: null, message: "No persona defined at this position or any ancestor" });

    // Find the source node (nearest ancestor with metadata.persona)
    let sourceId = null;
    let sourceName = null;
    for (const ancestor of chain) {
      if (ancestor.systemRole) continue;
      if (ancestor.metadata?.persona) {
        sourceId = ancestor._id;
        sourceName = ancestor.name;
        break;
      }
    }

    sendOk(res, { persona, source: { nodeId: sourceId, name: sourceName } });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// POST /persona/set - set persona fields on the current node
// Body: { nodeId, field, value } or { nodeId, persona: { ...full object } }
router.post("/persona/set", authenticate, async (req, res) => {
  try {
    const { nodeId, field, value, persona: fullPersona } = req.body;
    if (!nodeId) return sendError(res, 400, ERR.INVALID_INPUT, "nodeId required");

    const node = await Node.findById(nodeId);
    if (!node) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Node not found");
    if (node.systemRole) return sendError(res, 403, ERR.FORBIDDEN, "Cannot set persona on system nodes");

    let current = getExtMeta(node, "persona") || {};

    if (fullPersona) {
      // Full replacement
      const err = validatePersona(fullPersona);
      if (err) return sendError(res, 400, ERR.INVALID_INPUT, err);
      current = fullPersona;
    } else if (field) {
      // Single field update
      if (!VALID_FIELDS.has(field)) return sendError(res, 400, ERR.INVALID_INPUT, `Unknown field: ${field}. Valid: ${[...VALID_FIELDS].join(", ")}`);
      if (value === null || value === undefined) {
        delete current[field];
      } else {
        current[field] = value;
      }
      const err = validatePersona(current);
      if (err) return sendError(res, 400, ERR.INVALID_INPUT, err);
    } else {
      return sendError(res, 400, ERR.INVALID_INPUT, "Provide field+value or persona object");
    }

    await setExtMeta(node, "persona", current);

    sendOk(res, { persona: current, nodeId });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// DELETE /persona?nodeId=X - remove persona at this node (inherit from parent)
router.delete("/persona", authenticate, async (req, res) => {
  try {
    const nodeId = req.query.nodeId || req.body?.nodeId;
    if (!nodeId) return sendError(res, 400, ERR.INVALID_INPUT, "nodeId required");

    const node = await Node.findById(nodeId);
    if (!node) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Node not found");

    const existing = getExtMeta(node, "persona");
    if (!existing) return sendOk(res, { message: "No persona to remove at this node" });

    await setExtMeta(node, "persona", null);
    sendOk(res, { message: "Persona removed. This node now inherits from its parent." });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// GET /persona/tree?rootId=X - show persona map across the tree
router.get("/persona/tree", authenticate, async (req, res) => {
  try {
    const rootId = req.query.rootId;
    if (!rootId) return sendError(res, 400, ERR.INVALID_INPUT, "rootId required");

    // Find all nodes in this tree that have a persona defined
    const nodes = await Node.find({ metadata: { $exists: true } })
      .select("_id name parent metadata")
      .lean();

    const personaNodes = [];
    for (const n of nodes) {
      const meta = n.metadata instanceof Map ? Object.fromEntries(n.metadata) : (n.metadata || {});
      if (meta.persona) {
        personaNodes.push({
          nodeId: String(n._id),
          name: n.name,
          persona: meta.persona,
        });
      }
    }

    sendOk(res, { count: personaNodes.length, nodes: personaNodes });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
