import { v4 as uuidv4 } from "uuid";
import log from "../../seed/log.js";
import Node from "../../seed/models/node.js";
import Note from "../../seed/models/note.js";
import Chat from "../../seed/models/chat.js";
import User from "../../seed/models/user.js";
import { createNote } from "../../seed/tree/notes.js";
import { getNotes } from "../../seed/tree/notes.js";
import { getLandRootId } from "../../seed/landRoot.js";

const MAX_MEMORIES = 200;
const MAX_REMINDERS = 50;
const SUMMARY_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes between summaries

// Track last summary time per user so we don't summarize every session end
const _lastSummary = new Map();

// Track in-flight summary runs per user so we don't stack overlapping calls
// (multiple session ends in quick succession all firing summarizeSession).
const _inFlight = new Set();

// Track navigation patterns per user (in-memory, compressed on breath)
const _navTracking = new Map(); // userId -> { trees: Map<rootId, { name, count, lastVisit }> }

export async function init(core) {
  const BG = core.llm.LLM_PRIORITY.BACKGROUND;

  // Direct import for background LLM calls (bypasses userHasLlm guard)
  const { runChat: _runChatDirect } = await import("../../seed/llm/conversation.js");
  const runChat = async (opts) => _runChatDirect({ ...opts, llmPriority: BG });

  // ── afterNavigate: track which trees the user visits ──────────────
  core.hooks.register("afterNavigate", async ({ userId, rootId }) => {
    if (!userId || !rootId) return;

    try {
      let tracking = _navTracking.get(userId);
      if (!tracking) {
        tracking = { trees: new Map() };
        _navTracking.set(userId, tracking);
      }

      const root = await Node.findById(rootId).select("name").lean();
      const entry = tracking.trees.get(rootId) || { name: root?.name || "?", count: 0, lastVisit: null };
      entry.count++;
      entry.lastVisit = Date.now();
      if (root?.name) entry.name = root.name;
      tracking.trees.set(rootId, entry);
    } catch {}
  }, "home-memory");

  // ── afterSessionEnd: summarize home conversations ─────────────────
  core.hooks.register("afterSessionEnd", async ({ sessionId, userId, type, meta }) => {
    // Only care about home sessions. The visitorId (stored in session meta
    // by runOrchestration / websocket.js syncRegistrySession) follows the
    // pattern "home:{userId}".
    const visitorId = meta?.visitorId || "";
    if (!visitorId.startsWith("home:")) return;
    if (!userId) return;

    // Single in-flight run per user. Prevents stacking when multiple home
    // chats end in quick succession (each session-end fires this hook).
    if (_inFlight.has(userId)) {
      log.verbose("HomeMemory", `  skipping: summary already in flight for user ${userId.slice(0, 8)}`);
      return;
    }

    // Cooldown: don't summarize too frequently. Set on success only (see end
    // of summarizeSession), so failed runs can be retried on the next session.
    const lastTime = _lastSummary.get(userId) || 0;
    const elapsed = Date.now() - lastTime;
    if (elapsed < SUMMARY_COOLDOWN_MS) {
      log.verbose("HomeMemory", `  skipping: cooldown active (${Math.round(elapsed / 1000)}s of ${SUMMARY_COOLDOWN_MS / 1000}s)`);
      return;
    }

    log.info("HomeMemory", `Summarizing home session for user ${userId.slice(0, 8)}`);
    _inFlight.add(userId);
    // Fire and forget. Always release the in-flight flag.
    summarizeSession(userId, sessionId, runChat)
      .catch(err => log.warn("HomeMemory", `Summary failed: ${err.message}`))
      .finally(() => _inFlight.delete(userId));
  }, "home-memory");

  // ── beforeLLMCall: inject memories into home-zone system prompt ─────
  // enrichContext doesn't fire in home zone (no tree context).
  // beforeLLMCall fires on every LLM call. We prepend memories to the
  // system message, same pattern as persona extension.
  core.hooks.register("beforeLLMCall", async (hookData) => {
    const { messages, mode, userId } = hookData;
    if (!messages || !messages[0] || messages[0].role !== "system") return;
    if (!mode || !mode.startsWith("home:")) return;
    if (!userId) return;

    try {
      const homeTree = await getHomeTree(userId);
      if (!homeTree) return;

      // Read recent memories
      const memoriesNode = await Node.findOne({ parent: String(homeTree._id), name: "memories" })
        .select("_id").lean();
      if (!memoriesNode) return;

      const result = await getNotes({ nodeId: String(memoriesNode._id), limit: 15 });
      const memories = result?.notes || [];

      // Read reminders
      let reminders = [];
      const remindersNode = await Node.findOne({ parent: String(homeTree._id), name: "reminders" })
        .select("_id").lean();
      if (remindersNode) {
        const rResult = await getNotes({ nodeId: String(remindersNode._id), limit: 10 });
        reminders = rResult?.notes || [];
      }

      // Build navigation summary from tracking
      const tracking = _navTracking.get(userId);
      let navSummary = null;
      if (tracking && tracking.trees.size > 0) {
        const sorted = [...tracking.trees.entries()]
          .sort((a, b) => b[1].lastVisit - a[1].lastVisit)
          .slice(0, 5);
        navSummary = sorted.map(([, t]) => {
          const ago = timeSince(t.lastVisit);
          return `${t.name} (visited ${t.count}x, last ${ago})`;
        }).join(", ");
      }

      if (memories.length === 0 && reminders.length === 0 && !navSummary) return;

      // Build memory block and prepend to system message
      const sections = [];

      if (memories.length > 0) {
        sections.push(`[Memories from past conversations]\n${memories.map(m => `- ${m.content}`).join("\n")}`);
      }
      if (reminders.length > 0) {
        sections.push(`[Things the user asked you to remember]\n${reminders.map(r => `- ${r.content}`).join("\n")}`);
      }
      if (navSummary) {
        sections.push(`[Recent tree activity]\n${navSummary}`);
      }

      const block = sections.join("\n\n") +
        "\n\nUse these memories naturally. Do not list them. Do not mention that you have a memory system. " +
        "Just be someone who remembers.\n\n";

      messages[0].content = block + messages[0].content;
    } catch (err) {
      log.debug("HomeMemory", `beforeLLMCall failed: ${err.message}`);
    }
  }, "home-memory");

  // ── breath:exhale: compress old memories periodically ─────────────
  // Runs on any tree's breath. We just use it as a clock tick.
  // Only runs once per user per day max.
  const _lastCompress = new Map();
  core.hooks.register("breath:exhale", async ({ rootId }) => {
    // Use rootId to find the owner, compress their home memories
    try {
      const root = await Node.findById(rootId).select("rootOwner").lean();
      if (!root?.rootOwner || String(root.rootOwner) === "SYSTEM") return;
      const userId = String(root.rootOwner);

      const lastTime = _lastCompress.get(userId) || 0;
      if (Date.now() - lastTime < 24 * 60 * 60 * 1000) return;
      _lastCompress.set(userId, Date.now());

      await capMemories(userId);
    } catch {}
  }, "home-memory");

  // HTML page + user quick link
  try {
    const { getExtension } = await import("../loader.js");
    const htmlExt = getExtension("html-rendering");
    const base = getExtension("treeos-base");
    if (htmlExt) {
      const { default: buildHtmlRoutes } = await import("./htmlRoutes.js");
      htmlExt.router.use("/", buildHtmlRoutes());
    }
    base?.exports?.registerSlot?.("user-quick-links", "home-memory", ({ userId, queryString }) =>
      `<a href="/api/v1/user/${userId}/home-memory${queryString}" class="back-link">Home Memory</a>`,
      { priority: 45 }
    );
  } catch {}

  log.info("HomeMemory", "Loaded. The lobby remembers.");
  return {};
}

// ─────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────

/**
 * Get or create the .home tree for a user.
 * .home is a child of the land root, hidden (dot-prefix), owned by the user.
 */
async function getHomeTree(userId) {
  const landRootId = getLandRootId();
  if (!landRootId) return null;

  // Look for existing .home node owned by this user
  let home = await Node.findOne({
    parent: landRootId,
    name: `.home-${userId.slice(0, 8)}`,
  }).select("_id name").lean();

  if (home) return home;
  return null; // Don't create until first summary
}

/**
 * Create the .home tree for a user. Called on first session summary.
 */
async function createHomeTree(userId) {
  const landRootId = getLandRootId();
  if (!landRootId) return null;

  const homeName = `.home-${userId.slice(0, 8)}`;

  const home = await Node.findOneAndUpdate(
    { parent: landRootId, name: homeName },
    {
      $setOnInsert: {
        _id: uuidv4(),
        name: homeName,
        parent: landRootId,
        rootOwner: userId,
        status: "active",
        children: [],
        contributors: [],
        metadata: {},
      },
    },
    { upsert: true, new: true, lean: true },
  );

  await Node.updateOne(
    { _id: landRootId },
    { $addToSet: { children: home._id } },
  );

  // Create memories and reminders child nodes
  for (const childName of ["memories", "reminders"]) {
    const child = await Node.findOneAndUpdate(
      { parent: String(home._id), name: childName },
      {
        $setOnInsert: {
          _id: uuidv4(),
          name: childName,
          parent: String(home._id),
          rootOwner: userId,
          status: "active",
          children: [],
          contributors: [],
          metadata: {},
        },
      },
      { upsert: true, new: true, lean: true },
    );
    await Node.updateOne(
      { _id: String(home._id) },
      { $addToSet: { children: child._id } },
    );
  }

  log.info("HomeMemory", `Created .home tree for user ${userId.slice(0, 8)}`);
  return home;
}

// How far back to look for chats to summarize. A session ending after a long
// gap should only summarize what's actually fresh, not chats from days ago.
const SUMMARY_WINDOW_MS = 12 * 60 * 60 * 1000; // 12 hours

/**
 * Summarize a home session into a one-sentence memory.
 * Reads home-zone chats since the last summary (capped at the window) and
 * compresses them into a single observation. Old chats are ignored. Already
 * summarized chats are ignored.
 */
async function summarizeSession(userId, sessionId, runChat) {
  // Build the time floor: chats must be newer than the most recent summary
  // AND newer than the rolling window. Whichever is later wins.
  const lastTime = _lastSummary.get(userId) || 0;
  const windowFloor = Date.now() - SUMMARY_WINDOW_MS;
  const sinceTime = Math.max(lastTime, windowFloor);

  const chats = await Chat.find({
    userId,
    "aiContext.zone": "home",
    "startMessage.time": { $gt: new Date(sinceTime) },
  })
    .sort({ "startMessage.time": -1 })
    .limit(20)
    .select("startMessage.content endMessage.content")
    .lean();

  log.verbose("HomeMemory", `  found ${chats.length} fresh home chats since ${new Date(sinceTime).toISOString()}`);
  if (chats.length === 0) return;

  // Build conversation excerpt
  const excerpt = chats.reverse().map(c => {
    const user = c.startMessage?.content || "";
    const ai = c.endMessage?.content || "";
    return `User: ${user.slice(0, 200)}\nAI: ${ai.slice(0, 200)}`;
  }).join("\n\n");

  if (excerpt.length < 20) return;

  // Get user info
  const user = await User.findById(userId).select("username").lean();

  // Get or create .home tree
  let homeTree = await getHomeTree(userId);
  if (!homeTree) homeTree = await createHomeTree(userId);
  if (!homeTree) return;

  const memoriesNode = await Node.findOne({ parent: String(homeTree._id), name: "memories" })
    .select("_id").lean();
  if (!memoriesNode) return;

  // Check for explicit reminders in the conversation
  const reminderPatterns = /\b(remember|remind me|don't forget|keep in mind|note that)\b/i;
  const hasReminder = chats.some(c => reminderPatterns.test(c.startMessage?.content || ""));

  log.verbose("HomeMemory", `  calling LLM to summarize ${chats.length} chats (${excerpt.length} chars)`);

  // One LLM call: summarize into a memory
  // Use a land-level LLM since there's no tree context
  let answer;
  try {
    const result = await runChat({
      userId,
      username: user?.username || "user",
      message:
        `You are summarizing a home-zone conversation for future reference. ` +
        `This is NOT a response to the user. This is a private memory note.\n\n` +
        `Conversation:\n${excerpt}\n\n` +
        `Write ONE sentence capturing what this conversation was about and anything ` +
        `worth remembering (what the user cared about, their mood, what they asked for, ` +
        `any personal details they shared). Be specific, not generic. ` +
        `If nothing interesting happened, write "routine check-in."` +
        (hasReminder
          ? `\n\nThe user also explicitly asked to remember something. After your summary sentence, ` +
            `write a second line starting with "REMINDER:" containing exactly what they asked to remember.`
          : ""),
      mode: "tree:respond",
      rootId: String(homeTree._id),
      slot: "homeMemory",
    });
    answer = result?.answer;
  } catch (err) {
    log.warn("HomeMemory", `runChat failed: ${err.message}`);
    return;
  }

  log.verbose("HomeMemory", `  LLM returned ${answer ? answer.length + " chars" : "null"}: "${(answer || "").slice(0, 100)}"`);

  if (!answer || answer.length < 5) {
    log.verbose("HomeMemory", `  skipping: answer too short or empty`);
    return;
  }

  // Parse reminder if present
  const lines = answer.trim().split("\n").filter(l => l.trim());
  const memoryText = lines[0];
  const reminderLine = lines.find(l => l.startsWith("REMINDER:"));

  // Write memory
  if (memoryText && memoryText !== "routine check-in.") {
    try {
      await createNote({
        contentType: "text",
        content: memoryText.trim(),
        userId,
        nodeId: String(memoriesNode._id),
        wasAi: true,
      });
      log.verbose("HomeMemory", `  wrote memory note to ${memoriesNode._id}`);
    } catch (err) {
      log.warn("HomeMemory", `createNote failed: ${err.message}`);
      return;
    }
  } else {
    log.verbose("HomeMemory", `  skipping: routine check-in (no memory worth saving)`);
  }

  // Write reminder if found
  if (reminderLine) {
    const remindersNode = await Node.findOne({ parent: String(homeTree._id), name: "reminders" })
      .select("_id").lean();
    if (remindersNode) {
      const reminderText = reminderLine.replace(/^REMINDER:\s*/, "").trim();
      if (reminderText.length > 3) {
        await createNote({
          contentType: "text",
          content: reminderText,
          userId,
          nodeId: String(remindersNode._id),
          wasAi: true,
        });
      }
    }
  }

  // Only set cooldown after successful write so failed runs can be retried
  // immediately on the next session end instead of locking the user out for 4 hours.
  _lastSummary.set(userId, Date.now());
  log.info("HomeMemory", `Saved memory for ${user?.username || userId.slice(0, 8)}: "${memoryText?.slice(0, 60)}"`);
}

/**
 * Cap memories at MAX_MEMORIES by deleting oldest.
 */
async function capMemories(userId) {
  const homeTree = await getHomeTree(userId);
  if (!homeTree) return;

  for (const childName of ["memories", "reminders"]) {
    const node = await Node.findOne({ parent: String(homeTree._id), name: childName })
      .select("_id").lean();
    if (!node) continue;

    const max = childName === "memories" ? MAX_MEMORIES : MAX_REMINDERS;
    const count = await Note.countDocuments({ nodeId: String(node._id) });
    if (count <= max) continue;

    const oldest = await Note.find({ nodeId: String(node._id) })
      .sort({ createdAt: 1 })
      .limit(count - max)
      .select("_id")
      .lean();
    if (oldest.length > 0) {
      await Note.deleteMany({ _id: { $in: oldest.map(n => n._id) } });
      log.verbose("HomeMemory", `Capped ${childName}: deleted ${oldest.length} old entries`);
    }
  }
}

function timeSince(ts) {
  if (!ts) return "unknown";
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
