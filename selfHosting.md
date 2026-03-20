# Self Hosting Guide

Everything a developer needs to know to run, customize, and connect their own Tree Land node.

## Table of Contents

1. What You Can Change
2. What Must Stay the Same
3. Environment Variables
4. Canopy Protocol Versioning
5. WebSocket System
6. LLM Configuration
7. Background Jobs
8. Energy System
9. MCP Tools
10. Gateway Integrations
11. Billing and Payments
12. Authentication
13. Database Models
14. Frontend
15. HTML Renders

---

## 1. What You Can Change (Freely)

These are yours to modify however you want. They do not affect canopy compatibility.

**Deployment:**
- Domain, port, SSL setup
- Docker configuration or bare metal
- MongoDB hosting (local, Atlas, self-managed)
- Reverse proxy setup (nginx, caddy, etc.)

**LLM:**
- Default model (any OpenAI-compatible endpoint)
- Per-user and per-root LLM assignments
- Ollama, commercial providers, custom endpoints, all work
- Model context limits and tool iteration caps

**Energy:**
- Daily limits per tier (basic, standard, premium, god)
- Action costs (create, edit, note, etc.)
- File size scaling thresholds
- Text length scaling (chars per energy point)

**Background Jobs:**
- Interval timing (dream every 30 min, raw idea every 15 min, etc.)
- Cleanup pass limits, drain pass limits
- Dream scheduling per root (dreamTime field)
- Understanding run perspectives and prompts

**Gateway:**
- Add new integration types beyond Discord/Telegram/WebApp
- Notification types and formatting
- Webhook payload structure
- Rate limiting per channel

**Billing:**
- Pricing amounts and plan durations
- Disable entirely by leaving Stripe env vars empty
- Self-hosted lands default to "god" tier (unlimited energy)

**Frontend:**
- All UI components, routing, styling
- Cytoscape.js visualization configuration
- Custom themes
- Build your own frontend entirely (just speak the same API)

**HTML Renders:**
- The HTML page renders inside routesURL functions will eventually be extracted to standalone files outside the route handlers. This will make them pure templates that are easy to toggle on or off per land deployment. For now they are inline, but plan for them being configurable flags.

---

## 2. What Must Stay the Same (Canopy Contract)

If you want your land to participate in the canopy network, these parts are locked. Changing them will break federation with other lands.

**Canopy Endpoints (the protocol contract):**
```
GET  /canopy/info                  . land metadata + public key + protocol version
GET  /canopy/redirect              . domain redirect for land migrations
GET  /canopy/user/:username        . resolve local user by username
GET  /canopy/public-trees          . list public trees (paginated)
POST /canopy/peer/register         . mutual peer introduction
POST /canopy/invite/offer          . cross-land invite notification
POST /canopy/invite/accept         . invite acceptance confirmation
POST /canopy/invite/decline        . invite decline confirmation
GET  /canopy/tree/:rootId          . remote tree access
POST /canopy/energy/report         . energy usage reporting
POST /canopy/notify                . push notification to remote user
POST /canopy/account/transfer-in   . receive account transfer
```

These endpoints must return the expected response shapes. The request/response schemas are the contract between lands.

**Authentication between lands:**
- CanopyToken JWT signed with Ed25519 private key
- JWT payload must include: sub (userId), iss (sender domain), aud (target domain), landId
- Verification using the sender's public key from peering

**Land identity:**
- Ed25519 keypair generated on first boot, stored in .land/ directory
- Land ID (UUID) persists forever. Changing it breaks your federation identity.
- Domain published via /canopy/info. If you change domains, use the redirect mechanism.

**Data model essentials:**
- User._id must be UUID v4 (globally unique across all lands)
- User.username must be unique per land (used in canopy IDs: username@domain)
- User.isRemote and User.homeLand fields must exist for ghost user records
- Node.rootOwner and Node.contributors must control tree access
- Node.visibility must support "private" and "public"
- Contribution audit trail must log every action with userId, action type, energyUsed

**Protocol version:**
- Current version: 1
- Lands check protocolVersion on every canopy request
- Incompatible versions are rejected with a clear error

---

## 3. Environment Variables

### Required

| Variable | What It Does | Default |
|----------|-------------|---------|
| `MONGODB_URI` | MongoDB connection string | `mongodb://localhost:27017/tree` |
| `JWT_SECRET` | Signs user auth tokens. Change this. | `your_secret_key` |
| `CUSTOM_LLM_API_SECRET_KEY` | Encrypts stored LLM API keys (AES-256-CBC). 32+ chars. | none |

### Land Identity

| Variable | What It Does | Default |
|----------|-------------|---------|
| `LAND_DOMAIN` | Public domain of this land node | `localhost` |
| `LAND_NAME` | Display name shown to other lands | `My Land` |
| `LAND_KEY_DIR` | Where to store the Ed25519 keypair | `.land` |
| `PORT` | Server port | `80` |

### Canopy Network (optional)

| Variable | What It Does | Default |
|----------|-------------|---------|
| `DIRECTORY_URL` | Directory service for peer discovery. Leave empty for standalone. | none |
| `LAND_REDIRECT_TO` | If you moved domains, set old domain to serve this redirect. | none |
| `LAND_DEFAULT_TIER` | Default profile tier for new users | `god` |

### Frontend

| Variable | What It Does | Default |
|----------|-------------|---------|
| `TREE_FRONTEND_DOMAIN` | Frontend URL (CORS whitelist) | none |
| `ROOT_FRONTEND_DOMAIN` | Root app frontend URL | none |
| `BE_FRONTEND_DOMAIN` | BE app frontend URL | none |
| `FRONTEND_PORT` | Frontend dev server port | `3000` |
| `VITE_TREE_API_URL` | API endpoint the frontend calls | none |

### LLM

| Variable | What It Does | Default |
|----------|-------------|---------|
| `AI_MODEL` | Default LLM model name | `qwen3.5:27b` |
| `OLLAMA_URL` | Ollama endpoint if using local Ollama | none |

### Email (optional)

| Variable | What It Does |
|----------|-------------|
| `EMAIL_USER` | SMTP username for password reset emails |
| `EMAIL_PASS` | SMTP password |

### Stripe (optional)

| Variable | What It Does |
|----------|-------------|
| `STRIPE_SECRET_KEY` | Stripe API key. Leave empty to disable billing. |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |

### Push Notifications (optional)

| Variable | What It Does |
|----------|-------------|
| `VAPID_PUBLIC_KEY` | Web Push public key |
| `VAPID_PRIVATE_KEY` | Web Push private key |
| `VAPID_EMAIL` | Admin email for VAPID |

### Solana (optional)

| Variable | What It Does |
|----------|-------------|
| `NODE_WALLET_MASTER_KEY` | Solana wallet master key (hex) |
| `SOLANA_RPC_URL` | Solana RPC endpoint |
| `JUP_API_KEY` | Jupiter API key for token swaps |

---

## 4. Canopy Protocol Versioning

The canopy protocol has a version number. Every request between lands includes this version. This is how different lands running different code versions can still communicate (or gracefully reject each other).

**Current protocol version: 1**

**How it works:**
- `GET /canopy/info` returns `protocolVersion: 1`
- When Land A peers with Land B, both check version compatibility
- If versions are incompatible, peering is rejected with a clear error
- Compatible versions can communicate. Incompatible versions cannot.

**What increments the version:**
- Changes to canopy endpoint request/response shapes
- Changes to CanopyToken JWT payload structure
- Changes to authentication flow

**What does NOT increment the version:**
- Changes to your frontend
- Changes to energy costs or tier limits
- Changes to LLM configuration
- Changes to background job timing
- Changes to business logic inside your land
- Adding new non-canopy API endpoints

**The rule:** If your change only affects things inside your land, the protocol version stays the same. If your change affects what other lands send or receive, the protocol version must increment.

App code can diverge freely between lands. Only the ~10 canopy endpoints need to match. This is how email works. Gmail and Outlook have completely different code but speak the same SMTP protocol.

---

## 5. WebSocket System

The WebSocket server handles real-time interaction between the frontend and backend.

**Connection flow:**
1. Client connects to WebSocket server
2. Client sends `register` event with auth token
3. Server validates, creates session
4. Client can now send `chat`, `switchMode`, `nodeNavigated`, etc.

**Key events:**
- `chat` . main message handler, routes through mode system
- `switchMode` . change between HOME, TREE, RAW_IDEA modes
- `register` . authenticate WebSocket connection
- `nodeNavigated`, `nodeSelected`, `nodeCreated`, `nodeDeleted` . tree state updates
- `setActiveRoot` . switch which tree the user is interacting with
- `cancelRequest` . cancel an in-progress LLM call

**Mode system:**
- HOME mode: general chat, default landing
- TREE mode: 18 sub-modes (navigate, structure, edit, respond, librarian, understand, notes, cleanup, drain, dream, etc.)
- RAW_IDEA mode: unstructured input processing

**Customizable:**
- Mode-specific system prompts (what the AI says/does in each mode)
- Tool availability per mode (which MCP tools the AI can use)
- Session idle timeout (default 15 min)
- Frontend domain whitelist for CORS

**Do not modify:**
- WebSocket event names (frontend depends on these)
- Session registry lifecycle (types: websocket_chat, api, orchestration, scheduled)
- Active navigator enforcement (one user drives tree changes at a time per root)
- AIChat tracking (every LLM call logged with sessionId + chainIndex)

---

## 6. LLM Configuration

Tree uses OpenAI-compatible APIs for all LLM calls. You can point it at anything.

**Resolution order (most specific wins):**
1. Root node's mode-specific assignment (e.g., root.llmAssignments.respond)
2. Root node's placement fallback (root.llmAssignments.placement)
3. User's default LLM (user.llmAssignments.main)
4. Global default (AI_MODEL env var, defaults to qwen3.5:27b)

**6 assignable slots per root:**
- `placement` . where new nodes go (fallback for all modes)
- `understanding` . compression and encoding runs
- `respond` . conversational responses to the user
- `notes` . note generation and editing
- `cleanup` . branch expansion and reorganization
- `drain` . short-term memory clustering and placement

**Custom LLM connections:**
- Users can add custom LLM connections (any OpenAI-compatible endpoint)
- API keys are encrypted with AES-256-CBC using CUSTOM_LLM_API_SECRET_KEY
- SSRF protection blocks private IP ranges (127.*, 10.*, 192.168.*, etc.)

**Customizable:** Model names, endpoints, per-user and per-root assignments, context limits
**Do not modify:** Resolution order, encryption scheme, mode-to-assignment mapping

---

## 7. Background Jobs

Jobs run in-process on intervals. Each land runs its own jobs for its own trees.

**Tree Dream (every 30 min default):**
- Checks each root node's `dreamTime` (HH:MM format)
- If due, runs the pipeline: cleanup (expand + reorganize) > drain (short-term memory) > understanding
- In-memory lock prevents concurrent dreams on the same tree
- Configurable: interval, max passes per phase, minimum tree size

**Raw Idea Auto-Place (every 15 min default):**
- Picks up pending raw ideas and places them into the best matching tree/node
- Configurable: interval

**Canopy Heartbeat (every 5 min):**
- Pings all known peer lands via GET /canopy/info
- Updates peer status: active, degraded, unreachable, dead
- Configurable: interval, failure thresholds

**Canopy Outbox (every 60 sec):**
- Processes pending canopy events (invites, energy reports, notifications)
- Retries failed deliveries up to 5 times
- Configurable: interval, max retries

**Customizable:** All intervals, thresholds, pass limits
**Do not modify:** Job registration in server.js, contribution logging for AI actions, session lifecycle types

---

## 8. Energy System

Energy is a usage meter that limits how much a user can do per day.

**Daily limits by tier:**
```
basic:    350
standard: 1,500
premium:  8,000
god:      10,000,000,000 (effectively unlimited)
```

Self-hosted lands default to "god" tier (LAND_DEFAULT_TIER=god).

**Action costs:**
- Create node: 3
- Edit (status, value, name, parent, schedule, goal): 1
- Add prestige, execute script, transaction: 2
- Note, raw idea, edit script: 1-5 (scales with text length, 1000 chars per energy)
- Understanding: 2 per node processed
- File upload: scales with size (1.5/MB up to 100MB, then increases)

**Daily reset:** 24-hour rolling window per user.

**Cross-land energy:** When a remote user acts on your tree, your land reports the cost back to their home land. Their home land deducts it. Energy is a soft meter. If a home land doesn't deduct, worst case is extra activity. The tree owner can revoke access.

**Customizable:** All limits, all costs, all scaling factors
**Do not modify:** The calculateEnergyCost function signature, daily reset logic, action enum (must match contribution actions)

---

## 9. MCP Tools

The MCP (Model Context Protocol) server runs in-process and exposes tools that the LLM can call during conversations.

**Tool categories:**
- READ: get-tree, get-node, get-node-notes, get-node-contributions, get-raw-ideas, search-notes
- WRITE: create-node, edit-node, delete-node, create-note, delete-note, edit-note, transfer-note
- TRANSACTION: create-transaction, view-transactions, settle-transactions
- SCRIPT: execute-script, edit-script (vm2 sandboxed)
- VALUES: set-value, set-goal, edit-status, add-prestige
- UNDERSTANDING: run-incremental-understanding, get-understanding-runs
- CONTEXT: get-tree-context, inject-context

**Mode availability:** Each TREE sub-mode defines which tools the LLM can access. For example, the "respond" mode has read tools but not create/delete. The "structure" mode has create/edit/delete but not transactions.

**Customizable:** Tool implementations, descriptions, parameter schemas, cost calculations
**Do not modify:** Tool availability per mode (defined in modes/registry.js), energy cost tracking per invocation, contribution logging per tool call

---

## 10. Gateway Integrations

Gateways connect external services (Discord, Telegram, web apps) to trees.

**Supported types:** telegram, discord, webapp

**Channel configuration:**
- Direction: input, input-output, output
- Mode: read (place incoming messages), write (query the tree), read-write (full chat)
- Max 10 channels per root
- Notification types: dream-summary, dream-thought

**Secrets:** All gateway credentials (bot tokens, webhook URLs, OAuth keys) are encrypted with CUSTOM_LLM_API_SECRET_KEY.

**Customizable:** Add new integration types, modify webhook formats, add notification types
**Do not modify:** Encryption scheme, GatewayChannel model structure, mode validation (read/write/read-write)

---

## 11. Billing and Payments

Stripe integration for plan upgrades and energy purchases.

**To disable:** Leave STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET empty. Billing routes become no-ops. Users still get accounts with the default tier.

**If enabled:**
- Standard: $20/month
- Premium: $100/month
- Energy packs: $0.01 per energy point
- Webhook handles checkout.session.completed events
- Idempotent processing via stripeEventId on Contribution records

**Customizable:** Pricing, plan names, plan durations, disable entirely
**Do not modify:** Webhook event handling pattern, contribution logging with idempotency, profileType enum (basic/standard/premium/god)

---

## 12. Authentication

Three auth methods:

**JWT (primary):**
- Signed with JWT_SECRET
- Sent as Bearer token in Authorization header or as cookie
- Used by the frontend for all API calls

**API Key:**
- Users generate API keys from their account
- Sent via X-API-Key header, Authorization: ApiKey header, or body.apiKey
- Key hash stored in user record (not the raw key)

**CanopyToken (cross-land):**
- Ed25519 signed JWT for inter-land requests
- Contains: sub (userId), iss (sender domain), aud (target domain), landId
- Verified against the sender's public key from LandPeer record
- 5 minute expiry

**Tree access resolution:**
- Walk the node's parent chain to find the root
- Check if user is rootOwner or in contributors array
- Both grant full read/write access

**Customizable:** JWT expiry, API key generation, additional middleware
**Do not modify:** Tree access resolution (rootOwner + contributors), CanopyToken format, JWT_SECRET env var name

---

## 13. Database Models

18 Mongoose models. All use UUID v4 for primary keys. All refs are string IDs.

**Core models (structure matters for federation):**
- **Node** . tree hierarchy (parent, children, versions, rootOwner, contributors, visibility, llmAssignments)
- **User** . accounts (username, email, profileType, energy, isRemote, homeLand)
- **Contribution** . audit trail (userId, nodeId, action, energyUsed, wasAi, wasRemote, homeLand)

**AI models:**
- **AIChat** . every LLM call (sessionId, chainIndex, messages, toolCalls, llmProvider)
- **UnderstandingRun** . knowledge compression runs (rootNodeId, perspective, nodeMap, topology)
- **UnderstandingNode** . compression results (realNodeId, perspectiveStates)

**Feature models:**
- **Note** . node annotations
- **RawIdea** . unprocessed input queue
- **ShortMemory** . short-term memory items
- **Transaction** . value transfers between nodes
- **Invite** . collaboration invites
- **CustomLlmConnection** . stored LLM credentials (encrypted)
- **GatewayChannel** . external integrations
- **Notification** . user alerts
- **Book** . tree exports

**Canopy models:**
- **LandPeer** . registered peer lands (domain, publicKey, status, uptimeHistory, rateLimits)
- **RemoteUser** . cached info about users on other lands
- **CanopyEvent** . outbox for async event delivery

**You can add new models freely.** You can add fields to existing models. Do not remove or rename fields that are part of the canopy contract (User.username, User.isRemote, User.homeLand, Node.rootOwner, Node.contributors, Node.visibility, Contribution.wasRemote, Contribution.homeLand).

---

## 14. Frontend

React 18 + Vite 6. Cytoscape.js for tree visualization.

**Key env vars:**
- `VITE_TREE_API_URL` . backend API endpoint
- `VITE_ROOT_API` . root app API

**The frontend talks to one URL.** In standalone mode, that's your land's backend. With canopy, remote tree access is proxied through your land's backend, so the frontend never needs to know about other lands.

**WebSocket messages:** The frontend sends/receives events matching the backend's WebSocket event names. If you build a custom frontend, match these event names and payload shapes.

**Fully customizable:** Everything. Build your own frontend if you want. As long as it speaks the same API and WebSocket events, it works.

---

## 15. HTML Renders

Currently, some routes in `backend/routesURL/` have inline HTML renders (page templates built inside the route handler functions). These will be extracted to standalone template files so they can be toggled on or off per land deployment via configuration flags.

**What this means for self-hosters:**
- For now, if you want to disable or customize a rendered page, you modify the route handler directly
- In the future, templates will be external files with a flag system to enable/disable them per land
- Plan for this when customizing: keep your HTML changes isolated so they're easy to migrate when the template system ships

---

## Quick Reference: What Breaks Federation

If you modify any of these, your land will not be able to communicate with other lands:

1. Canopy endpoint paths or response shapes
2. CanopyToken JWT structure or signing algorithm
3. Ed25519 keypair (once generated, never replace it)
4. User._id format (must be UUID v4)
5. User.username uniqueness (used in canopy IDs)
6. Protocol version number (only increment when the protocol itself changes)

Everything else is yours.
