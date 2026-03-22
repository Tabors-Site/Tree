# TreeOS Extensions

Optional features built on top of the core TreeOS protocol. These are implemented by the reference land at treeos.ai but are not required for protocol compliance. Other lands MAY implement any combination of these extensions.

Extensions are advertised via the `extensions` array in `GET /protocol`.

## Energy System

Meters usage across all tree operations. Each action costs energy. Balance resets daily based on plan tier.

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/user/:userId/energy | Energy balance and reset time |

### Action Costs

| Action | Cost |
|--------|------|
| Edit (status, value, name, type, schedule) | 1 |
| Create node | 3 |
| Prestige (new version) | 2 |
| Run script | 2 |
| Notes | 1-5 (scales with length) |

### Plan Tiers

| Tier | Daily Energy |
|------|-------------|
| Basic | 350 |
| Standard | 1,500 |
| Premium | 8,000 |

## Billing (Stripe)

Plan upgrades and additional energy purchases via Stripe.

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/v1/user/:userId/purchase | Initiate Stripe checkout |

## Prestige / Versioning

Nodes can have multiple versions (prestige levels). Each prestige creates a new version with fresh values while archiving the previous one. Lands that implement prestige add versioned routes (`/:version/`) alongside the core versionless ones. The versionless routes always operate on the latest version.

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/v1/node/:nodeId/prestige | Create new version (latest) |
| POST | /api/v1/node/:nodeId/:version/prestige | Create new version (specific) |
| GET | /api/v1/node/:nodeId/:version | View specific version data |
| GET | /api/v1/node/:nodeId/:version/notes | Notes on specific version |
| GET | /api/v1/node/:nodeId/:version/values | Values on specific version |
| GET | /api/v1/node/:nodeId/:version/contributions | Contributions on specific version |

## Schedules

Nodes can be scheduled with a date and optional repeat interval.

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/v1/node/:nodeId/editSchedule | Set schedule (latest version). Body: `{ newSchedule, reeffectTime }` |
| POST | /api/v1/node/:nodeId/:version/editSchedule | Set schedule (specific version) |
| GET | /api/v1/root/:rootId/calendar | Scheduled nodes by date range |

## Scripts

Nodes can have attached JavaScript scripts that run in a sandboxed VM. Scripts can read and mutate the node's values, goals, status, and schedule.

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/node/:nodeId/script/:scriptId | View script |
| POST | /api/v1/node/:nodeId/script/create | Create script |
| POST | /api/v1/node/:nodeId/script/:scriptId/edit | Update script code |
| POST | /api/v1/node/:nodeId/script/:scriptId/execute | Run script |
| GET | /api/v1/node/:nodeId/scripts/help | Script API documentation |

## Book / Sharing

Export tree notes as a formatted document. Generate shareable links.

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/root/:rootId/book | Notes export |
| POST | /api/v1/root/:rootId/book/generate | Create share link |
| GET | /api/v1/root/:rootId/book/share/:shareId | View shared book (public) |

## Blog

Land-level blog system for posts and updates.

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/blog/posts | List posts |
| GET | /api/v1/blog/posts/:slug | Read post |
| POST | /api/v1/blog/posts | Create post (admin) |
| PUT | /api/v1/blog/posts/:slug | Update post (admin) |
| DELETE | /api/v1/blog/posts/:slug | Delete post (admin) |

## API Keys

User-managed API keys for programmatic access.

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/user/:userId/api-keys | List keys |
| POST | /api/v1/user/:userId/api-keys | Create key |
| DELETE | /api/v1/user/:userId/api-keys/:keyId | Revoke key |

## Land Configuration

Runtime configuration stored in system nodes. Managed by admin.

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/land/config | All config |
| GET | /api/v1/land/config/:key | Single value |
| PUT | /api/v1/land/config/:key | Set value (admin) |

## Dreams

Daily background maintenance cycle per tree. Runs cleanup (expand sparse branches, reorganize), drain (place deferred short-term memory items), and understanding (bottom-up compression).

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/v1/root/:rootId/dream-time | Set daily dream time. Body: `{ dreamTime: "HH:MM" }` |

How dreams are implemented internally (cleanup passes, drain pipeline, etc.) is up to the land.

## Understanding

Bottom-up compression of tree knowledge. Creates navigable summaries from a specified perspective.

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/root/:rootId/understandings | List runs |
| POST | /api/v1/root/:rootId/understandings | Start run. Body: `{ perspective, incremental }` |
| GET | /api/v1/root/:rootId/understandings/run/:runId | View run results |
| POST | /api/v1/root/:rootId/understandings/run/:runId/stop | Stop in-progress run |

## Raw Ideas

Unstructured capture (text or file). Ideas sit in a queue until auto-placed into the best tree by an AI agent or manually transferred.

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/user/:userId/raw-ideas | List ideas |
| POST | /api/v1/user/:userId/raw-ideas | Create idea (text or file upload) |
| DELETE | /api/v1/user/:userId/raw-ideas/:id | Delete idea |
| POST | /api/v1/user/:userId/raw-ideas/chat | Chat about ideas |
| POST | /api/v1/user/:userId/raw-ideas/place | Auto-place idea into tree |
| POST | /api/v1/user/:userId/raw-ideas/auto-place | Toggle auto-placement |
| POST | /api/v1/user/:userId/raw-ideas/:id/transfer | Move idea to note on node |

## Deleted Branches / Revive

Soft-deleted nodes can be listed and revived. Deletion sets `parent: "deleted"`. Revival restores the node under a new parent or as a new root tree.

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/user/:userId/deleted | List deleted branches |
| POST | /api/v1/user/:userId/deleted/:nodeId/revive | Revive under parent. Body: `{ targetParentId }` |
| POST | /api/v1/user/:userId/deleted/:nodeId/reviveAsRoot | Revive as new root tree |

## Per-User LLM Assignments

Profile-level LLM connections, separate from per-tree assignments in the core protocol. Users can set a default model and a raw-idea model.

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/user/:userId/custom-llm | List user LLM connections |
| POST | /api/v1/user/:userId/custom-llm | Create connection |
| DELETE | /api/v1/user/:userId/custom-llm/:connectionId | Delete connection |
| POST | /api/v1/user/:userId/llm-assign | Assign connection to slot. Body: `{ slot, connectionId }` |

## User Queries

User-level data access for notes, tags, contributions, chats, and notifications.

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/user/:userId/notes | All notes by user |
| GET | /api/v1/user/:userId/tags | Notes where user was @tagged |
| GET | /api/v1/user/:userId/contributions | User contribution audit log |
| GET | /api/v1/user/:userId/chats | AI chat history |
| GET | /api/v1/user/:userId/notifications | System notifications |
| GET | /api/v1/user/:userId/invites | Pending collaboration invites |
| POST | /api/v1/user/:userId/invites/:inviteId/accept | Accept invite |
| POST | /api/v1/user/:userId/invites/:inviteId/deny | Reject invite |

## Solana Wallets

On-chain value integration. Each node version can have a Solana wallet for native token operations.

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/node/:nodeId/values/solana | Wallet info and balances |
| POST | /api/v1/node/:nodeId/values/solana | Create wallet for version |
| POST | /api/v1/node/:nodeId/values/solana/send | Send SOL. Body: `{ to, amount }` |
| POST | /api/v1/node/:nodeId/values/solana/transaction | Swap tokens |

## Tree Visibility

Control whether a tree is publicly discoverable via Canopy.

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/v1/root/:rootId/visibility | Set public/private. Body: `{ visibility }` |

## Transaction Policy

Per-tree policy for who can propose transactions.

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/v1/root/:rootId/transaction-policy | Set policy. Body: `{ policy }` |

## HTML Rendering

Any GET endpoint MAY return server-rendered HTML when `?html` query parameter is present and the land has `ENABLE_FRONTEND_HTML=true`. This is a presentation extension, not part of the data protocol.
