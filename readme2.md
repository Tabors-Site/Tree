# TreeOS: Decentralized Knowledge Network

TreeOS is a decentralized context management system. Users grow trees of goals, plans, and reflections. AI acts as a conversational tree builder with background maintenance. Each server instance is called a Land. Lands connect through the Canopy protocol to form a distributed network where anyone can host their own node, run their own AI, and collaborate across the network.

The API and data shape are the contract that holds the network together. Everything behind the scenes (AI models, orchestrators, frontends, background jobs, rules) is customizable per land. As long as the context structure and API stay consistent, all lands in the network are compatible.

## Naming

```
Tree        A single knowledge structure (nodes, values, notes, contributions, etc)
Land        The server where trees grow (one deployment, one database, one identity)
Canopy      The REST protocol connecting lands together
Directory   A phonebook service for land discovery (optional, hosted separately)

Coming Soon:
Forest      A curated group of trees from any land
Mycelium    The underground network linking trees within or across lands
```

## How It Works

Think of it like email. Your Land is your mail server. You can send and receive with anyone on any other server, but your data lives on yours. No central authority owns the network.

Each Land:
- Hosts trees for its local users
- Runs its own AI models and background jobs
- Controls its own rules, energy limits, and billing
- Can connect to other Lands to enable cross-land collaboration
- Works fully standalone without connecting to anything

The API is the glue. Every Land speaks the same REST API shape and the same Canopy protocol. A CLI client, a React frontend, a mobile app, or a custom script can all interact with any Land because the API contract is the same everywhere.

## Quick Start

```bash
# Clone the repo
git clone <repo-url> treeos
cd treeos

# Configure your land
cp .env.example .env
# Edit .env: set LAND_DOMAIN, MONGODB_URI, JWT_SECRET

# Install and start
cd land && npm install && node server.js
```

Your Land generates an Ed25519 keypair on first boot (stored in `.land/`), connects to MongoDB, and starts serving. Visit `/canopy/admin` to see your land identity.

## Project Structure

```
treeos/
  .env                    # single config file
  land/                   # the Land server (this is the app)
  site/                   # optional static site (landing pages, about pages)
```

**land/ is the entire application.** It serves the full TreeOS app (server rendered HTML or JSON API), handles WebSocket connections, runs AI tool calls, executes background jobs, and speaks the Canopy protocol.

**site/ is optional.** A React + Vite static site for marketing pages. Your Land works completely without it.

The Directory Service is a separate repository hosted independently. It is a lightweight phonebook that Lands register with for discovery. If you are not hosting the directory, you do not need it.

### Land Layout

```
land/
  server.js                 # entry point
  canopy/                   # federation layer
    identity.js             # Ed25519 keypair generation, CanopyToken signing
    peers.js                # peer registration, health checks, heartbeat
    proxy.js                # forward API calls to remote lands
    events.js               # outbox for async event delivery
    middleware.js            # CanopyToken auth, rate limiting
    protocol.js             # protocol version checking
    directory.js            # directory service registration and lookup
  routes/
    api/                    # REST JSON endpoints (/api/v1/...)
      me.js                 # current user profile and settings
      user.js               # user lookup
      root.js               # tree (root node) operations
      node.js               # node CRUD
      notes.js              # note CRUD
      contributions.js      # audit trail
      transactions.js       # value transfers
      values.js             # node values and goals
      understanding.js      # knowledge compression runs
      blog.js               # blog posts
      orchestrate.js        # manual orchestration triggers
      gatewayWebhooks.js    # external service webhooks
    html/                   # server rendered UI (gated behind ENABLE_FRONTEND_HTML)
      canopy.js             # canopy admin, invites, directory search pages
      chat.js, node.js, root.js, notes.js, user.js, etc.
    canopy.js               # all canopy protocol endpoints
    users.js                # auth routes (login, register, forgot password)
    setup.js                # first time onboarding
    billing/                # Stripe integration
  routesFrontend/           # HTML app pages (app, chat, setup)
  ws/                       # WebSocket server
    conversation.js         # LLM client management, mode routing
    sessionRegistry.js      # session lifecycle
    modes/                  # HOME, TREE (18 sub-modes), RAW_IDEA
    orchestrator/           # background AI pipelines
    tools.js                # MCP tool definitions
  mcp/                      # MCP server (AI tool execution)
  jobs/                     # scheduled jobs (dream, drain, cleanup, understanding)
  core/                     # shared business logic
  db/models/                # 18+ Mongoose models
  middleware/               # auth, rate limiting, error handling
```

## The API Contract

The REST API under `/api/v1/` is the contract that makes the network work. Every Land implements the same endpoints with the same request/response shapes. This means:

- Any client (web, CLI, mobile, script) works with any Land
- Remote users interact with trees through the same API as local users
- Custom frontends and tools are fully supported
- Lands can run completely different code internally

**Core API endpoints:**

| Path | Purpose |
|------|---------|
| `GET /api/v1/me` | Current user profile |
| `POST /api/v1/node/create` | Create a node |
| `POST /api/v1/node/:id/edit` | Edit a node |
| `DELETE /api/v1/node/:id` | Delete a node |
| `GET /api/v1/root/:id` | Get tree data |
| `POST /api/v1/note/create` | Create a note |
| `GET /api/v1/contributions/:nodeId` | Audit trail |
| `POST /api/v1/understanding/run` | Run knowledge compression |

The WebSocket API (`/socket.io/`) handles real time chat and tree interaction.

## Canopy Protocol: How Lands Connect

The Canopy protocol is a set of REST endpoints under `/canopy/` that every Land implements. It handles identity, peering, invitations, and cross-land API access.

### Land Identity

On first boot, your Land generates:
- An **Ed25519 keypair** (stored in `.land/land.key` and `.land/land.key.pub`)
- A **Land ID** (UUID, stored in `.land/land.id`)

This identity is permanent. Never delete your `.land/` directory. If you change domains, use the redirect mechanism (`LAND_REDIRECT_TO` env var) so peers auto update.

### Peering

Two Lands connect by exchanging their public keys:

1. Land A calls `POST /canopy/admin/peer/add` with Land B's URL
2. Land A fetches Land B's `/canopy/info` (gets public key, domain, protocol version)
3. Land A sends its own info to Land B via `POST /canopy/peer/register`
4. Both Lands now have each other's public key. They can authenticate requests.

If a Directory Service is configured, Lands can also discover each other automatically. When you invite a user on an unknown domain, your Land checks the directory, finds the target land, and auto-peers.

### CanopyToken Authentication

All authenticated cross-land requests use a CanopyToken: a short lived (5 minute) JWT signed with the sending Land's Ed25519 private key.

```
Authorization: CanopyToken <signed-jwt>
```

The JWT payload contains:
- `sub`: the user's ID on the sending Land
- `iss`: the sending Land's domain
- `aud`: the target Land's domain
- `landId`: the sending Land's ID

The receiving Land verifies the signature against the sender's public key (from peering). This proves the request actually came from that Land and that the user ID is legitimate.

### Ghost Users

When a remote user is invited to a tree on your Land, your Land creates a **ghost user** record for them. This is a User document with `isRemote: true` and `homeLand` set to their home domain.

Ghost users:
- Have a UUID (the same one from their home Land)
- Are added to the tree's `contributors` array, just like local users
- Can only access trees they've been explicitly invited to
- Cannot log in, change settings, or do anything outside their contributor role
- Show up as `username@domain` in the UI

Ghost users are how the existing API works unchanged for remote users. Every route checks `req.userId` against `rootOwner` or `contributors`. Ghost users are in that array, so the existing permission checks just work. No special cases needed.

If someone causes problems, the tree owner removes them from contributors. If an entire Land is causing problems, the admin blocks that peer.

### Cross-Land API Proxy

When a local user interacts with a tree on a remote Land, the request goes through a proxy:

```
User's Frontend -> Home Land -> Tree's Land -> response back
```

The Home Land:
1. Authenticates the user normally (JWT cookie or API key)
2. Signs a CanopyToken for the user
3. Forwards the request to `POST /canopy/proxy/:domain/api/v1/node/create`
4. The proxy sends it to `https://other.land/api/v1/node/create` with the CanopyToken

The Tree's Land:
1. Sees the CanopyToken in the Authorization header
2. Verifies it against the sending Land's public key
3. Looks up the ghost user by the `sub` claim
4. Sets `req.userId` to the ghost user's ID
5. Runs the exact same route handler as for local users

The user's frontend never needs to know about Canopy. It just calls its home Land's API. The proxy is invisible.

### Energy Across Lands

When a remote user acts on your tree, your Land reports the energy cost back to their home Land via `POST /canopy/energy/report`. Their home Land deducts it from their balance.

Energy is a soft meter. If the home Land doesn't deduct, worst case is extra activity on your tree. The tree owner can always revoke access.

### Health Monitoring

Lands monitor their peers via periodic heartbeats (`GET /canopy/info` every 5 minutes). Status progression:

- **active**: responding normally
- **degraded**: missed 2+ heartbeats (restart, deploy, network blip)
- **unreachable**: down for hours
- **dead**: unreachable for 30+ days

Your trees are unaffected when a peer goes down. Remote trees on that peer become temporarily inaccessible until it returns.

### Canopy Endpoints

**Public (no auth):**

| Endpoint | Purpose |
|----------|---------|
| `GET /canopy/info` | Land identity, public key, protocol version, capabilities |
| `GET /canopy/redirect` | Domain redirect info (if land moved) |
| `GET /canopy/user/:username` | Resolve a local user by username |
| `GET /canopy/public-trees` | List public trees on this land |
| `POST /canopy/peer/register` | Register as a peer (mutual introduction) |

**Authenticated (require CanopyToken):**

| Endpoint | Purpose |
|----------|---------|
| `POST /canopy/invite/offer` | Notify about a cross-land invitation |
| `POST /canopy/invite/accept` | Confirm invite acceptance |
| `POST /canopy/invite/decline` | Confirm invite decline |
| `GET /canopy/tree/:rootId` | Read a tree as a remote contributor |
| `POST /canopy/energy/report` | Report energy usage to user's home land |
| `POST /canopy/notify` | Push notification to remote user's land |
| `POST /canopy/account/transfer-in` | Receive an account transfer |

**Admin (require local user auth):**

| Endpoint | Purpose |
|----------|---------|
| `POST /canopy/admin/peer/add` | Add a peer land by URL |
| `DELETE /canopy/admin/peer/:domain` | Remove a peer |
| `POST /canopy/admin/peer/:domain/block` | Block a peer |
| `POST /canopy/admin/peer/:domain/unblock` | Unblock a peer |
| `GET /canopy/admin/peers` | List all peers and status |
| `POST /canopy/admin/heartbeat` | Manually trigger heartbeat |
| `POST /canopy/admin/invite-remote` | Invite user by canopy ID (username@domain) |
| `GET /canopy/admin/events/failed` | View failed outbox events |
| `POST /canopy/admin/events/:eventId/retry` | Retry a failed event |
| `ALL /canopy/proxy/:domain/*` | Forward API call to remote land |
| `GET /canopy/admin/directory/lands` | Search directory for lands |
| `GET /canopy/admin/directory/trees` | Search directory for public trees |
| `POST /canopy/admin/peer/discover` | Auto-peer via directory lookup |

**Admin HTML pages (gated behind ENABLE_FRONTEND_HTML):**

| Page | Purpose |
|------|---------|
| `GET /canopy/admin` | Dashboard: land identity, peers, events |
| `GET /canopy/admin/invites` | Incoming invites, send invite form |
| `GET /canopy/admin/directory` | Search the directory for lands and public trees |

## Directory Service

The Directory Service is a separate, standalone application that acts as a phonebook for the network. Lands register with it so other Lands can find them.

**What it does:**
- Stores land registrations (domain, name, public key, public tree metadata)
- Allows searching for lands by name or domain
- Allows searching for public trees across all registered lands
- Pings registered lands periodically to track health

**What it does NOT do:**
- Route messages (Lands talk directly after peering)
- Store user data (user lookup goes land to land)
- Authenticate users (each Land handles its own auth)
- Act as a gateway (the directory is not in the request path)

**The directory is optional.** Lands work fully without it. You can peer manually by typing in URLs. The directory just makes discovery easier.

**If the directory goes down,** peered Lands keep working. Only new discovery is affected.

To connect to a directory, set `DIRECTORY_URL` in your `.env`. Your Land will auto-register on startup and re-register every hour.

## What You Can Customize

Everything behind the API is yours. Lands in the network can run completely different code internally as long as they speak the same API and Canopy protocol.

**Fully customizable per land:**
- AI models and LLM configuration (any OpenAI-compatible endpoint)
- Background job behavior (orchestrators, dream pipelines, cleanup strategies)
- Frontend and UI (build your own, use the server rendered HTML, or go headless)
- Energy limits and pricing
- Billing (Stripe integration or disable entirely)
- Gateway integrations (Discord, Telegram, etc.)
- Mode system and AI prompts
- Authentication extras (SSO, OAuth, etc. on top of the core auth)

**Must stay the same for network compatibility:**
- Canopy endpoint paths and response shapes
- CanopyToken JWT structure (Ed25519 signed, sub/iss/aud/landId payload)
- API endpoint paths and response shapes under `/api/v1/`
- Data model essentials (User.username, User.isRemote, Node.rootOwner, Node.contributors, Node.visibility, UUID primary keys)
- Protocol version number (only increment when the protocol changes)

## Security

- All cross-land requests are signed with Ed25519 keypairs (unforgeable identity)
- The tree's Land is always authoritative (controls permissions, validates access)
- A remote Land can only prove its users' identity, not grant itself permissions
- Ghost users can only access trees they were explicitly invited to
- Per-land and per-user rate limiting on all canopy endpoints
- Lands can block peers and remove remote contributors at any time
- Protocol versioning prevents incompatible Lands from communicating
- CanopyTokens expire after 5 minutes (prevents replay attacks)

## Configuration

All environment variables live in `.env` at the project root.

### Required

| Variable | Description | Default |
|----------|-------------|---------|
| `MONGODB_URI` | MongoDB connection string | `mongodb://localhost:27017` |
| `JWT_SECRET` | Signs user auth tokens. Change this. | `your_secret_key` |

### Land Identity

| Variable | Description | Default |
|----------|-------------|---------|
| `LAND_DOMAIN` | Your land's public domain | `localhost` |
| `LAND_NAME` | Display name for your land | `My Land` |
| `LAND_KEY_DIR` | Where to store the keypair | `.land` |
| `PORT` | Server port | `3000` |

### Network (optional)

| Variable | Description | Default |
|----------|-------------|---------|
| `DIRECTORY_URL` | Directory service for peer discovery | (none) |
| `LAND_REDIRECT_TO` | Domain redirect for land migrations | (none) |
| `LAND_DEFAULT_TIER` | Default energy tier for new users | `god` |
| `ENABLE_FRONTEND_HTML` | Toggle server rendered HTML pages | `true` |

### LLM

| Variable | Description | Default |
|----------|-------------|---------|
| `AI_MODEL` | Fallback LLM model name | `qwen3.5:27b` |
| `CUSTOM_LLM_API_SECRET_KEY` | Encrypts stored LLM API keys (32+ chars) | (none) |

LLM endpoints are configured per user through `CustomLlmConnection` records, not env vars. Users add their own connections via the app.

See `.env.example` for the complete list including email, Stripe, push notifications, and Solana configuration.

## Data Sovereignty

Your trees, your data. Everything stays on your Land unless you explicitly invite someone from another Land. Even then, the tree data stays on your Land. Remote users access it through the API. They do not get a copy.

Your Land ID (UUID) and keypair are permanent. If you move domains, the redirect mechanism preserves your identity. Your contributions and history remain linked across the network.

## Building a Custom Client

Your Land's API is standard REST + WebSocket. You can build any client on top of it. The Canopy protocol is also REST. Custom Land implementations can participate in the network as long as they implement the protocol endpoints and speak the same data shape.

The API is the network. Everything else is up to you.
