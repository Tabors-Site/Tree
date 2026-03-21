# Self Hosting Developer Guide

Everything a developer needs to know to run, customize, and connect their own TreeOS Land node.

## Table of Contents

1. Project Structure
2. What You Can Change
3. What Must Stay the Same
4. Environment Variables
5. Canopy Protocol Versioning
6. Ghost Users and Remote Access
7. The Proxy Layer
8. WebSocket System
9. LLM Configuration
10. Background Jobs
11. Energy System
12. MCP Tools
13. Gateway Integrations
14. Billing and Payments
15. Authentication
16. Database Models

---

## 1. Project Structure

```
treeos/
  .env                    # single config file for the whole project
  land/                   # the Land server (this is the app)
  site/                   # optional static site (landing pages, about pages)
```

**land/ is the entire application.** `cd land && node server.js` runs the Land server and you have a fully working Land. It serves the TreeOS UI as server rendered HTML, handles the REST API, runs WebSocket connections, executes AI tool calls, and manages background jobs.

**site/ is optional.** It is a React + Vite static site for marketing pages only. You do not need to build or deploy it. Your Land works completely without it.

**The Directory Service is a separate repository.** It is hosted independently. You only need it if you are running the central phonebook for the network. Regular Land operators do not need it.

### Land Layout

```
land/
  server.js                 # entry point
  .land/                    # generated on first boot (keypair + land ID, never delete)
  canopy/                   # federation layer
    identity.js             # Ed25519 keypair, CanopyToken signing/verification
    peers.js                # peer registration, health checks, heartbeat job
    proxy.js                # forward API calls to remote lands
    events.js               # outbox for async event delivery with retry
    middleware.js            # CanopyToken auth, per-land/per-user rate limiting
    protocol.js             # protocol version checking
    directory.js            # directory service registration and lookup
  routes/
    routeHandler.js         # mounts all API routes under /api/v1
    api/                    # REST JSON endpoints
      me.js                 # GET /api/v1/me (current user)
      user.js               # GET /api/v1/user/:id
      root.js               # tree (root node) operations
      node.js               # node CRUD
      notes.js              # note CRUD
      contributions.js      # audit trail
      transactions.js       # value transfers
      values.js             # node values and goals
      understanding.js      # knowledge compression
      blog.js               # blog posts
      orchestrate.js        # manual orchestration triggers
      gatewayWebhooks.js    # external service webhooks
    html/                   # server rendered UI pages (gated behind ENABLE_FRONTEND_HTML)
      canopy.js             # canopy admin dashboard, invites, directory search
      chat.js               # chat page HTML
      node.js, root.js, notes.js, contributions.js, etc.
      notFound.js           # 404 page
    canopy.js               # all canopy protocol endpoints
    users.js                # auth routes (login, register, forgot password)
    setup.js                # first time onboarding
    billing/                # Stripe integration
  routesFrontend/           # HTML app pages
    routesHandler.js        # mounts app pages at root paths
    app.js                  # GET /app (dashboard shell)
    chat.js                 # GET /chat (chat interface)
    setup.js                # GET /setup (onboarding)
  ws/                       # WebSocket server
    conversation.js         # LLM client management, mode routing
    sessionRegistry.js      # session lifecycle (websocket_chat, api, orchestration, scheduled)
    aiChatTracker.js        # logs every LLM call
    modes/                  # HOME, TREE (18 sub-modes), RAW_IDEA
    orchestrator/           # background AI pipelines (dream, drain, understand, cleanup)
    tools.js                # tool definitions for the LLM
  mcp/                      # MCP server (in-process AI tool execution)
  jobs/                     # scheduled jobs
    treeDream.js            # dream pipeline (cleanup, drain, understanding)
    rawIdeaAutoPlace.js     # auto-place pending raw ideas
  core/                     # shared business logic (imported by both routes/ and mcp/)
  db/
    config.js               # MongoDB connection
    models/                 # 18+ Mongoose models (all use UUID v4 primary keys)
  middleware/
    authenticate.js         # JWT, API key, and CanopyToken auth
    authenticateLite.js     # lightweight auth (no tree access resolution)
    authenticateMCP.js      # MCP endpoint auth
    notFoundPage.js         # 404 handler
```

### Route Mounting

API routes are mounted at `/api/v1/` in `routes/routeHandler.js`. Frontend HTML pages are mounted at root paths (`/app`, `/chat`, `/setup`, `/login`, etc.) in `routesFrontend/routesHandler.js`. Canopy routes are mounted at `/canopy/` (not versioned with the API).

### Root Scripts

| Command | What It Does |
|---------|-------------|
| `npm start` | Runs the land server |
| `npm run build` | Builds the optional site (Vite) |
| `npm run install:all` | Installs dependencies in both land and site |

---

## 2. What You Can Change (Freely)

These do not affect canopy compatibility. Customize however you want.

**Deployment:**
- Domain, port, SSL setup
- Docker or bare metal
- MongoDB hosting (local, Atlas, any provider)
- Reverse proxy (nginx, caddy, traefik, or none)

**LLM:**
- Default model (any OpenAI-compatible endpoint)
- Per-user and per-root LLM assignments
- Ollama, commercial APIs, custom endpoints
- Model context limits and tool iteration caps

**AI Behavior:**
- System prompts for each mode
- Orchestrator pipelines (dream, cleanup, drain, understanding)
- Tool availability per mode
- How the AI classifies intent and routes actions

**Energy:**
- Daily limits per tier (basic, standard, premium, god)
- Action costs (create, edit, note, etc.)
- File size scaling thresholds
- Text length scaling

**Background Jobs:**
- Interval timing
- Cleanup pass limits, drain pass limits
- Dream scheduling per root
- Understanding run perspectives and prompts

**Gateway:**
- Add new integration types beyond Discord/Telegram/WebApp
- Notification types and formatting
- Webhook payload structure

**Billing:**
- Pricing amounts and plan durations
- Disable entirely by leaving Stripe env vars empty
- Self-hosted lands default to "god" tier

**UI:**
- All server rendered pages in `routes/html/` and `routesFrontend/`
- Page templates, styling, layout
- Toggle HTML renders on/off with `ENABLE_FRONTEND_HTML`
- Build your own frontend entirely (just speak the same API)

---

## 3. What Must Stay the Same (Network Contract)

If you want your Land to participate in the canopy network, these parts are locked.

**Canopy Endpoints (the protocol):**
```
GET  /canopy/info                  # land metadata + public key + protocol version
GET  /canopy/redirect              # domain redirect for land migrations
GET  /canopy/user/:username        # resolve local user by username
GET  /canopy/public-trees          # list public trees
POST /canopy/peer/register         # mutual peer introduction
POST /canopy/invite/offer          # cross-land invite notification
POST /canopy/invite/accept         # invite acceptance
POST /canopy/invite/decline        # invite decline
GET  /canopy/tree/:rootId          # remote tree access
POST /canopy/energy/report         # energy usage reporting
POST /canopy/notify                # push notification to remote user
POST /canopy/account/transfer-in   # receive account transfer
```

**API Endpoints (the data contract):**
The `/api/v1/` endpoints and their request/response shapes. Remote users interact with trees through the same API as local users. If you change the API shape, remote users from other lands will break.

**CanopyToken format:**
- Ed25519 signed JWT
- Payload: sub (userId), iss (sender domain), aud (target domain), landId
- 5 minute expiry

**Land Identity:**
- Ed25519 keypair in `.land/` directory
- Land ID (UUID) persists forever
- Domain published via `/canopy/info`

**Data model essentials:**
- User._id must be UUID v4
- User.username must be unique per land
- User.isRemote and User.homeLand must exist for ghost users
- Node.rootOwner and Node.contributors control tree access
- Node.visibility supports "private" and "public"
- Contribution logs every action with userId, action type, energyUsed

**Protocol version:** Currently 1. Only increment when canopy endpoints change.

---

## 4. Environment Variables

### Required

| Variable | What It Does | Default |
|----------|-------------|---------|
| `MONGODB_URI` | MongoDB connection string | `mongodb://localhost:27017` |
| `JWT_SECRET` | Signs user auth tokens. Change this. | `your_secret_key` |
| `CUSTOM_LLM_API_SECRET_KEY` | Encrypts stored LLM API keys (AES-256-CBC). 32+ chars. | none |

### Land Identity

| Variable | What It Does | Default |
|----------|-------------|---------|
| `LAND_DOMAIN` | Public domain of this land | `localhost` |
| `LAND_NAME` | Display name shown to other lands | `My Land` |
| `LAND_KEY_DIR` | Where to store the Ed25519 keypair | `.land` |
| `PORT` | Server port | `3000` |

### Canopy Network (optional)

| Variable | What It Does | Default |
|----------|-------------|---------|
| `DIRECTORY_URL` | Directory service URL for peer discovery | none |
| `LAND_REDIRECT_TO` | Old domain serves redirect to this new domain | none |
| `LAND_DEFAULT_TIER` | Default profile tier for new users | `god` |

### Domains and CORS

| Variable | What It Does | Default |
|----------|-------------|---------|
| `CREATOR_DOMAIN` | Creator's website URL (CSP headers) | none |
| `ENABLE_FRONTEND_HTML` | Toggle server rendered HTML pages | `true` |

### LLM

| Variable | What It Does | Default |
|----------|-------------|---------|
| `AI_MODEL` | Default LLM model name | `qwen3.5:27b` |

LLM endpoints are configured per user through `CustomLlmConnection` records in the database. Users add connections via the app. `AI_MODEL` is only the fallback.

### Optional Services

| Variable | What It Does |
|----------|-------------|
| `EMAIL_USER` / `EMAIL_PASS` | SMTP for password reset emails |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Stripe billing. Leave empty to disable. |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_EMAIL` | Web Push notifications |

See `.env.example` for the complete list.

---

## 5. Canopy Protocol Versioning

**Current protocol version: 1**

Every canopy request includes the protocol version. Lands check compatibility before communicating.

**What increments the version:**
- Changes to canopy endpoint request/response shapes
- Changes to CanopyToken JWT payload structure
- Changes to the authentication flow between lands

**What does NOT increment the version:**
- Changes to your app UI
- Changes to energy costs or tier limits
- Changes to LLM configuration or AI behavior
- Changes to background job timing
- Changes to business logic inside your land
- Adding new non-canopy API endpoints

**The rule:** If your change only affects things inside your land, the protocol version stays the same. If your change affects what other lands send or receive, the version must increment.

---

## 6. Ghost Users and Remote Access

When a remote user is invited to a tree on your Land, your Land creates a **ghost user**. This is a normal User document with two extra fields:

```
isRemote: true
homeLand: "other.land.com"
```

Ghost users:
- Have the same UUID as the user on their home Land
- Are added to the tree's `contributors` array like any local user
- Can only access trees they were explicitly invited to
- Cannot log in, cannot change settings, cannot see other users or trees
- Appear as `username@domain` in the UI and contribution logs

**Why ghost users work:** Every API route checks `req.userId` against the tree's `rootOwner` or `contributors` array. Ghost users are in that array. No special cases needed. The entire existing permission system works unchanged.

**Creating a ghost user:** This happens automatically when a remote Land confirms an invite acceptance via `POST /canopy/invite/accept`. The tree's Land creates the ghost user and adds them to the tree's contributors.

**Removing a remote user:** Remove them from the tree's contributors array. The ghost user record stays (for audit trail in contributions) but they lose all access.

**Blocking a Land:** Use `POST /canopy/admin/peer/:domain/block`. All requests from that Land are rejected. All ghost users from that Land lose access because the CanopyToken verification fails.

---

## 7. The Proxy Layer

When a local user interacts with a tree on a remote Land, the request goes through a proxy on the home Land:

```
Frontend -> Home Land (/canopy/proxy/:domain/...) -> Remote Land (/api/v1/...) -> response
```

**Home Land side:**
1. User authenticates normally (JWT cookie or API key)
2. `ALL /canopy/proxy/:domain/*` catches the request
3. Home Land signs a CanopyToken with the user's ID
4. Home Land forwards the request to the remote Land with the CanopyToken

**Remote Land side:**
1. `authenticate.js` middleware sees the `CanopyToken` in the Authorization header
2. Verifies the signature against the sending Land's public key (from peering)
3. Looks up the ghost user by the `sub` claim in the token
4. Sets `req.userId` to the ghost user's ID
5. The route handler runs exactly as it would for a local user

**The frontend never knows about Canopy.** It calls its home Land's API. The proxy is invisible. This works for any client: browser, CLI, mobile app, MCP tool, scripts.

**Three auth methods in authenticate.js (checked in order):**
1. CanopyToken (remote land users)
2. JWT Bearer token or cookie (local browser users)
3. API Key (programmatic access)

---

## 8. WebSocket System

The WebSocket server handles real time interaction between clients and the Land.

**Connection flow:**
1. Client connects via Socket.IO
2. Client sends `register` event with auth token
3. Server validates, creates session
4. Client can send `chat`, `switchMode`, `nodeNavigated`, etc.

**Key events:**
- `chat`: main message handler, routes through mode system
- `switchMode`: change between HOME, TREE, RAW_IDEA modes
- `register`: authenticate WebSocket connection
- `nodeNavigated`, `nodeSelected`, `nodeCreated`, `nodeDeleted`: tree state updates
- `setActiveRoot`: switch active tree
- `cancelRequest`: cancel in-progress LLM call

**Mode system:**
- HOME mode: general chat
- TREE mode: 18 sub-modes (navigate, structure, edit, respond, librarian, understand, notes, cleanup, drain, dream, etc.)
- RAW_IDEA mode: unstructured input processing

**Customizable:** Mode-specific prompts, tool availability per mode, session timeout, domain whitelist
**Do not modify:** Event names (clients depend on these), session registry lifecycle, AIChat tracking

---

## 9. LLM Configuration

TreeOS uses OpenAI-compatible APIs for all LLM calls. Point it at anything.

**Resolution order (most specific wins):**
1. Root node's mode-specific assignment (e.g., root.llmAssignments.respond)
2. Root node's placement fallback (root.llmAssignments.placement)
3. User's default LLM (user.llmAssignments.main)
4. Global default (AI_MODEL env var)

**6 assignable slots per root:**
- `placement`: where new nodes go (fallback for all modes)
- `understanding`: compression and encoding runs
- `respond`: conversational responses
- `notes`: note generation and editing
- `cleanup`: branch expansion and reorganization
- `drain`: short-term memory clustering and placement

**Custom connections:** Users add their own LLM connections (any OpenAI-compatible endpoint). API keys are encrypted with AES-256-CBC.

---

## 10. Background Jobs

Jobs run in-process on intervals. Each Land runs its own jobs for its own trees.

**Tree Dream (30 min default):**
- Checks each root's `dreamTime` (HH:MM format)
- Runs: cleanup (expand + reorganize) > drain (short-term memory) > understanding
- In-memory lock prevents concurrent dreams per tree

**Raw Idea Auto-Place (15 min default):**
- Places pending raw ideas into best matching tree/node

**Canopy Heartbeat (5 min):**
- Pings all known peer lands via `GET /canopy/info`
- Updates peer status: active > degraded > unreachable > dead

**Canopy Outbox (60 sec):**
- Processes pending canopy events (invites, energy reports, notifications)
- Retries failed deliveries up to 5 times

**Directory Registration (60 min, if DIRECTORY_URL set):**
- Re-registers with the directory, refreshes public tree list

---

## 11. Energy System

Energy is a usage meter. Daily limits by tier:

```
basic:    350
standard: 1,500
premium:  8,000
god:      10,000,000,000 (unlimited)
```

Self-hosted lands default to "god" tier.

**Cross-land energy:** When a remote user acts on your tree, your Land reports the cost to their home Land. Their home Land deducts it. Energy is a soft meter, not a security gate.

**Customizable:** All limits, all costs, all scaling factors
**Do not modify:** calculateEnergyCost function signature, daily reset logic

---

## 12. MCP Tools

The MCP server runs in-process. Tools the LLM can call:

- READ: get-tree, get-node, get-node-notes, get-node-contributions, search-notes
- WRITE: create-node, edit-node, delete-node, create-note, edit-note, delete-note
- TRANSACTION: create-transaction, view-transactions, settle-transactions
- SCRIPT: execute-script, edit-script (vm2 sandboxed)
- VALUES: set-value, set-goal, edit-status, add-prestige
- UNDERSTANDING: run-incremental-understanding, get-understanding-runs

Each TREE sub-mode defines which tools the LLM can access. The "respond" mode has read tools. The "structure" mode has create/edit/delete. Etc.

---

## 13. Gateway Integrations

Gateways connect external services (Discord, Telegram, web apps) to trees.

- Direction: input, input-output, output
- Mode: read (place incoming), write (query), read-write (full chat)
- Max 10 channels per root
- Credentials encrypted with CUSTOM_LLM_API_SECRET_KEY

---

## 14. Billing and Payments

Stripe integration for plan upgrades and energy purchases.

**To disable:** Leave STRIPE_SECRET_KEY empty. Billing becomes a no-op. Users get accounts with the default tier.

**If enabled:** Standard ($20/mo), Premium ($100/mo), energy packs ($0.01/point).

---

## 15. Authentication

Three auth methods, checked in order by `authenticate.js`:

**1. CanopyToken (remote land users):**
- Ed25519 signed JWT from a peer Land
- Verifies against peer's stored public key
- Sets req.userId to the ghost user's ID
- Sets req.authType = "canopy"

**2. JWT (local browser users):**
- Signed with JWT_SECRET
- Sent as Bearer token or cookie
- Sets req.authType = "jwt"

**3. API Key (programmatic access):**
- Users generate keys from their account
- Bcrypt hashed, stored in user record
- Sent via X-API-Key header or Authorization: ApiKey header
- Sets req.authType = "apiKey"

**Tree access resolution:** Walk the node's parent chain to find the root. Check if user is rootOwner or in contributors. Both grant full access. This works identically for local users and ghost users.

---

## 16. Database Models

18+ Mongoose models. All use UUID v4 primary keys.

**Core (structure matters for federation):**
- **Node**: tree hierarchy (parent, children, versions, rootOwner, contributors, visibility, llmAssignments)
- **User**: accounts (username, email, profileType, energy, apiKeys, isRemote, homeLand)
- **Contribution**: audit trail (userId, nodeId, action, energyUsed, wasAi, wasRemote, homeLand)

**AI:**
- **AIChat**: every LLM call (sessionId, chainIndex, messages, toolCalls, llmProvider)
- **UnderstandingRun**: knowledge compression runs
- **UnderstandingNode**: compression results

**Features:**
- **Note**, **RawIdea**, **ShortMemory**, **Transaction**, **Invite**
- **CustomLlmConnection**, **GatewayChannel**, **Notification**, **Book**

**Canopy:**
- **LandPeer**: peer lands (domain, publicKey, status, uptimeHistory, rateLimits)
- **RemoteUser**: cached info about users on other lands
- **CanopyEvent**: outbox for async event delivery

You can add new models freely. You can add fields to existing models. Do not remove or rename fields that are part of the network contract.

---

## Quick Reference: What Breaks Federation

1. Canopy endpoint paths or response shapes
2. API endpoint paths or response shapes under /api/v1/
3. CanopyToken JWT structure or signing algorithm
4. Ed25519 keypair (once generated, never replace it)
5. User._id format (must be UUID v4)
6. User.username uniqueness (used in canopy IDs: username@domain)
7. Protocol version number (only increment when the protocol changes)

Everything else is yours.
