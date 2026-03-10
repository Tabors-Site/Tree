t# Tree (Treefficiency v2.0)

AI-powered knowledge management system where users grow trees of goals, plans, and reflections. LLM acts as conversational tree-builder with background maintenance.

## Tech Stack

- **Backend**: Node.js + Express 4, MongoDB (Mongoose 8), Socket.IO 4, OpenAI SDK (Ollama/custom endpoints)
- **Frontend**: React 18 + Vite 6, Cytoscape.js for tree visualization
- **Auth**: JWT + bcrypt, cookie sessions
- **Payments**: Stripe (basic/standard/premium/god tiers)

## Project Structure

```
backend/
├── core/           # Shared business logic — imported by both mcp/ and routesURL/
├── db/models/      # 15 Mongoose models (Node, User, AIChat, UnderstandingRun/Node, Contribution, ShortMemory, RawIdea, Note, Book, CustomLlmConnection, etc.)
├── jobs/           # Scheduled: treeDream, shortTermDrain, cleanupAutoRun, understandingAutoRun, rawIdeaAutoPlace
├── mcp/            # MCP server (in-process) — AI tool calls go through here, tracks energy + contributions
├── routesURL/      # REST endpoints (user, root, node, notes, understanding, chat, tree, contributions, values)
├── ws/             # WebSocket system
│   ├── conversation.js    # LLM client mgmt, mode routing, per-mode LLM resolution
│   ├── sessionRegistry.js # Central session lifecycle (types: websocket_chat, api, orchestration, scheduled)
│   ├── aiChatTracker.js   # Logs every LLM call (sessionId + chainIndex)
│   ├── modes/             # HOME, TREE (18 sub-modes), RAW_IDEA
│   ├── orchestrator/      # treeOrchestrator, rawIdea, shortTermDrain, understand, cleanup (expand+reorganize)
│   └── tools.js           # Tool definitions (file ops, tree ops, note ops, scripts, understanding)
└── server.js

frontend/src/
├── main.jsx, App.jsx
└── components/     # UI with Cytoscape tree visualization
frontend/legacy/    # OLD CODE — ignore, do not reference or modify
```

## Architecture Pattern

**`core/`** contains shared business logic functions. These are imported by:

- **`mcp/server.js`** — exposes them as MCP tools for the AI. When the LLM calls a tool (create node, edit note, etc.), it goes through the MCP server which handles energy deduction and contribution logging.
- **`routesURL/`** — exposes them as REST endpoints for the frontend/API users.

Both layers use the same core functions, but the MCP path adds AI-specific tracking (energy costs, AIChat records, contribution attribution to the AI session).

## Core Concepts

### Tree Structure

- **Root Node** → has rootOwner (User), contributors, dreamTime, llmAssignments
- **Node** → parent/children hierarchy, versions (prestige), values, status (active/completed/trimmed/divider), scripts (vm2)
- **Contribution** → audit trail for all changes (create/edit/delete/prestige/transaction/understanding)

### LLM Assignment System (per-mode routing)

- 6 slots on root node: `placement`, `understanding`, `respond`, `notes`, `cleanup`, `drain`
- Resolution: `llmAssignments[modeGroup]` → `llmAssignments.placement` (fallback) → user default
- `resolveRootLlmForMode(rootId, modeKey)` in conversation.js handles resolution
- `MODE_TO_ASSIGNMENT` maps mode keys (e.g. `tree:librarian` → `placement`, `tree:respond` → `respond`)
- `processMessage` auto-resolves per-mode LLM, returns `_llmProvider` (internal) / `llmProvider` (external)

### Understanding System

- **UnderstandingRun** → shadow tree per perspective, bottom-up layer compression
- **Incremental runs** → `findOrCreateUnderstandingRun` reuses completed runs, `prepareIncrementalRun` detects dirty nodes via `contributionSnapshot`
- **Orchestrator** → loops nodes depth-first, commits encodings layer by layer
- POST endpoint supports `incremental: true` to reuse existing runs

### Background Pipelines

- **Tree Dream** → daily per-root: cleanup (expand+reorganize) → drain (ShortMemory) → understanding
- **Raw Idea Placement** → pending ideas auto-placed into best root/node
- **Short-Term Drain** → ShortMemory items clustered → scouted → planned → placed into tree
- **Cleanup** → expand sparse branches, reorganize/consolidate small nodes

### WebSocket Conversation Flow

1. Message → conversation.js routes to current mode
2. Mode builds system prompt with tree context
3. Translator classifies intent (navigate/create/edit/delete/query/reflect)
4. LLM executes via tool-calling loop (max 15 iterations)
5. Each action logged: AIChat (LLM call) + Contribution (tree change)
6. Session registry tracks lifecycle, active navigator control

### Energy System

- 100 daily base (scales with tier), 1 per understanding node
- Daily reset via cron

## Conventions

- UUIDs for all primary keys
- Default LLM: `qwen3.5:27b` via Ollama, customizable per user/root/mode
- Node paths: "Root > Child > Grandchild" format
- Session idle TTL: 15 min reuse window
- `trackChainStep` logs actual LLM used per step via `result._llmProvider || llmProvider`
- Never use em dashes in user-facing text outputs (HTML pages, error messages, UI copy)
