# Schema Flatten Work In Progress

## STATUS: Node schema flat. User schema flat. All imports clean. Not committed yet. Needs review + migration + boot test.

## Node Schema (DONE, committed)
- Removed `prestige`, `versions` from Node model
- Status is top-level: `node.status`
- Extension data in `metadata` Map
- Values extension stores in `metadata.values` / `metadata.goals`
- Schedules extension stores in `metadata.schedule` / `metadata.reeffectTime`
- Prestige extension stores in `metadata.prestige`
- Hook system (8 hooks) wired into core lifecycle
- Migration at `land/migrations/flattenSchema.js` (already ran)

## User Schema (IN PROGRESS, not committed)

### What stayed on schema (core)
- `_id`, `username`, `email`, `password`
- `htmlShareToken`, `resetPasswordToken`, `resetPasswordExpiry`
- `roots`, `recentRoots`, `remoteRoots`
- `profileType` (access level, core auth)
- `planExpiresAt` (tied to profileType)
- `isRemote`, `homeLand` (federation)
- `metadata` (Map, same pattern as Node)

### What moved to metadata (extension data)
| Old field | New metadata path | Extension |
|-----------|------------------|-----------|
| `apiKeys` (array) | `metadata.apiKeys` | api-keys |
| `availableEnergy` | `metadata.energy.available` | energy |
| `additionalEnergy` | `metadata.energy.additional` | energy |
| `storageUsage` | `metadata.energy.storageUsage` | energy |
| `llmAssignments` | `metadata.userLlm.assignments` | user-llm |
| `rawIdeaAutoPlace` | `metadata.rawIdeas.autoPlace` | raw-ideas |

### How it works (virtuals)
Mongoose virtual getters/setters on the User model proxy reads/writes to metadata.
`user.availableEnergy` still works on Mongoose documents. Code that does
`user.availableEnergy.amount -= cost` works because the virtual getter returns
the metadata object.

### Known limitation: `.lean()` queries
`.lean()` returns plain objects without virtuals. Code that does
`User.findById(id).select("availableEnergy").lean()` won't work.
Fixed by either:
1. Removing `.lean()` (virtuals work)
2. Selecting `metadata` and reading from it directly

### Files modified (not committed)
| File | Change |
|------|--------|
| `db/models/user.js` | Removed fields, added metadata Map, added virtual proxies |
| `routes/api/me.js` | Uses `getEnergy()` helper, selects metadata |
| `routes/api/user.js` | Removed `.lean()` so virtuals work |
| `middleware/authenticate.js` | API key query uses `metadata.apiKeys.*` paths |
| `middleware/urlAuth.js` | Same API key path fix |
| `extensions/energy/routes.js` | Removed `.lean()` |
| `extensions/api-keys/routes.js` | Selects `metadata` instead of `apiKeys` |
| `core/users.js` | API key revoke uses Mongoose save instead of atomic $set |
| `core/tree/notes.js` | `$inc` uses `metadata.energy.storageUsage` path |
| `extensions/raw-ideas/core.js` | Same storageUsage path fix |
| `ws/conversation.js` | LLM assignments read from `metadata.userLlm.assignments` |

### Migration script
`land/migrations/flattenUserSchema.js`
Moves apiKeys, energy, llmAssignments, rawIdeaAutoPlace to metadata.
Does NOT move profileType or planExpiresAt (they stay on schema).

### What still needs checking
- HTML renderers that display energy/apiKeys/profileType (most use Mongoose docs, should work via virtuals)
- `preUploadCheck.js` middleware reads energy
- Any `User.findByIdAndUpdate` with `$set` on moved fields needs path update
- The index on `apiKeys.keyPrefix` needs to become `metadata.apiKeys.keyPrefix`
- Billing extension's processPurchase/validatePurchase read user fields

### Helper file
`core/tree/userMetadata.js` has convenience functions:
- `getUserMeta(user, key)` / `setUserMeta(user, key, data)`
- `getProfileType(user)`, `getEnergy(user)`, `getApiKeys(user)`
- `getUserLlmAssignments(user)`, `getRawIdeaAutoPlace(user)`
