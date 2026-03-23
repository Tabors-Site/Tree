# Schema Flatten Work In Progress

## STATUS: Schema flat. Hook system built. 8 hooks. Core fully decoupled. Extensions enrich context, tag versions, react to lifecycle events. Ready for live testing.

## What we're doing

Removing the `versions` array and `prestige` field from the Node schema. Flattening `status` to top-level. Moving `values`, `goals`, `schedule` to `metadata` (read/written by extensions). This makes the Node schema match the protocol: `_id, name, type, status, parent, children, metadata`.

## What's done

### Schema change (db/models/node.js)
- Removed `prestige: Number` and `versions: [...]` subdocument array
- Added `status: String (default: "active")` and `dateCreated: Date` at top level
- `metadata: Map<Mixed>` already existed, now used by values/goals/schedule extensions

### Core files updated
- `core/tree/statuses.js` . reads/writes `node.status` directly, no version lookup
- `core/tree/treeManagement.js` . createNewNode builds flat node, values/goals/schedule go in metadata
- `core/tree/treeDataFetching.js` . filterTreeByStatus, getNodeForAi, getAllData, getParents, getTreeStructure all read `node.status` directly, notes fetched without version filter
- `core/tree/treeFetch.js` . getContextForAi reads status/values/goals from node+metadata, getActiveLeafExecutionFrontier uses node.status, buildDeepTreeSummary reads ctx.values (flat), resolveVersion checks metadata.prestige
- `core/tree/notes.js` . getNotes no longer requires version param, nodeMatchesStatus reads node.status

### New extension created
- `extensions/values/` . manifest.js, core.js, routes.js, index.js
  - Reads/writes values and goals from `metadata.values` and `metadata.goals` via extensionMetadata helpers
  - Routes: GET /node/:nodeId/values, POST /node/:nodeId/value, POST /node/:nodeId/goal, GET /root/:rootId/values

## What still needs updating

### Routes (land/routes/api/)
- `node.js` . version middleware (router.param("version")), version params in endpoints, references to node.versions and node.prestige. Lines 227-305 have heavy version logic for GET /node/:nodeId and GET /node/:nodeId/:version
- `values.js` . DELETE THIS FILE, replaced by extensions/values/routes.js. Remove from routeHandler.js import.
- `root.js` . may reference prestige in tree data

### MCP Server (land/mcp/server.js)
- `resolvePrestige()` function (lines 74-91) . needs rewrite to check metadata.prestige
- Tool schemas with `prestige` params: edit-node-version-value, edit-node-version-goal, create-node-version-note, get-node-notes, edit-node-or-branch-status, edit-node-version-schedule, add-node-prestige
- Lines 496-950+ have prestige in z.number() schemas
- Tool handlers call setValueForNode/setGoalForNode with prestige . need to stop passing version

### WS Tools (land/ws/tools.js)
- Tool definitions reference prestige in schemas
- Handlers pass version/prestige to core functions

### Extensions
- `prestige/core.js` . FULL REWRITE. Currently pushes to versions array. Needs to use metadata.prestige for version history.
- `schedules/core.js` . updateSchedule reads versions[versionIndex].schedule. Switch to metadata.schedule
- `transactions/core.js` . assertValidVersionIndex, reads versions[versionAIndex]. Switch to metadata.values
- `scripts/routes.js` . exposes node.versions[i].schedule etc to user scripts
- `scripts/scriptsFunctions/safeFunctions.js` . imports updateSchedule

### HTML Renderers (land/routes/api/html/)
- `node.js` . shows version data, prestige badge
- `root.js` . tree rendering with version/status
- `values.js` . version params in render
- `chat.js` . may reference prestige
- `user.js` . contributions show version info

### CLI (cli/commands/)
- `notes.js` . note/notes commands pass prestige
- `nodes.js` . prestige command, version handling
- Various commands that pass version params to API

### Data Migration
- Need a one-time script that for each node:
  1. Copies `versions[prestige].status` to `node.status`
  2. Copies `versions[prestige].values` to `metadata.values`
  3. Copies `versions[prestige].goals` to `metadata.goals`
  4. Copies `versions[prestige].schedule` to `metadata.schedule`
  5. Copies `versions[prestige].reeffectTime` to `metadata.reeffectTime`
  6. Stores full versions array in `metadata.prestige.history` if prestige > 0
  7. Sets `metadata.prestige.current = node.prestige`

## Key decisions
- `version` field on Note model STAYS. Defaults to 0. Prestige extension uses it to tag notes per version.
- getNotes() without version param returns ALL notes for the node
- getNotes() with version param filters (for prestige extension use)
- Values/goals live at `metadata.values` and `metadata.goals` (not nested under extension namespace)
- Schedule lives at `metadata.schedule`
- Prestige history lives at `metadata.prestige.history` (array of snapshots)
- Status is top-level on Node, not in metadata (it's core protocol)

## How to continue
1. Update MCP server resolvePrestige and all tool schemas to not require prestige
2. Update WS tools same way
3. Update routes/api/node.js to not reference versions array
4. Delete routes/api/values.js, remove from routeHandler.js
5. Update extensions (prestige, schedules, transactions, scripts)
6. Update HTML renderers
7. Update CLI commands
8. Write migration script
9. Test boot
