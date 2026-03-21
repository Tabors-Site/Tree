# TreeOS Land Node

A self-hosted node in the TreeOS distributed network. Each Land is a standalone server that hosts trees for its local users, runs its own AI and background jobs, and can connect to other Lands through the Canopy protocol.

## What is a Land?

A Land is a single instance of the TreeOS application. Your own server with your own database, your own users, and your own trees. Lands can operate completely independently, or they can connect to the wider TreeOS network to enable cross-land collaboration.

Think of it like email. Your Land is your mail server. You can send and receive with anyone on any other server, but your data lives on yours.

## Naming

```
Tree        A single knowledge structure
Land        The server where trees grow (one deployment, one database)
Canopy      The protocol connecting lands together

Coming Soon:
Forest      A curated group of trees from any land (user concept)
Mycelium    The underground network linking trees within or across lands
```

## Quick Start

```bash
# Clone the repo
git clone <repo-url> treeos-land
cd treeos-land

# Configure your land
cp .env.example .env
# Edit .env: set LAND_DOMAIN to your domain (or leave as localhost for local use)

# Install dependencies
npm run install:all

# Start your land
npm start
```

That's it. Your land is running. Point it at a MongoDB instance and you have the full TreeOS application.

## What You Get

- The full TreeOS application served directly from the land server (no separate build needed)
- AI powered tree management with your own LLM connections (defaults to local Ollama)
- Background jobs: tree dreaming, raw idea placement, short term memory drain, understanding runs
- WebSocket real time chat and tree interaction
- Gateway integrations (Discord, Telegram)
- No artificial energy limits on self-hosted lands

## Project Structure

```
treeos-land/
  .env                  # single config file for the whole project
  package.json          # root scripts (npm start, npm run build, etc.)
  land/                 # the Land server (this is the app)
  site/                 # optional static site (landing page, about page)
  directory/            # Canopy Directory Service (separate standalone service)
```

**The land folder is the app.** It serves the full TreeOS UI as server rendered HTML, handles the REST API, runs WebSocket connections, executes AI tool calls, and manages background jobs. Everything you need to run a Land is in `land/`.

**The site folder is optional.** It is a React + Vite static site for landing pages and about pages. You do not need to build or deploy it. Your Land works completely without it. If you want a marketing site or custom landing page, you can build it with `npm run build`, but it has nothing to do with the core TreeOS functionality.

**The directory folder is a separate service.** It is the Canopy Directory, a standalone phonebook that lands register with for peer discovery. You only need to run this if you are hosting the central directory for the network.

### Land Layout

```
land/
  server.js               # entry point
  routes/
    api/                   # REST JSON endpoints (nodes, notes, users, values, etc.)
    html/                  # TreeOS app UI (server rendered pages, gated behind ENABLE_FRONTEND_HTML)
    canopy.js              # Canopy protocol endpoints
    users.js               # Auth routes (login, register, forgot password)
    setup.js               # Onboarding flow
    billing/               # Stripe purchase and webhook
  routesURL/               # Legacy route handlers (being migrated to routes/)
  ws/                      # WebSocket server (real time chat and tree interaction)
  mcp/                     # MCP server (AI tool execution)
  jobs/                    # background jobs (dreams, drain, understanding, cleanup)
  canopy/                  # land identity, peering, proxy, event outbox
  core/                    # shared business logic
  db/                      # Mongoose models and config
  middleware/              # auth, rate limiting
```

### Root Scripts

| Command | What It Does |
|---------|-------------|
| `npm start` | Runs the land server (`node server.js`) |
| `npm run build` | Builds the optional site (`vite build`) |
| `npm run dev:site` | Runs the Vite dev server for the site |
| `npm run install:all` | Installs dependencies in both land and site |

## Configuration

All environment variables live in a single `.env` file at the project root.

### Required

| Variable | Description | Default |
|----------|-------------|---------|
| `LAND_DOMAIN` | Your land's public domain | `localhost` |
| `MONGODB_URI` | MongoDB connection string | `mongodb://localhost:27017` |

### Optional

| Variable | Description | Default |
|----------|-------------|---------|
| `LAND_NAME` | Display name for your land | `My Land` |
| `DIRECTORY_URL` | Directory service for peer discovery (coming soon) | (none, manual peering) |
| `LAND_DEFAULT_TIER` | Default energy tier for new users | `god` |
| `PORT` | Server port | `3000` |

See `.env.example` for the full list.

## Canopy Protocol

Your Land can connect to other Lands in the TreeOS network. The Canopy protocol is how lands communicate. It is a REST API contract, a set of HTTP endpoints that every land implements to participate in the network.

Connection is opt in. Your Land works fully standalone without it.

### How It Works

- Each Land has a unique identity (domain + Ed25519 cryptographic keypair, generated on first boot)
- Lands communicate via signed HTTP requests
- Users are identified as `username@landdomain` across the network
- Trees always live on the Land where they were created (the owner's Land is authoritative)
- Remote users access trees through their home Land, which proxies requests to the tree's Land
- Each Land runs its own AI, its own background jobs, and manages its own users' energy

### Connecting to the Network

1. Set `LAND_DOMAIN` to your public domain in `.env`
2. Add a peer land directly:

```
POST /canopy/admin/peer/add
{ "url": "https://other-land.example.com" }
```

3. Both lands exchange public keys and can now communicate
4. Users on either land can invite each other to collaborate on trees

### Cross-Land Collaboration

When a user on another Land invites you to their tree:

1. You see the invite on your Land
2. You accept it
3. The tree appears in your tree list alongside your local trees
4. All interaction goes through your Land's API (proxied to the tree's Land behind the scenes)
5. You don't need to know or care which Land the tree lives on

### Security

- All inter-land requests are signed with Ed25519 keypairs
- The tree's Land is always the authority (controls permissions, validates access)
- A remote Land can only prove its users' identity, not grant itself permissions
- Protocol versioning ensures compatible Lands communicate correctly
- Per-land and per-user rate limiting on all canopy endpoints
- Lands can block peers and remove remote contributors at any time

## Canopy API Reference

The canopy protocol endpoints. Any implementation that speaks this protocol can participate in the network.

### Public Endpoints (no auth)

| Endpoint | Purpose |
|----------|---------|
| `GET /canopy/info` | Land metadata, public key, protocol version |
| `GET /canopy/redirect` | Domain redirect info (if land moved) |
| `GET /canopy/user/:username` | Resolve a local user by username |
| `GET /canopy/public-trees` | List public trees on this land |
| `POST /canopy/peer/register` | Register as a peer (mutual introduction) |

### Authenticated Endpoints (require CanopyToken)

| Endpoint | Purpose |
|----------|---------|
| `POST /canopy/invite/offer` | Notify about a cross-land invitation |
| `POST /canopy/invite/accept` | Confirm invite acceptance |
| `POST /canopy/invite/decline` | Confirm invite decline |
| `GET /canopy/tree/:rootId` | Access a tree as a remote contributor |
| `POST /canopy/energy/report` | Report energy usage to user's home land |
| `POST /canopy/notify` | Push notification to remote user's land |
| `POST /canopy/account/transfer-in` | Receive an account transfer |

### Admin Endpoints (require local user auth)

| Endpoint | Purpose |
|----------|---------|
| `POST /canopy/admin/peer/add` | Add a peer land by URL |
| `DELETE /canopy/admin/peer/:domain` | Remove a peer |
| `POST /canopy/admin/peer/:domain/block` | Block a peer |
| `POST /canopy/admin/peer/:domain/unblock` | Unblock a peer |
| `GET /canopy/admin/peers` | List all peers and status |
| `POST /canopy/admin/heartbeat` | Manually trigger heartbeat check |
| `POST /canopy/admin/invite-remote` | Invite a user from another land |
| `GET /canopy/admin/events/failed` | View failed outbox events |
| `POST /canopy/admin/events/:eventId/retry` | Retry a failed event |

All requests between lands use this header format:

```
Authorization: CanopyToken <signed-jwt>
```

The JWT is signed with the sending Land's Ed25519 private key and verified by the receiving Land using the sender's public key (exchanged during peering).

## Health and Monitoring

Lands monitor their peers via periodic heartbeats (`GET /canopy/info` every 5 minutes). Status progression:

- **active** . responding normally
- **degraded** . missed a few heartbeats (restart, deploy)
- **unreachable** . down for hours
- **dead** . unreachable for 30+ days, delisted from directory

Your trees are unaffected when a peer goes down. Remote trees on that peer are temporarily inaccessible until it comes back.

## Building a Custom Client

The TreeOS app UI is server rendered from the land server. But your Land's API is standard REST + WebSocket, so you can build any client you want on top of it. The canopy protocol is also REST, so custom land implementations can participate in the network as long as they implement the protocol endpoints.

## Data Sovereignty

Your trees, your data. Everything stays on your Land unless you explicitly invite someone from another Land. Even then, the tree data stays on your Land. Remote users access it through the API, they don't get a copy.

If you want to move your trees to a different Land, the export/import feature lets you migrate your data. Your UUID stays the same across the network, so your contributions and history remain linked.
