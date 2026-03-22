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

Nodes can have multiple versions (prestige levels). Each prestige creates a new version with fresh values while archiving the previous one.

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/v1/node/:nodeId/:version/prestige | Create new version |

## Schedules

Nodes can be scheduled with a date and optional repeat interval.

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/v1/node/:nodeId/:version/editSchedule | Set schedule. Body: `{ newSchedule, reeffectTime }` |
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

## HTML Rendering

Any GET endpoint MAY return server-rendered HTML when `?html` query parameter is present and the land has `ENABLE_FRONTEND_HTML=true`. This is a presentation extension, not part of the data protocol.
