// ws/orchestrator/cleanupExpandOrchestrator.js
// Scans nodes with dense notes and expands them into subtree structure.
// Pipeline: find candidates → scan each (tool-less) → create branches via tree:structure → delete notes via tree:notes.

import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../..", ".env") });

const JWT_SECRET = process.env.JWT_SECRET || "your_secret_key";

import { switchMode, processMessage, setRootId, getClientForUser, resolveRootLlmForMode, clearSession } from "../conversation.js";
import { trackChainStep, startAIChat, finalizeAIChat, setAiContributionContext, clearAiContributionContext } from "../aiChatTracker.js";
import { connectToMCP, closeMCPClient, MCP_SERVER_URL } from "../mcp.js";
import { createSession, endSession, setSessionAbort, clearSessionAbort, SESSION_TYPES } from "../sessionRegistry.js";
import Node from "../../db/models/node.js";
import Note from "../../db/models/notes.js";
import User from "../../db/models/user.js";

// ─────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────

const MAX_CANDIDATES_PER_RUN = 10;
const MIN_NOTE_LENGTH = 300;
const MIN_NOTE_COUNT = 3;

// In-memory lock
const activeRuns = new Set();

// ─────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────

function parseJsonSafe(text) {
  try {
    if (typeof text === "object" && text !== null) return text;
    const match = text.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  } catch {
    return null;
  }
}

function parseNewBranchId(text) {
  if (!text) return null;
  const str = typeof text === "object" ? JSON.stringify(text) : String(text);
  const match = str.match(/Root ID:\s*(\S+)/);
  return match ? match[1] : null;
}

/**
 * Walk the tree and find nodes with dense notes worth scanning for expansion.
 */
async function findExpansionCandidates(rootId) {
  const candidates = [];

  async function walk(nodeId, depth) {
    if (candidates.length >= MAX_CANDIDATES_PER_RUN) return;

    const node = await Node.findById(nodeId).select("_id name prestige children").lean();
    if (!node) return;

    // Check notes for this node's current version
    const notes = await Note.find({
      nodeId: node._id,
      version: String(node.prestige ?? 0),
      contentType: "text",
    })
      .select("_id content userId")
      .lean();

    if (notes.length > 0) {
      const totalLength = notes.reduce((sum, n) => sum + (n.content?.length || 0), 0);

      if (totalLength >= MIN_NOTE_LENGTH || notes.length >= MIN_NOTE_COUNT) {
        candidates.push({
          nodeId: node._id,
          nodeName: node.name,
          prestige: node.prestige ?? 0,
          children: node.children || [],
          notes,
          totalLength,
        });
      }
    }

    // Recurse into children
    if (node.children?.length && depth < 6) {
      for (const childId of node.children) {
        if (candidates.length >= MAX_CANDIDATES_PER_RUN) break;
        await walk(childId, depth + 1);
      }
    }
  }

  await walk(rootId, 0);

  // Sort by total note length descending — densest nodes first
  candidates.sort((a, b) => b.totalLength - a.totalLength);
  return candidates;
}

// ─────────────────────────────────────────────────────────────────────────
// MAIN ORCHESTRATOR
// ─────────────────────────────────────────────────────────────────────────

export async function orchestrateExpand({ rootId, userId, username, source = "orchestrator" }) {
  if (activeRuns.has(rootId)) {
    console.log(`⏭️ Cleanup expand already running for tree ${rootId}, skipping`);
    return { success: false, error: "already running", sessionId: null };
  }

  activeRuns.add(rootId);

  const visitorId = `cleanup-expand:${rootId}:${Date.now()}`;
  const { sessionId } = createSession({
    userId,
    type: SESSION_TYPES.CLEANUP_EXPAND,
    description: `Cleanup expand: ${rootId}`,
    meta: { rootId, visitorId },
  });
  const abort = new AbortController();
  setSessionAbort(sessionId, abort);

  let chainIndex = 1;
  let mainChatId = null;
  let finalizeArgs = { content: null, stopped: true, modeKey: "cleanup-expand:complete" };

  // ── LLM provider ────────────────────────────────────────────────────
  let llmProvider;
  try {
    const modeConnectionId = await resolveRootLlmForMode(rootId, "tree:cleanup-expand-scan");
    const clientInfo = await getClientForUser(userId, "main", modeConnectionId);
    llmProvider = {
      isCustom: clientInfo.isCustom,
      model: clientInfo.model,
      connectionId: clientInfo.connectionId || null,
    };
  } catch {
    llmProvider = undefined;
  }

  // ── AI chat tracking ─────────────────────────────────────────────────
  const mainChat = await startAIChat({
    userId,
    sessionId,
    message: `Cleanup expand for tree ${rootId}`,
    source,
    modeKey: "cleanup-expand:start",
    llmProvider,
  });
  mainChatId = mainChat._id;
  setAiContributionContext(visitorId, sessionId, mainChatId);

  // ── MCP connection ───────────────────────────────────────────────────
  const internalJwt = jwt.sign({ userId, username, visitorId }, JWT_SECRET, { expiresIn: "1h" });
  await connectToMCP(MCP_SERVER_URL, visitorId, internalJwt);

  console.log(`🧹 Cleanup expand started for tree ${rootId}`);

  try {
    setRootId(visitorId, rootId);

    // ════════════════════════════════════════════════════════════════
    // STEP 1: FIND CANDIDATE NODES
    // ════════════════════════════════════════════════════════════════

    const candidates = await findExpansionCandidates(rootId);

    if (candidates.length === 0) {
      console.log("🧹 No dense notes found — nothing to expand");
      finalizeArgs = { content: "No expansion candidates", stopped: false, modeKey: "cleanup-expand:complete" };
      return { success: true, expanded: 0, sessionId };
    }

    console.log(`🧹 Found ${candidates.length} candidate node(s) with dense notes`);

    let totalExpansions = 0;

    // ════════════════════════════════════════════════════════════════
    // STEP 2: SCAN + EXPAND EACH CANDIDATE
    // ════════════════════════════════════════════════════════════════

    for (const candidate of candidates) {
      if (abort.signal.aborted) break;

      // Resolve child names for context
      let childrenNames = [];
      if (candidate.children.length > 0) {
        const childNodes = await Node.find({ _id: { $in: candidate.children } })
          .select("name")
          .lean();
        childrenNames = childNodes.map((c) => c.name);
      }

      // Resolve usernames for notes
      const notesWithUsernames = [];
      for (const note of candidate.notes) {
        let noteUsername = "system";
        if (note.userId) {
          const noteUser = await User.findById(note.userId).select("username").lean();
          if (noteUser) noteUsername = noteUser.username;
        }
        notesWithUsernames.push({ ...note, username: noteUsername });
      }

      // ── SCAN PHASE (tool-less) ───────────────────────────────────
      switchMode(visitorId, "tree:cleanup-expand-scan", {
        username,
        userId,
        rootId,
        nodeName: candidate.nodeName,
        nodeId: candidate.nodeId,
        notes: notesWithUsernames,
        childrenNames,
        clearHistory: true,
      });

      const scanStart = new Date();
      const scanResult = await processMessage(
        visitorId,
        `Evaluate the notes for "${candidate.nodeName}" and determine if any should be expanded into subtree structure.`,
        { username, userId, rootId, signal: abort.signal, meta: { internal: true } },
      );
      const scanEnd = new Date();

      const scanPlan = parseJsonSafe(scanResult?.answer || scanResult);

      trackChainStep({
        userId,
        sessionId,
        rootChatId: mainChatId,
        chainIndex: chainIndex++,
        modeKey: "tree:cleanup-expand-scan",
        source,
        input: `Scan "${candidate.nodeName}" (${candidate.notes.length} notes, ${candidate.totalLength} chars)`,
        output: scanPlan,
        startTime: scanStart,
        endTime: scanEnd,
        llmProvider,
      });

      if (!scanPlan?.expansions?.length) {
        console.log(`  ✓ "${candidate.nodeName}" — notes are fine, no expansion needed`);
        continue;
      }

      // ── EXECUTE EXPANSIONS ───────────────────────────────────────
      for (const expansion of scanPlan.expansions) {
        if (abort.signal.aborted) break;

        // ── Create branch via tree:structure ─────────────────────
        switchMode(visitorId, "tree:structure", {
          username,
          userId,
          rootId,
          targetNodeId: candidate.nodeId,
          clearHistory: true,
        });

        const buildStart = new Date();
        const buildResult = await processMessage(
          visitorId,
          `Create this branch structure under the current node: ${JSON.stringify(expansion.newBranch)}. Reason: ${expansion.reason}`,
          { username, userId, rootId, signal: abort.signal, meta: { internal: true } },
        );
        const buildEnd = new Date();

        const buildData = parseJsonSafe(buildResult?.answer || buildResult);

        trackChainStep({
          userId,
          sessionId,
          rootChatId: mainChatId,
          chainIndex: chainIndex++,
          modeKey: "tree:structure",
          source,
          input: `Create branch "${expansion.newBranch?.name}" under "${candidate.nodeName}"`,
          output: buildData,
          startTime: buildStart,
          endTime: buildEnd,
          llmProvider,
          treeContext: { targetNodeId: candidate.nodeId, stepResult: buildData ? "success" : "failed" },
        });

        if (!buildData) {
          console.warn(`  ⚠️ Failed to create branch for expansion in "${candidate.nodeName}"`);
          continue;
        }

        // ── Transfer original note to new branch via tree:notes ─
        if (expansion.deleteOriginalNote && expansion.noteId) {
          const newBranchId = parseNewBranchId(buildResult?.answer || buildResult);

          if (newBranchId) {
            switchMode(visitorId, "tree:notes", {
              username,
              userId,
              rootId,
              targetNodeId: candidate.nodeId,
              prestige: candidate.prestige,
              clearHistory: true,
            });

            const xferStart = new Date();
            const xferResult = await processMessage(
              visitorId,
              `Transfer note ${expansion.noteId} to node ${newBranchId}. Its content has been expanded into that branch structure.`,
              { username, userId, rootId, signal: abort.signal, meta: { internal: true } },
            );
            const xferEnd = new Date();

            const xferData = parseJsonSafe(xferResult?.answer || xferResult);

            trackChainStep({
              userId,
              sessionId,
              rootChatId: mainChatId,
              chainIndex: chainIndex++,
              modeKey: "tree:notes",
              source,
              input: `Transfer note ${expansion.noteId} to ${newBranchId}`,
              output: xferData,
              startTime: xferStart,
              endTime: xferEnd,
              llmProvider,
              treeContext: { targetNodeId: candidate.nodeId, stepResult: xferData ? "success" : "failed" },
            });
          } else {
            // Fallback: delete if we couldn't parse the new branch ID
            switchMode(visitorId, "tree:notes", {
              username,
              userId,
              rootId,
              targetNodeId: candidate.nodeId,
              prestige: candidate.prestige,
              clearHistory: true,
            });

            const delStart = new Date();
            const delResult = await processMessage(
              visitorId,
              `Delete note ${expansion.noteId}. Its content has been expanded into a new branch structure.`,
              { username, userId, rootId, signal: abort.signal, meta: { internal: true } },
            );
            const delEnd = new Date();

            const delData = parseJsonSafe(delResult?.answer || delResult);

            trackChainStep({
              userId,
              sessionId,
              rootChatId: mainChatId,
              chainIndex: chainIndex++,
              modeKey: "tree:notes",
              source,
              input: `Delete note ${expansion.noteId} (fallback)`,
              output: delData,
              startTime: delStart,
              endTime: delEnd,
              llmProvider,
              treeContext: { targetNodeId: candidate.nodeId, stepResult: delData ? "success" : "failed" },
            });
          }
        }

        totalExpansions++;
        console.log(`  📂 Expanded note in "${candidate.nodeName}" → branch "${expansion.newBranch?.name}"`);
      }
    }

    finalizeArgs = {
      content: `Expanded ${totalExpansions} note(s) across ${candidates.length} candidate(s)`,
      stopped: false,
      modeKey: "cleanup-expand:complete",
    };

    console.log(`🧹 Cleanup expand complete: ${totalExpansions} expansion(s)`);
    return { success: true, expanded: totalExpansions, sessionId };
  } catch (err) {
    console.error(`❌ Cleanup expand error for tree ${rootId}:`, err.message);
    finalizeArgs = { content: err.message, stopped: abort.signal.aborted, modeKey: "cleanup-expand:complete" };
    return { success: false, error: err.message, sessionId };
  } finally {
    if (mainChatId) {
      finalizeAIChat({ chatId: mainChatId, ...finalizeArgs }).catch((e) =>
        console.error(`❌ Failed to finalize cleanup-expand chat:`, e.message),
      );
    }
    clearAiContributionContext(visitorId);
    clearSessionAbort(sessionId);
    endSession(sessionId);
    closeMCPClient(visitorId);
    clearSession(visitorId);
    activeRuns.delete(rootId);
  }
}
