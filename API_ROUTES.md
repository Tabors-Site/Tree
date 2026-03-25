# TreeOS API Route Inventory
# Updated March 24, 2026

## Core Routes

### config.js
- get("/land/config"
- get("/land/config/:key"
- put("/land/config/:key"
- get("/land/extensions"
- get("/land/extensions/:name"
- post("/land/extensions/:name/disable"
- post("/land/extensions/:name/enable"
- post("/land/extensions/:name/uninstall"
- post("/land/extensions/install"
- post("/land/extensions/:name/publish"
- get("/land/root"
- get("/land/orchestrators"
- get("/land/tools"
- get("/land/modes"

### contributions.js
- get(
- get("/node/:nodeId/contributions"

### me.js
- get("/me"

### node.js
- get("/node/:nodeId/chats"
- post("/node/:nodeId/editStatus"
- post("/node/:nodeId/:version/editStatus"
- post("/node/:nodeId/updateParent"
- get("/node/:nodeId/modes"
- post("/node/:nodeId/modes"
- get("/node/:nodeId/tools"
- post("/node/:nodeId/tools"
- get("/node/:nodeId"
- get("/node/:nodeId/:version"
- post("/node/:nodeId/createChild"
- post("/node/:nodeId/delete"
- post("/node/:nodeId/editName"
- post("/node/:nodeId/:version/editName"
- post(

### notes.js
- get("/node/:nodeId/:version/notes/editor"
- get(
- get(
- get("/node/:nodeId/:version/notes"
- post(
- put(
- get("/node/:nodeId/:version/notes/:noteId"
- delete(
- post(
- get("/node/:nodeId/notes"
- post("/node/:nodeId/notes"
- get("/node/:nodeId/notes/:noteId"
- put("/node/:nodeId/notes/:noteId"
- delete("/node/:nodeId/notes/:noteId"
- post("/node/:nodeId/notes/:noteId/transfer"

### orchestrate.js
- post("/root/:rootId/chat"
- post("/root/:rootId/place"
- post("/root/:rootId/query"
- get("/root/:rootId/query"

### root.js
- get("/root/:nodeId"
- get("/root/:rootId/query"
- get("/root/:rootId/all"
- post("/root/:rootId/visibility"
- post("/root/:rootId/invite"
- post("/root/:rootId/transfer-owner"
- post("/root/:rootId/remove-user"
- post("/root/:rootId/retire"
- post("/root/:rootId/llm-assign"
- get("/root/:rootId/gateway"
- get(
- get("/root/:rootId/gateway/channels"
- post(
- put(
- delete(
- post(
- post("/root/:rootId/dream-time"
- get("/root/:rootId/calendar"
- get("/root/:nodeId/values"
- get("/root/:rootId/chats"

### user.js
- get("/user/:userId"
- get("/user/reset-password/:token"
- post("/user/reset-password/:token"
- post("/user/:userId/createRoot"
- get("/user/:userId/invites"
- post(

### auth.js

### canopy.js
- get("/canopy/info"
- get("/canopy/redirect"
- get("/canopy/user/:username"
- get("/canopy/public-trees"
- post("/canopy/peer/register"
- post("/canopy/invite/offer"
- post("/canopy/invite/accept"
- post("/canopy/invite/decline"
- post("/canopy/llm/proxy"
- post("/canopy/notify"
- post("/canopy/admin/peer/add"
- delete(
- post(
- post(
- get("/canopy/admin/peers"
- post("/canopy/admin/heartbeat"
- get("/canopy/admin/events/failed"
- post(
- post("/canopy/invite-remote"
- get("/canopy/admin/horizon/lands"
- get("/canopy/admin/horizon/trees"
- post("/canopy/admin/peer/discover"
- get("/canopy/admin"
- get("/canopy/admin/invites"
- get("/canopy/admin/horizon"

### cascade.js
- post("/node/:nodeId/cascade"
- get("/flow"
- get("/flow/:signalId"

## Extension Routes

### fitness
- post("/root/:rootId/fitness"

### food
- post("/root/:rootId/food"

### monitor
- post("/land/activity"
- get("/land/activity"

### api-keys
- post("/user/:userId/api-keys"
- get("/user/:userId/api-keys"
- delete(

### blog
- get("/blog/posts"
- get("/blog/posts/:slug"
- post("/blog/posts"
- put("/blog/posts/:slug"
- delete("/blog/posts/:slug"

### book
- get("/root/:nodeId/book"
- post("/root/:nodeId/book/generate"
- get("/root/:nodeId/book/share/:shareId"

### deleted-revive
- get("/user/:userId/deleted"
- post("/user/:userId/deleted/:nodeId/revive"
- post("/user/:userId/deleted/:nodeId/reviveAsRoot"

### dreams
- get("/root/:rootId/holdings"
- get("/root/:rootId/holdings/:itemId"
- post(

### email
- post("/forgot-password"
- post("/user/reset-password"
- get("/user/verify/:token"
- get("/forgot-password"

### energy
- get("/user/:userId/energy"

### gateway
- get("/root/:rootId/gateway"
- post("/root/:rootId/gateway"
- put("/gateway/channel/:channelId"
- delete("/gateway/channel/:channelId"
- post("/gateway/channel/:channelId/test"

### html-rendering
- post("/setHTMLShareToken"
- post("/verify-token"

### land-manager
- get("/land/status"
- get("/land/users"
- post("/land/chat"

### prestige
- post("/node/:nodeId/prestige"
- post("/node/:nodeId/:version/prestige"

### raw-ideas
- post(
- get("/user/:userId/raw-ideas"
- post(
- delete(
- post(
- get("/user/:userId/raw-ideas/:rawIdeaId"
- post("/user/:userId/raw-ideas/place"
- post("/user/:userId/raw-ideas/chat"
- post("/user/:userId/raw-ideas/:rawIdeaId/place"
- post("/user/:userId/raw-ideas/:rawIdeaId/chat"

### schedules
- post("/node/:nodeId/editSchedule"
- post("/node/:nodeId/:version/editSchedule"

### scripts
- get("/node/:nodeId/script/:scriptId"
- post(
- post(
- get("/node/:nodeId/scripts/help"
- post("/node/:nodeId/script/create"

### solana
- get(
- post(
- post(
- post(
- get("/node/:nodeId/values/solana"
- post("/node/:nodeId/values/solana"

### transactions
- get("/node/:nodeId/:version/transactions"
- post(
- post(
- post(
- get(
- get("/node/:nodeId/transactions"
- post("/node/:nodeId/transactions"
- post("/node/:nodeId/transactions/:transactionId/approve"
- post("/node/:nodeId/transactions/:transactionId/deny"
- post("/root/:nodeId/transaction-policy"

### understanding
- post("/root/:nodeId/understandings"
- get(
- get(
- get("/root/:nodeId/understandings"
- get(
- post("/root/:nodeId/understandings/run/:runId/orchestrate"
- post("/root/:nodeId/understandings/run/:runId/stop"

### user-llm
- get("/user/:userId/custom-llm"
- post("/user/:userId/llm-assign"
- post("/user/:userId/custom-llm"
- put(
- delete(
- get("/user/:userId/llm-failover"
- post("/user/:userId/llm-failover"
- delete("/user/:userId/llm-failover/:connectionId"
- delete("/user/:userId/llm-failover"

### user-queries
- get("/user/:userId/notes"
- get("/user/:userId/tags"
- get("/user/:userId/contributions"
- get("/user/:userId/chats"
- get("/user/:userId/notifications"

### values
- post("/node/:nodeId/value"
- post("/node/:nodeId/goal"
- get("/node/:nodeId/values"
- get("/root/:rootId/values"

## MCP Tools

### Core (mcp/server.js)
- get-tree
- get-node
- tree-start
- tree-actions-menu
- tree-structure-orchestrator
- be-mode-orchestrator
- create-node-version-image-note
- edit-node-or-branch-status
- create-node-version-note
- edit-node-note
- get-node-notes
- get-unsearched-notes-by-user
- get-all-tags-for-user
- delete-node-note
- transfer-node-note
- create-tree
- create-new-node-branch
- delete-node-branch
- edit-node-name
- edit-node-type
- update-node-branch-parent-relationship
- get-node-contributions
- get-contributions-by-user
- get-searched-notes-by-user
- get-root-nodes
- get-active-leaf-execution-frontier
- navigate-tree
- get-tree-context

### Extension Tools
- **land-manager**: land-status,            land: { name: land.name, domain: land.domain, url: getLandUrl() },,land-config-read,land-config-set,land-users,land-peers,land-system-nodes,            name: n.name,,land-ext-list,land-ext-install,        name: z.string().describe(,      async handler({ name: extName, userId }) {,land-ext-disable,        name: z.string().describe(,      async handler({ name: extName, userId }) {,land-ext-enable,        name: z.string().describe(,      async handler({ name: extName, userId }) {,land-ext-search
- **prestige**: add-node-prestige
- **raw-ideas**: raw-idea-filter-orchestrator,get-raw-ideas-by-user,transfer-raw-idea-to-note
- **schedules**: edit-node-version-schedule
- **scripts**: javascript-scripting-orchestrator,node-script-runtime-environment,update-node-script,      name: z.string().describe(,execute-node-script
- **shell**: execute-shell
- **understanding**: understanding-create,understanding-list,understanding-next,understanding-capture,understanding-process
- **values**: edit-node-version-value,edit-node-version-goal

## CLI Commands (dynamic from manifests)

- **blog**: blogs,blog <slug>
- **book**: book
- **console**: log-level <level>
- **deleted-revive**: deleted
- **dreams**: dream-time <time>,holdings,holdings-dismiss <id>,holdings-view <id>
- **energy**: energy
- **gateway**: gateway [action] [args...]
- **land-manager**: land-status,land-users
- **prestige**: prestige
- **raw-ideas**: ideas
- **schedules**: schedule <date>,calendar
- **scripts**: scripts,script <id>,run <id>
- **solana**: wallet [action] [args...]
- **transactions**: transactions
- **understanding**: understand,understandings
- **user-llm**: llm failover,llm failover-push <connectionId>,llm failover-pop
- **values**: values,value <key> <value>,goal <key> <goal>
