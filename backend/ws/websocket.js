// ws/websocket.js
// Unified WebSocket server with MCP client integration and bidirectional sync
import { Server } from "socket.io";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import OpenAI from "openai";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || "your_secret_key";
const MCP_SERVER_URL = process.env.MCP_SERVER_URL || "http://localhost:3000/mcp";

// OpenAI/Ollama Setup
const openai = new OpenAI({
  baseURL: process.env.OPENAI_BASE_URL || "http://localhost:11434/v1",
  apiKey: process.env.OPENAI_API_KEY || "ollama",
});

const MODEL = process.env.AI_MODEL || "gpt-oss:20b";
const MAX_MESSAGES = 30;

let io;

// Session tracking - simplified: just track by visitorId
const userSockets = new Map();    // key visitorId → socket.id
const authSessions = new Map();   // key: userId → socket.id (for app iframe control)

// MCP state - keyed by visitorId
export const mcpClients = new Map();   // key: visitorId → MCP Client instance
export const conversations = new Map(); // key: visitorId → conversation array
export const activeRoots = new Map();   // key: visitorId → currently selected rootId

// ============================================================================
// MCP CLIENT MANAGEMENT
// ============================================================================

export async function connectToMCP(serverUrl, visitorId, username, userId) {
  if (mcpClients.has(visitorId)) {
    console.log(`♻️  Reusing MCP client for ${visitorId}`);
    return mcpClients.get(visitorId);
  }

  console.log(`🔌 Connecting MCP client for ${visitorId}...`);

  const transport = new StreamableHTTPClientTransport(
    new URL(serverUrl),
    {
      requestInit: {
        headers: {
          'X-User-Id': userId || '',
          'X-Username': username || '',
        }
      }
    }
  );
  
  const client = new Client(
    { name: `tree-chat-client-${visitorId}`, version: "1.0.0" },
    { capabilities: { sampling: {} } }
  );

  await client.connect(transport);
  console.log(`✅ MCP client connected for ${visitorId}`);

  mcpClients.set(visitorId, client);
  return client;
}

async function closeMCPClient(visitorId) {
  const client = mcpClients.get(visitorId);
  if (!client) return;

  try {
    if (typeof client.close === "function") {
      await client.close();
    } else if (client.transport?.close) {
      await client.transport.close();
    }
    console.log(`🔒 Closed MCP client for ${visitorId}`);
  } catch (err) {
    console.warn(`⚠️  Error closing MCP client for ${visitorId}:`, err.message);
  }

  mcpClients.delete(visitorId);
  conversations.delete(visitorId);
  activeRoots.delete(visitorId);
}

// ============================================================================
// WEBSOCKET SERVER
// ============================================================================

export function initWebSocketServer(httpServer, allowedOrigins) {
  io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins,
      methods: ["GET", "POST"],
      credentials: true,
    },
    transports: ["websocket", "polling"],
  });

  // Auth middleware - extract userId from JWT cookie
  io.use((socket, next) => {
    const cookie = socket.request.headers.cookie;

    if (!cookie) {
      socket.userId = null;
      return next();
    }

    const tokenMatch = cookie.match(/token=([^;]+)/);
    if (!tokenMatch) {
      socket.userId = null;
      return next();
    }

    try {
      const decoded = jwt.verify(tokenMatch[1], JWT_SECRET);
      socket.userId = decoded.id || decoded.userId || decoded._id;
    } catch (err) {
      socket.userId = null;
    }

    next();
  });

  io.on("connection", (socket) => {
    const userId = socket.userId;
    console.log(`🔗 Socket connected: ${socket.id} (user: ${userId || "anonymous"})`);

    // Track authenticated user session for iframe control
    if (userId) {
      const oldSocketId = authSessions.get(userId);
      if (oldSocketId && oldSocketId !== socket.id) {
        io.sockets.sockets.get(oldSocketId)?.disconnect(true);
      }
      authSessions.set(userId, socket.id);
    }

    // App ready signal (iframe loaded)
    socket.on("ready", () => {
      console.log(`✅ App ready for user: ${userId}`);
    });

    // Register for chat - NO rootId required
    socket.on("register", async ({ username }) => {
      if (!username) {
        socket.emit("registered", { success: false, error: "Missing username" });
        return;
      }

      // Use visitorId as unique key (visitorId = username for simplicity)
      const visitorId = `user:${username}`;

      // Replace old socket if exists
      const oldSocketId = userSockets.get(visitorId);
      if (oldSocketId && oldSocketId !== socket.id) {
        console.log(`♻️  Replacing old socket for ${visitorId}`);
        io.sockets.sockets.get(oldSocketId)?.disconnect(true);
      }

      userSockets.set(visitorId, socket.id);
      socket.visitorId = visitorId;
      socket.username = username;

      console.log(`📝 Registered socket for ${visitorId}`);

      try {
        await connectToMCP(MCP_SERVER_URL, visitorId, username, socket.userId);
        socket.emit("registered", { success: true, visitorId });
      } catch (err) {
        console.error(`❌ MCP connection failed for ${visitorId}:`, err.message);
        socket.emit("registered", { success: false, error: err.message });
      }

      logStats();
    });

    // Handle chat messages - rootId is optional
    socket.on("chat", async ({ message, username }) => {
      if (!message || !username) {
        socket.emit("chatError", { error: "Missing message or username" });
        return;
      }

      const visitorId = socket.visitorId || `user:${socket.userId}`;

      try {
        const response = await processChatMessage(message, visitorId, username, socket.userId);
        socket.emit("chatResponse", response);
      } catch (err) {
        console.error("❌ Chat error:", err);
        socket.emit("chatError", { error: err.message });
      }
    });

    // Set active root (called when user selects a tree)
    socket.on("setActiveRoot", ({ rootId }) => {
      const visitorId = socket.visitorId;
      if (visitorId && rootId) {
        activeRoots.set(visitorId, rootId);
        console.log(`🌳 Set active root for ${visitorId}: ${rootId}`);
      }
    });

    // ========================================================================
    // BIDIRECTIONAL SYNC: Frontend → AI Context
    // ========================================================================

    // User edited a node in the frontend
    socket.on("nodeUpdated", ({ nodeId, changes }) => {
      const visitorId = socket.visitorId;
      if (!visitorId) return;

      const conversation = conversations.get(visitorId);
      if (conversation) {
        conversation.push({
          role: "system",
          content: `[Frontend Update] User modified node ${nodeId} in the UI. Changes: ${JSON.stringify(changes)}`
        });
        console.log(`📡 Synced frontend node update to AI context for ${visitorId}`);
      }
    });

    // User navigated to a different node
    socket.on("nodeNavigated", ({ nodeId, nodeName }) => {
      const visitorId = socket.visitorId;
      if (!visitorId) return;

      const conversation = conversations.get(visitorId);
      if (conversation) {
        conversation.push({
          role: "system",
          content: `[Frontend Navigation] User navigated to node "${nodeName}" (${nodeId}).`
        });
        console.log(`📡 Synced navigation to AI context for ${visitorId}`);
      }
    });

    // User selected/focused on a node
    socket.on("nodeSelected", ({ nodeId, nodeName }) => {
      const visitorId = socket.visitorId;
      if (!visitorId) return;

      const conversation = conversations.get(visitorId);
      if (conversation) {
        conversation.push({
          role: "system",
          content: `[Frontend Selection] User is now focusing on node "${nodeName}" (${nodeId}).`
        });
      }
    });

    // User created a node in frontend
    socket.on("nodeCreated", ({ nodeId, nodeName, parentId }) => {
      const visitorId = socket.visitorId;
      if (!visitorId) return;

      const conversation = conversations.get(visitorId);
      if (conversation) {
        conversation.push({
          role: "system",
          content: `[Frontend Action] User created new node "${nodeName}" (${nodeId}) under parent ${parentId}.`
        });
      }
    });

    // User deleted a node in frontend
    socket.on("nodeDeleted", ({ nodeId, nodeName }) => {
      const visitorId = socket.visitorId;
      if (!visitorId) return;

      const conversation = conversations.get(visitorId);
      if (conversation) {
        conversation.push({
          role: "system",
          content: `[Frontend Action] User deleted node "${nodeName}" (${nodeId}).`
        });
      }
    });

    // User added a note in frontend
    socket.on("noteCreated", ({ nodeId, noteContent }) => {
      const visitorId = socket.visitorId;
      if (!visitorId) return;

      const conversation = conversations.get(visitorId);
      if (conversation) {
        const preview =
          (noteContent ?? "").toString().length > 100
            ? (noteContent ?? "").toString().slice(0, 100) + "..."
            : (noteContent ?? "").toString();
        conversation.push({
          role: "system",
          content: `[Frontend Action] User added a note to node ${nodeId}: "${preview}"`
        });
      }
    });

    // Clear conversation (reset context)
    socket.on("clearConversation", () => {
      const visitorId = socket.visitorId;
      if (visitorId) {
        conversations.delete(visitorId);
        activeRoots.delete(visitorId);
        socket.emit("conversationCleared", { success: true });
        console.log(`🧹 Cleared conversation for ${visitorId}`);
      }
    });

    // Handle disconnect
    socket.on("disconnect", async (reason) => {
      console.log(`🔌 Socket disconnected: ${socket.id} (${reason})`);

      if (userId && authSessions.get(userId) === socket.id) {
        authSessions.delete(userId);
        console.log(`🧹 Removed auth session for user: ${userId}`);
      }

      if (socket.visitorId) {
        const visitorId = socket.visitorId;
        if (userSockets.get(visitorId) === socket.id) {
          userSockets.delete(visitorId);
          // Optionally keep MCP client alive for reconnection
          // await closeMCPClient(visitorId);
          console.log(`🧹 Removed socket for ${visitorId}`);
        }
      }

      logStats();
    });
  });

  console.log("🚀 WebSocket server initialized");
  return io;
}

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

function buildSystemPrompt(username, userId, currentRootId) {
  const rootContext = currentRootId 
    ? `- Active Root ID: ${currentRootId}` 
    : `- No tree selected yet`;

  const gettingStarted = currentRootId 
    ? '' 
    : `
[Getting Started]
The user has not selected a tree yet. You should:
1. Call get-root-nodes with userId "${userId}" to see their available trees
2. Present the list in a friendly way and ask which tree they want to work on
3. Once they choose or mention a tree, call tree-start with that rootId
4. Remember the selected rootId for subsequent operations

`;

  return `
You are Tree Helper, an AI assistant for managing hierarchical data trees.

[Context]
- User: ${username}
- User ID: ${userId}
${rootContext}
${gettingStarted}
[Your Capabilities]
You can help users with:
1. **Tree Navigation** - Viewing tree structure, finding nodes
2. **Data Modification** - Editing values, goals, status, notes, schedules
3. **Tree Structure** - Creating branches, moving nodes, renaming
4. **Scripting** - Creating, editing, and executing node scripts
5. **User Data** - Viewing notes, contributions, raw ideas, tags/mail
6. **Understanding Runs** - Creating and processing tree comprehension

[Available Tools - READ ONLY]
- get-tree: Fetch tree structure (with optional status filters)
- get-node: Fetch detailed node data
- get-node-notes: Get notes for a node version
- get-node-contributions: Get contribution history
- get-unsearched-notes-by-user: Recent user notes
- get-searched-notes-by-user: Search notes by text
- get-all-tags-for-user: Get tagged notes (mail)
- get-contributions-by-user: User's contribution history
- get-raw-ideas-by-user: User's inbox/raw ideas
- get-root-nodes: Get all user's root trees

[Available Tools - WRITE]
- edit-node-version-value: Update numeric values
- edit-node-version-goal: Update goals (must match existing value key)
- edit-node-or-branch-status: Change status (active/trimmed/completed)
- edit-node-version-schedule: Update schedule and reeffect time
- add-node-prestige: Increment prestige, create new version
- create-node-version-note: Add a text note
- delete-node-note: Remove a note
- create-new-node: Create single node
- create-new-node-branch: Create recursive node structure
- edit-node-name: Rename a node
- update-node-branch-parent-relationship: Move node to new parent
- update-node-script: Create/update a script
- execute-node-script: Run a stored script
- transfer-raw-idea-to-note: Convert inbox item to note

[Available Tools - ORCHESTRATORS]
- tree-start: Entry point, loads context for a specific tree
- tree-actions-menu: Present action options
- tree-structure-orchestrator: Guide tree restructuring
- be-mode-orchestrator: Guided node traversal mode
- javascript-scripting-orchestrator: Script creation workflow
- raw-idea-filter-orchestrator: Process inbox items
- node-script-runtime-environment: Script API documentation

[Available Tools - UNDERSTANDING]
- understanding-create: Start understanding run
- understanding-next: Get next summarization task
- understanding-capture: Save summarization result
- understanding-finisher: Auto-complete understanding run

[Important Rules]
1. If no tree is selected, first call get-root-nodes to show available trees
2. Always use get-tree before get-node to understand structure
3. Prestige = version index (0 = first, prestige = latest)
4. Goals must correspond to existing value keys
5. Confirm with user before destructive actions
6. Present data in natural language, not raw JSON
7. Convert times to Pacific Time Zone (PST/PDT)
8. Never expose internal _id fields to users

[Frontend Sync]
- When you call tools, the user's frontend will update automatically
- The user may also make changes directly in the UI
- System messages will inform you of frontend changes
- Keep context aligned with what the user sees

[Output Style]
- Be concise and helpful
- Use natural language explanations
- Avoid code/JSON unless explicitly requested
- Confirm before creating branches or running scripts
`.trim();
}


// ============================================================================
// TOOL DEFINITIONS (matching MCP server)
// ============================================================================

const TOOLS = [
  // READ-ONLY TOOLS
  {
    type: "function",
    function: {
      name: "get-tree",
      description: "Fetch a tree's structure. Use filters to show active/trimmed/completed nodes.",
      parameters: {
        type: "object",
        properties: {
          nodeId: { type: "string", description: "Root node ID to fetch tree from" },
          filters: {
            type: "object",
            properties: {
              active: { type: "boolean" },
              trimmed: { type: "boolean" },
              completed: { type: "boolean" }
            },
            description: "Status filters. Default shows active and completed."
          }
        },
        required: ["nodeId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get-node",
      description: "Fetch detailed information for a specific node.",
      parameters: {
        type: "object",
        properties: {
          nodeId: { type: "string", description: "The node ID to fetch" }
        },
        required: ["nodeId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get-node-notes",
      description: "Get notes for a node at a specific prestige version.",
      parameters: {
        type: "object",
        properties: {
          nodeId: { type: "string" },
          prestige: { type: "number", description: "Version number (0 = first)" },
          limit: { type: "number", description: "Max notes to return" },
          startDate: { type: "string", description: "ISO date filter start" },
          endDate: { type: "string", description: "ISO date filter end" }
        },
        required: ["nodeId", "prestige"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get-node-contributions",
      description: "Get contribution history for a node version.",
      parameters: {
        type: "object",
        properties: {
          nodeId: { type: "string" },
          version: { type: "number" },
          limit: { type: "number" },
          startDate: { type: "string" },
          endDate: { type: "string" }
        },
        required: ["nodeId", "version"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get-unsearched-notes-by-user",
      description: "Get recent notes by the user (limit 20 max).",
      parameters: {
        type: "object",
        properties: {
          userId: { type: "string" },
          limit: { type: "number" },
          startDate: { type: "string" },
          endDate: { type: "string" }
        },
        required: ["userId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get-searched-notes-by-user",
      description: "Search user's notes by text content.",
      parameters: {
        type: "object",
        properties: {
          userId: { type: "string" },
          query: { type: "string", description: "Search query" },
          limit: { type: "number" },
          startDate: { type: "string" },
          endDate: { type: "string" }
        },
        required: ["userId", "query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get-all-tags-for-user",
      description: "Get notes where user was tagged (mail).",
      parameters: {
        type: "object",
        properties: {
          userId: { type: "string" },
          limit: { type: "number" },
          startDate: { type: "string" },
          endDate: { type: "string" }
        },
        required: ["userId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get-contributions-by-user",
      description: "Get user's contribution history.",
      parameters: {
        type: "object",
        properties: {
          userId: { type: "string" },
          limit: { type: "number" },
          startDate: { type: "string" },
          endDate: { type: "string" }
        },
        required: ["userId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get-raw-ideas-by-user",
      description: "Get user's raw ideas inbox.",
      parameters: {
        type: "object",
        properties: {
          userId: { type: "string" },
          limit: { type: "number" },
          startDate: { type: "string" },
          endDate: { type: "string" }
        },
        required: ["userId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get-root-nodes",
      description: "Get all root trees owned by user. Call this first if no tree is selected.",
      parameters: {
        type: "object",
        properties: {
          userId: { type: "string" }
        },
        required: ["userId"]
      }
    }
  },

  // WRITE TOOLS
  {
    type: "function",
    function: {
      name: "edit-node-version-value",
      description: "Set or update a numeric value on a node version.",
      parameters: {
        type: "object",
        properties: {
          nodeId: { type: "string" },
          key: { type: "string", description: "Value key name" },
          value: { type: "number", description: "Numeric value" },
          prestige: { type: "number", description: "Version index" },
          userId: { type: "string" }
        },
        required: ["nodeId", "key", "value", "prestige", "userId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "edit-node-version-goal",
      description: "Set a goal for an existing value key.",
      parameters: {
        type: "object",
        properties: {
          nodeId: { type: "string" },
          key: { type: "string", description: "Must match existing value key" },
          goal: { type: "number" },
          prestige: { type: "number" },
          userId: { type: "string" }
        },
        required: ["nodeId", "key", "goal", "prestige", "userId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "edit-node-or-branch-status",
      description: "Change node status. Use isInherited=true to apply to children.",
      parameters: {
        type: "object",
        properties: {
          nodeId: { type: "string" },
          status: { type: "string", enum: ["active", "trimmed", "completed"] },
          prestige: { type: "number" },
          isInherited: { type: "boolean", description: "Apply to children recursively" },
          userId: { type: "string" }
        },
        required: ["nodeId", "status", "prestige", "isInherited", "userId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "edit-node-version-schedule",
      description: "Update schedule and reeffect time.",
      parameters: {
        type: "object",
        properties: {
          nodeId: { type: "string" },
          prestige: { type: "number" },
          newSchedule: { type: "string", description: "ISO 8601 date/time" },
          reeffectTime: { type: "number", description: "Hours until reschedule on prestige" },
          userId: { type: "string" }
        },
        required: ["nodeId", "prestige", "newSchedule", "reeffectTime", "userId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "add-node-prestige",
      description: "Increment prestige, creating a new version.",
      parameters: {
        type: "object",
        properties: {
          nodeId: { type: "string" },
          userId: { type: "string" }
        },
        required: ["nodeId", "userId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create-node-version-note",
      description: "Create a text note on a node. Confirm exact wording first.",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "Note text content" },
          nodeId: { type: "string" },
          prestige: { type: "number" },
          userId: { type: "string" }
        },
        required: ["content", "nodeId", "prestige", "userId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "delete-node-note",
      description: "Delete a note by ID.",
      parameters: {
        type: "object",
        properties: {
          noteId: { type: "string" }
        },
        required: ["noteId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create-new-node",
      description: "Create a single new node.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          parentNodeID: { type: "string" },
          userId: { type: "string" },
          schedule: { type: "string", description: "Optional ISO date" },
          reeffectTime: { type: "number" },
          values: { type: "object", description: "Key-value pairs for numbers" },
          goals: { type: "object", description: "Key-value pairs for goals" },
          note: { type: "string", description: "Optional initial note" }
        },
        required: ["name", "parentNodeID", "userId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create-new-node-branch",
      description: "Create a recursive tree structure.",
      parameters: {
        type: "object",
        properties: {
          nodeData: {
            type: "object",
            description: "Node with optional children array",
            properties: {
              name: { type: "string" },
              schedule: { type: "string" },
              reeffectTime: { type: "number" },
              values: { type: "object" },
              goals: { type: "object" },
              note: { type: "string" },
              children: { type: "array" }
            },
            required: ["name"]
          },
          parentId: { type: "string" },
          userId: { type: "string" }
        },
        required: ["nodeData", "parentId", "userId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "edit-node-name",
      description: "Rename a node.",
      parameters: {
        type: "object",
        properties: {
          nodeId: { type: "string" },
          newName: { type: "string" },
          userId: { type: "string" }
        },
        required: ["nodeId", "newName", "userId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "update-node-branch-parent-relationship",
      description: "Move a node to a new parent.",
      parameters: {
        type: "object",
        properties: {
          nodeChildId: { type: "string" },
          nodeNewParentId: { type: "string" },
          userId: { type: "string" }
        },
        required: ["nodeChildId", "nodeNewParentId", "userId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "update-node-script",
      description: "Create or update a script on a node.",
      parameters: {
        type: "object",
        properties: {
          nodeId: { type: "string" },
          name: { type: "string", description: "Script name" },
          script: { type: "string", description: "Script content (max 2000 chars)" }
        },
        required: ["nodeId", "name", "script"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "execute-node-script",
      description: "Run a stored script. Use scripting-orchestrator first.",
      parameters: {
        type: "object",
        properties: {
          nodeId: { type: "string" },
          scriptName: { type: "string" },
          userId: { type: "string" }
        },
        required: ["nodeId", "scriptName", "userId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "transfer-raw-idea-to-note",
      description: "Convert a raw idea to a note on a node.",
      parameters: {
        type: "object",
        properties: {
          rawIdeaId: { type: "string" },
          nodeId: { type: "string" },
          userId: { type: "string" }
        },
        required: ["rawIdeaId", "nodeId", "userId"]
      }
    }
  },

  // ORCHESTRATORS
  {
    type: "function",
    function: {
      name: "tree-start",
      description: "Entry point for tree workflows. Call this after user selects a tree.",
      parameters: {
        type: "object",
        properties: {
          rootId: { type: "string" }
        },
        required: ["rootId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "tree-actions-menu",
      description: "Present action options to user.",
      parameters: {
        type: "object",
        properties: {
          rootId: { type: "string" },
          treeData: { type: "object" }
        },
        required: ["rootId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "tree-structure-orchestrator",
      description: "Guide tree creation/restructuring.",
      parameters: {
        type: "object",
        properties: {
          rootId: { type: "string" },
          userId: { type: "string" }
        },
        required: ["rootId", "userId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "be-mode-orchestrator",
      description: "Guided traversal of active leaf nodes.",
      parameters: {
        type: "object",
        properties: {
          nodeId: { type: "string" },
          userId: { type: "string" }
        },
        required: ["nodeId", "userId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "javascript-scripting-orchestrator",
      description: "Guide script creation/editing.",
      parameters: {
        type: "object",
        properties: {
          nodeId: { type: "string" },
          userId: { type: "string" }
        },
        required: ["nodeId", "userId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "raw-idea-filter-orchestrator",
      description: "Process raw ideas into tree.",
      parameters: {
        type: "object",
        properties: {
          userId: { type: "string" }
        },
        required: ["userId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "node-script-runtime-environment",
      description: "Get script API documentation.",
      parameters: {
        type: "object",
        properties: {
          nodeId: { type: "string" }
        },
        required: ["nodeId"]
      }
    }
  },

  // UNDERSTANDING TOOLS
  {
    type: "function",
    function: {
      name: "understanding-create",
      description: "Create an understanding run for a tree.",
      parameters: {
        type: "object",
        properties: {
          rootNodeId: { type: "string" },
          perspective: { type: "string", description: "Perspective/focus for understanding" }
        },
        required: ["rootNodeId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "understanding-next",
      description: "Get next summarization payload.",
      parameters: {
        type: "object",
        properties: {
          understandingRunId: { type: "string" },
          rootNodeId: { type: "string" }
        },
        required: ["understandingRunId", "rootNodeId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "understanding-capture",
      description: "Save summarization result.",
      parameters: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["leaf", "merge"] },
          understandingRunId: { type: "string" },
          rootNodeId: { type: "string" },
          understandingNodeId: { type: "string" },
          currentLayer: { type: "number" },
          encoding: { type: "string", description: "Summary text" }
        },
        required: ["mode", "understandingRunId", "rootNodeId", "encoding"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "understanding-finisher",
      description: "Auto-complete understanding run.",
      parameters: {
        type: "object",
        properties: {
          understandingRunId: { type: "string" },
          rootNodeId: { type: "string" }
        },
        required: ["understandingRunId", "rootNodeId"]
      }
    }
  }
];

// ============================================================================
// CHAT MESSAGE PROCESSING
// ============================================================================

export async function processChatMessage(message, visitorId, username, userId) {
  // Ensure MCP client exists
  let client = mcpClients.get(visitorId);
  if (!client) {
    client = await connectToMCP(MCP_SERVER_URL, visitorId, username, userId);
  }

  // Get current active root (may be null)
  const currentRootId = activeRoots.get(visitorId) || null;

  // Get or initialize conversation
  let conversation = conversations.get(visitorId);
  if (!conversation || conversation.length > MAX_MESSAGES) {
    console.log(`🔄 Starting new conversation for ${visitorId}`);
    conversation = [
      { role: "system", content: buildSystemPrompt(username, userId, currentRootId) }
    ];
    // NO auto tree-start here - let the AI decide based on user input
  }

  // Add user message
  conversation.push({ role: "user", content: message });

  // Tool calling loop
  let response;
  let iterations = 0;
  const MAX_ITERATIONS = 15;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    response = await openai.chat.completions.create({
      model: MODEL,
      messages: conversation,
      tools: TOOLS,
      tool_choice: "auto",
    });

    const choice = response.choices?.[0];
    if (!choice) break;

    const assistantMessage = choice.message;
    conversation.push(assistantMessage);

    // Check for tool calls
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      break; // No more tools, we have final response
    }

    // Execute each tool call
    for (const toolCall of assistantMessage.tool_calls) {
      const toolName = toolCall.function.name;
      let args;

      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch (e) {
        console.error(`❌ Invalid tool arguments for ${toolName}:`, e.message);
        conversation.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: "Invalid arguments" })
        });
        continue;
      }

      // Auto-inject userId where needed
      args.userId = userId;

      console.log(`🔧 Calling tool: ${toolName}`, args);

      try {
        const result = await client.callTool({
          name: toolName,
          arguments: args
        });

        const resultText = result?.contents?.[0]?.text ||
                          result?.content?.[0]?.text ||
                          JSON.stringify(result);

        conversation.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: resultText
        });

        // Track when tree-start is called to update active root
        if (toolName === "tree-start" && args.rootId) {
          activeRoots.set(visitorId, args.rootId);
          console.log(`🌳 Updated active root for ${visitorId}: ${args.rootId}`);
          
          // Update system prompt with new root context
          conversation[0] = { 
            role: "system", 
            content: buildSystemPrompt(username, userId, args.rootId) 
          };
        }

        // Emit real-time update to frontend
        const socketId = userSockets.get(visitorId);
        if (socketId && io) {
          io.to(socketId).emit("toolResult", {
            tool: toolName,
            args,
            success: true
          });
        }

      } catch (err) {
        console.error(`❌ Tool ${toolName} failed:`, err.message);

        conversation.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: err.message })
        });

        const socketId = userSockets.get(visitorId);
        if (socketId && io) {
          io.to(socketId).emit("toolResult", {
            tool: toolName,
            args,
            success: false,
            error: err.message
          });
        }
      }
    }
  }

  // Ensure we have a final text response
  if (!response?.choices?.[0]?.message?.content) {
    const finalResponse = await openai.chat.completions.create({
      model: MODEL,
      messages: conversation,
    });
    response = finalResponse;
  }

  const finalAnswer = response?.choices?.[0]?.message?.content || "Done.";
  conversation.push({ role: "assistant", content: finalAnswer });
  conversations.set(visitorId, conversation);

  return { success: true, answer: finalAnswer, rootId: activeRoots.get(visitorId) };
}

// ============================================================================
// PUBLIC EMIT FUNCTIONS
// ============================================================================

/**
 * Emit to a user by visitorId
 */
export function emitToVisitor(visitorId, event, data) {
  if (!io) return;
  const socketId = userSockets.get(visitorId);
  if (socketId) {
    io.to(socketId).emit(event, data);
  }
}

/**
 * Emit to a user in their chat room (legacy - now uses visitorId)
 */
export function emitToUserAtRoot(rootId, username, event, data) {
  // For backwards compatibility, try to find by visitorId pattern
  if (!io) return;
  // This is now less useful since we key by visitorId, not rootId:username
  console.warn("emitToUserAtRoot is deprecated, use emitToVisitor instead");
}

/**
 * Emit navigate event to user's app iframe (called from MCP server)
 */
export function emitNavigate({ userId, url, replace = false }) {
  if (!io) return;
  const socketId = authSessions.get(userId);
  if (socketId) {
    io.to(socketId).emit("navigate", { url, replace });
    console.log(`📍 Navigated user ${userId} to ${url}`);
  } else {
    console.warn("⚠️  No active app session for user:", userId);
  }
}

/**
 * Emit reload event to user's app iframe
 */
export function emitReload({ userId }) {
  if (!io) return;
  const socketId = authSessions.get(userId);
  if (socketId) {
    io.to(socketId).emit("reload");
  }
}

/**
 * Emit to all connected sockets
 */
export function emitBroadcast(event, data) {
  if (io) io.emit(event, data);
}

/**
 * Emit to a specific authenticated user
 */
export function emitToUser(userId, event, data) {
  if (!io) return;
  const socketId = authSessions.get(userId);
  if (socketId) {
    io.to(socketId).emit(event, data);
  }
}

/**
 * Notify frontend that tree data changed (triggers refresh)
 */
export function notifyTreeChange({ userId, nodeId, changeType, details }) {
  if (!io) return;
  const socketId = authSessions.get(userId);
  if (socketId) {
    io.to(socketId).emit("treeChanged", { nodeId, changeType, details });
  }
}

/**
 * Inject a context message into user's conversation
 */
export function injectContextMessage(visitorId, message) {
  const conversation = conversations.get(visitorId);
  if (conversation) {
    conversation.push({ role: "system", content: message });
    return true;
  }
  return false;
}

/**
 * Get current conversation (for debugging)
 */
export function getConversation(visitorId) {
  return conversations.get(visitorId) || [];
}

/**
 * Clear conversation (reset context)
 */
export function clearConversation(visitorId) {
  conversations.delete(visitorId);
  activeRoots.delete(visitorId);
  console.log(`🧹 Cleared conversation for ${visitorId}`);
}

/**
 * Get active root for a visitorId
 */
export function getActiveRoot(visitorId) {
  return activeRoots.get(visitorId);
}

/**
 * Set active root for a visitorId
 */
export function setActiveRoot(visitorId, rootId) {
  activeRoots.set(visitorId, rootId);
}

function logStats() {
  console.log(
    `📊 Stats — Auth: ${authSessions.size}, Visitors: ${userSockets.size}, MCP: ${mcpClients.size}, Convos: ${conversations.size}, ActiveRoots: ${activeRoots.size}`
  );
}