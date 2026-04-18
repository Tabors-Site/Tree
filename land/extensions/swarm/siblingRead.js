// Read-only sibling branch access.
//
// Branches in a swarm run in isolated sessions — each has its own tree
// position and its own context. Without a way to see siblings, each
// branch's AI builds blind to the others and hallucinates interfaces.
// The PolyPong-class bug: frontend assumes a backend API shape that
// never existed.
//
// This primitive lets a branch read its siblings' state and content
// without breaking isolation. Sibling data comes back as a read-only
// snapshot. Domain extensions decide how to render it:
//   - code-workspace → file tree + file contents + exported surface
//   - book-workspace → chapter summaries + prose excerpts
//   - research-workspace → section abstracts + citations
//
// Swarm returns the raw shape; the caller shapes it for its domain.

import Node from "../../seed/models/node.js";
import log from "../../seed/log.js";
import { readMeta } from "./state/meta.js";

const MAX_NOTES_PER_NODE = 20;
const MAX_NOTE_CONTENT = 4000; // chars; truncated for token efficiency
const MAX_DESCENDANTS_PER_SIBLING = 60;

/**
 * Read every sibling branch of `branchNodeId` — the other direct
 * children of the same parent that carry role=branch. Returns a flat
 * array; each entry has the sibling's metadata + a walk of its
 * descendants with note contents.
 *
 * Params:
 *   branchNodeId      — the calling branch's node id
 *   options.includeNotes  — if false, skip note content and return only structure (default true)
 *   options.maxNoteLength — cap per-note content length (default 4000)
 *   options.maxDescendants — cap descendants per sibling (default 60)
 *
 * Returns:
 *   [{
 *     nodeId, name, role, spec, path, status, summary, mode,
 *     nodes: [
 *       { nodeId, name, path, notes: [{ content, type, createdAt }] },
 *       ...
 *     ]
 *   }]
 */
export async function readSiblingBranches(branchNodeId, options = {}) {
  if (!branchNodeId) return [];
  const {
    includeNotes = true,
    maxNoteLength = MAX_NOTE_CONTENT,
    maxDescendants = MAX_DESCENDANTS_PER_SIBLING,
  } = options;

  try {
    const self = await Node.findById(branchNodeId).select("_id parent name").lean();
    if (!self?.parent) return [];

    const parent = await Node.findById(self.parent).select("_id children").lean();
    if (!parent?.children?.length) return [];

    const siblingIds = parent.children
      .map((id) => String(id))
      .filter((id) => id !== String(self._id));
    if (siblingIds.length === 0) return [];

    const siblings = await Node.find({ _id: { $in: siblingIds } })
      .select("_id name metadata").lean();

    const out = [];
    for (const sib of siblings) {
      const meta = readMeta(sib);
      if (meta?.role !== "branch") continue;

      const descendants = await walkDescendants(sib._id, {
        includeNotes, maxNoteLength, maxDescendants,
      });

      out.push({
        nodeId: String(sib._id),
        name: sib.name,
        role: meta.role,
        spec: meta.spec || meta.systemSpec || null,
        path: meta.path || null,
        status: meta.status || "pending",
        summary: meta.summary || null,
        mode: meta.mode || null,
        branchName: meta.branchName || sib.name,
        files: Array.isArray(meta.files) ? meta.files : [],
        nodes: descendants,
      });
    }
    return out;
  } catch (err) {
    log.warn("Swarm", `readSiblingBranches ${branchNodeId} failed: ${err.message}`);
    return [];
  }
}

/**
 * Read one specific descendant of a sibling branch, identified by path
 * relative to the sibling's root. Used by on-demand peek tools where
 * the AI decides it needs the full content of a specific file rather
 * than the truncated snapshot enrichContext provided.
 *
 * Params:
 *   branchNodeId — the calling branch
 *   siblingName  — which sibling to read from (matches by name)
 *   relPath      — path relative to the sibling branch root
 *
 * Returns: { nodeId, name, path, notes: [...] } or null.
 */
export async function readSiblingNode(branchNodeId, siblingName, relPath) {
  if (!branchNodeId || !siblingName) return null;
  try {
    const self = await Node.findById(branchNodeId).select("parent").lean();
    if (!self?.parent) return null;

    const parent = await Node.findById(self.parent).select("children").lean();
    if (!parent?.children?.length) return null;

    const siblings = await Node.find({
      _id: { $in: parent.children },
      name: siblingName,
    }).select("_id name metadata").lean();

    const sibling = siblings.find((s) => {
      const m = readMeta(s);
      return m?.role === "branch";
    });
    if (!sibling) return null;

    // Walk the sibling subtree by name segments in relPath.
    if (!relPath) {
      // Return the sibling root's own notes.
      return await collectNode(sibling._id);
    }
    const segments = String(relPath).split("/").filter(Boolean);
    let cursor = sibling._id;
    for (const seg of segments) {
      const cursorNode = await Node.findById(cursor).select("children").lean();
      if (!cursorNode?.children?.length) return null;
      const kids = await Node.find({
        _id: { $in: cursorNode.children },
        name: seg,
      }).select("_id").lean();
      if (kids.length === 0) return null;
      cursor = kids[0]._id;
    }
    return await collectNode(cursor);
  } catch (err) {
    log.warn("Swarm", `readSiblingNode ${branchNodeId}/${siblingName}/${relPath} failed: ${err.message}`);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────

async function walkDescendants(rootNodeId, { includeNotes, maxNoteLength, maxDescendants }) {
  const out = [];
  const visited = new Set([String(rootNodeId)]);
  const queue = [{ nodeId: String(rootNodeId), relPath: "" }];
  let scanned = 0;

  while (queue.length > 0 && out.length < maxDescendants) {
    const { nodeId, relPath } = queue.shift();
    scanned++;
    if (scanned > maxDescendants * 4) break; // hard safety cap on traversal

    const node = await Node.findById(nodeId).select("_id name children").lean();
    if (!node) continue;

    // Collect the node itself (with notes if requested).
    const entry = { nodeId: String(node._id), name: node.name, path: relPath };
    if (includeNotes) {
      entry.notes = await readNodeNotes(node._id, { maxNoteLength });
    }
    out.push(entry);

    if (Array.isArray(node.children)) {
      for (const childId of node.children) {
        const childIdStr = String(childId);
        if (visited.has(childIdStr)) continue;
        visited.add(childIdStr);
        queue.push({
          nodeId: childIdStr,
          relPath: relPath ? `${relPath}/${node.name}` : node.name,
        });
      }
    }
  }

  return out;
}

async function collectNode(nodeId) {
  const node = await Node.findById(nodeId).select("_id name parent").lean();
  if (!node) return null;
  return {
    nodeId: String(node._id),
    name: node.name,
    notes: await readNodeNotes(node._id, { maxNoteLength: MAX_NOTE_CONTENT * 4 }), // bigger cap for explicit peek
  };
}

async function readNodeNotes(nodeId, { maxNoteLength }) {
  try {
    const mongoose = (await import("mongoose")).default;
    const Note = mongoose.models.Note;
    if (!Note) return [];
    const notes = await Note.find({ nodeId })
      .sort({ createdAt: -1 })
      .limit(MAX_NOTES_PER_NODE)
      .select("content type createdAt")
      .lean();
    return notes.map((n) => ({
      content: String(n.content || "").slice(0, maxNoteLength),
      truncated: String(n.content || "").length > maxNoteLength,
      type: n.type,
      createdAt: n.createdAt,
    }));
  } catch {
    return [];
  }
}
