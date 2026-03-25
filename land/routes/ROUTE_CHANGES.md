# Route Changes Log

Tracks renames, moves, and structural changes to routes and contribution actions. HTTP paths do not change unless explicitly noted.

## March 2026: Seed Final Cleanup

### Contribution action/field renames

Removed redundant "Node" suffix from two contribution actions and their data fields. Clean break, no backward compat. Old records in MongoDB retain their original names.

| Old Action | New Action | Context |
|-----------|-----------|---------|
| `editNameNode` | `editName` | Node rename via POST /node/:nodeId/editName. Matches `editStatus`, `editType` pattern. |
| `updateChildNode` | `updateChild` | Child add/remove on parent. Matches `updateParent` pattern. |

| Old Field | New Field | Notes |
|----------|----------|-------|
| `editNameNode` | `editName` | `{ oldName, newName }` shape unchanged |
| `updateChild` | `updateChild` | `{ action, childId }` shape unchanged |

### Function renames

| Old | New | File |
|-----|-----|------|
| `createNewNode` | `createNode` | `seed/tree/treeManagement.js` |
| `createNodesRecursive` | `createNodeBranch` | `seed/tree/treeManagement.js` |

### File renames and moves

| Old | New | Reason |
|-----|-----|--------|
| `seed/llms/` | `seed/llm/` | Singular, matches `tree/` convention |
| `seed/llms/customLLM.js` | `seed/llm/connections.js` | Descriptive name |
| `seed/llms/llmHelpers.js` | `seed/llm/assignments.js` | Descriptive name |
| `seed/llms/aichat.js` | `seed/ws/chatHistory.js` | Read counterpart to ws/chatTracker.js |

### Duplicate utility extraction

`escapeRegex` and `containsHtml` moved to `seed/utils.js` (were duplicated in 3 and 2 files respectively).

### Bug fix

`seed/tree/nodeTypes.js`: error message said "dot" when checking for "/" prefix.

### Model and service renames

Dropped redundant prefixes. All chats are AI chats in TreeOS, all LLM connections are user-configured. Clean break.

| Old | New | Scope |
|-----|-----|-------|
| Model `AIChat` | `Chat` | `seed/models/chat.js` (collection "aichats" preserved) |
| Model `CustomLlmConnection` | `LlmConnection` | `seed/models/llmConnection.js` (collection preserved) |
| `seed/ws/aiChatTracker.js` | `seed/ws/chatTracker.js` | Renamed file, functions: `startChat`, `finalizeChat`, `setChatContext`, `getChatContext`, `clearChatContext` |
| `core.aiChat` service | `core.chat` | Services bundle namespace |
| Contribution field `aiChatId` | `chatId` | Contribution schema and all consumers |
| Config key `aiChatRetentionDays` | `chatRetentionDays` | Data retention config |
| Monitor response `aiChats` | `chats` | GET /land/activity response fields |

## March 2026: File Renames

| Old Path | New Path | Notes |
|----------|----------|-------|
| `land/core/` | `land/seed/` | Kernel directory renamed. All internal imports updated. |
| `land/core/hooks.js` | `land/seed/hooks.js` | |
| `land/core/services.js` | `land/seed/services.js` | |
| `land/core/log.js` | `land/seed/log.js` | |
| `land/core/landConfig.js` | `land/seed/landConfig.js` | |
| `land/core/landRoot.js` | `land/seed/landRoot.js` | |
| `land/core/authenticate.js` | `land/seed/authenticate.js` | |
| `land/core/orchestratorRegistry.js` | `land/seed/orchestratorRegistry.js` | |
| `land/core/tree/*` | `land/seed/tree/*` | All tree utilities (notes, statuses, treeFetch, treeManagement, etc.) |
| `land/core/llms/*` | `land/seed/llms/*` | LLM connection management |
| `land/db/utils.js` | `land/seed/utils.js` | logContribution, findNodeById moved into seed |
| `land/db/models/*` | `land/seed/models/*` | Mongoose models moved into seed |

### Model file renames (consistency: all singular)

| Old | New | Notes |
|-----|-----|-------|
| `models/notes.js` | `models/note.js` | 11 import sites. Every other model is singular. |

### No HTTP path changes

All API endpoints remain at their original paths. The rename is internal directory structure only. Extensions that import from `../../core/` now import from `../../seed/`. The `land/db/` directory is deprecated.

## March 2026: New Routes Added

| Method | Path | Source | Purpose |
|--------|------|--------|---------|
| POST | /node/:nodeId/cascade | routes/api/cascade.js | Deliver cascade signal to a node |
| GET | /flow | routes/api/cascade.js | Read recent cascade results |
| GET | /flow/:signalId | routes/api/cascade.js | Read results for a specific signal |
| POST | /root/:rootId/fitness | extensions/fitness/routes.js | Fitness coach conversation |
| POST | /root/:rootId/food | extensions/food/routes.js | Food coach conversation |
| POST | /land/activity | extensions/monitor/routes.js | Land activity query (AI-powered) |
| GET | /land/activity | extensions/monitor/routes.js | Land activity stats (raw JSON) |
| GET | /node/:nodeId/extensions | routes/api/node.js | Show extension scope at node |
| POST | /node/:nodeId/extensions | routes/api/node.js | Set extension scope at node |
| GET | /root/:rootId/extensions | routes/api/root.js | Tree-wide extension scope |
| POST | /root/:rootId/extensions | routes/api/root.js | Set extension scope at root |
| GET | /user/:userId/shareToken | extensions/html-rendering/routes.js | Share token page |
| POST | /user/:userId/shareToken | extensions/html-rendering/routes.js | Update share token |

## March 2026: Removed Routes

| Method | Path | Reason |
|--------|------|--------|
| POST | /setHTMLShareToken | Replaced by POST /user/:userId/shareToken |

## March 2026: Removed Shim Directories

| Path | Reason |
|------|--------|
| `land/routes/api/html/` | 11 re-export shims deleted. Extensions use getExtension("html-rendering") |
| `land/routes/app/app.js` | Shim deleted. html-rendering mounts its own page routes via pageRouter |
| `land/routes/app/chat.js` | Same |
| `land/routes/app/setup.js` | Same |
| `land/routes/app/sessionManagerPartial.js` | Same |
| `land/routes/app/html/setup.js` | Same |
