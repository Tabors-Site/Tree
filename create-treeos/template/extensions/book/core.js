import crypto from "crypto";
import Book from "./model.js";
import { collectSubtreeNodeIds, nodeMatchesStatus } from "../../seed/tree/notes.js";

// Models wired from init() via setModels()
let Node = null;
let Note = null;
export function setModels(models) { Node = models.Node; Note = models.Note; }

function hashBookSettings(settings) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(settings))
    .digest("hex");
}

function normalizeBookSettings(raw = {}) {
  return {
    latestVersionOnly: !!raw.latestVersionOnly,
    lastNoteOnly: !!raw.lastNoteOnly,
    leafNotesOnly: !!raw.leafNotesOnly,
    filesOnly: !!raw.filesOnly,
    textOnly: !!raw.textOnly,

    active: !!raw.active,
    completed: !!raw.completed,
    true: !!raw["true"],

    toc: !!raw.toc,
    tocDepth: parseInt(raw.tocDepth) || 0,
  };
}

function applyNoteFilters(notes, node, flags) {
  let result = notes;
  if (flags.latestVersionOnly && result.length > 0) {
    const maxVersion = Math.max(
      ...result.map((n) => Number(n.version)).filter((v) => !Number.isNaN(v)),
    );
    result = result.filter((n) => Number(n.version) === maxVersion);
  }
  if (flags.filesOnly) result = result.filter((n) => n.contentType === "file");
  if (flags.textOnly) result = result.filter((n) => n.contentType === "text");
  if (flags.lastNoteOnly) result = result.length ? [result[result.length - 1]] : [];
  return result;
}

function buildBookTree(node, nodeMap, notesByNode, flags = {}) {
  const nodeId = node._id.toString();
  const filteredChildren = [];

  for (const childId of node.children || []) {
    const child = nodeMap.get(childId.toString());
    if (!child) continue;
    const childTree = buildBookTree(child, nodeMap, notesByNode, flags);
    if (childTree) filteredChildren.push(childTree);
  }

  const nodePassesStatus = nodeMatchesStatus(node, flags.statusFilters);
  if (!nodePassesStatus && filteredChildren.length === 0) return null;

  const rawNotes = notesByNode.get(nodeId) || [];
  const filteredNotes = applyNoteFilters(rawNotes, node, flags).map((n) => ({
    noteId: n._id.toString(),
    version: n.version,
    userId: n.userId?.toString(),
    content: n.content,
    type: n.contentType,
  }));

  const isLeaf = filteredChildren.length === 0;
  const notes = flags.leafNotesOnly && !isLeaf ? [] : filteredNotes;

  return { nodeId, nodeName: node.name, notes, children: filteredChildren };
}

export async function getBook({ nodeId, options = {} }) {
  if (!nodeId) throw new Error("Missing nodeId");

  const flags = {
    latestVersionOnly: false,
    lastNoteOnly: false,
    leafNotesOnly: false,
    filesOnly: false,
    textOnly: false,
    statusFilters: null,
    ...options,
  };

  if (flags.filesOnly && flags.textOnly) {
    flags.filesOnly = false;
    flags.textOnly = false;
  }

  const subtreeIds = await collectSubtreeNodeIds(nodeId);
  const [nodes, notes] = await Promise.all([
    Node.find({ _id: { $in: subtreeIds } }).lean(),
    Note.find({ nodeId: { $in: subtreeIds } }).lean(),
  ]);

  const nodeMap = new Map(nodes.map((n) => [n._id.toString(), n]));
  const notesByNode = new Map();
  for (const n of notes) {
    const key = n.nodeId.toString();
    if (!notesByNode.has(key)) notesByNode.set(key, []);
    notesByNode.get(key).push(n);
  }

  const book = buildBookTree(nodeMap.get(nodeId.toString()), nodeMap, notesByNode, flags);
  return { message: "Book generated successfully", book };
}

export async function generateBook({ nodeId, settings, userId }) {
  if (!nodeId) throw new Error("Missing nodeId");

  const normalizedSettings = normalizeBookSettings(settings);
  const settingsHash = hashBookSettings(normalizedSettings);

  let book = await Book.findOne({ nodeId, settingsHash });
  if (book) return { shareId: book.shareId };

  const shareId = crypto.randomBytes(8).toString("hex");
  book = await Book.create({
    nodeId,
    settings: normalizedSettings,
    settingsHash,
    shareId,
    createdBy: userId,
  });

  return { reused: false, shareId };
}
