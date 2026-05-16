# DO Actions

The DO verb mutates the world. This document catalogs the kernel-named actions and specifies the generic `set-meta` action that all extension data writes flow through.

Read [protocol.md](protocol.md) first.

## Action shape

Every DO carries one of two forms, depending on whether the requester's embodiment matters for authorization:

```
{
  verb:     "do",
  action:   "<action name>",
  position: "<position>",        // common form: identity-level authorization
  identity: <token>,
  payload:  <action-specific>
}

{
  verb:     "do",
  action:   "<action name>",
  stance:   "<stance>",          // role-explicit form: stance carries requester's embodiment
  identity: <token>,
  payload:  <action-specific>
}
```

Exactly one of `position` or `stance` is present. The two forms differ only in whether the requester's embodiment is named for authorization purposes.

**The mutation always lands at the position.** A note written via `stance: "treeos.ai/foo@ruler"` lands at the position `treeos.ai/foo`, exactly the same as one written via `position: "treeos.ai/foo"`. The embodiment in `stance` never affects WHERE the mutation goes.

**The embodiment in `stance` affects WHAT is permitted.** An `archivist` stance may not be allowed to delete nodes; a `ruler` stance may. A `worker` stance may write notes only on its assigned leaves; a `ruler` stance may write anywhere in its scope. The kernel resolves the active role from the embodiment in `stance` (combined with the identity) and checks per-action permission.

**Use `position`** (no embodiment) when basic identity-level authorization is sufficient. A user acting from their default role (owner of their home tree, contributor of a tree they were invited to) sends `position` without specifying a role.

**Use `stance`** (with embodiment) when:
- The identity holds multiple roles at the same place and the user wants to act as one of them specifically.
- The action is restricted in some roles and permitted in others.
- The action's audit trail should record which role performed it.

Action names are kebab-case strings. Payload shape varies per action; this document specifies each.

## Two categories

**Kernel-named structural actions.** Operations the kernel knows about by name. These manipulate node structure, identity-relevant state, or land-level configuration. Listed in this document.

**Generic extension actions.** `set-meta` and `clear-meta`. Every extension uses these to write into its metadata namespace. Extensions do not mint their own DO action names.

The line: if it touches the Node schema's structural fields (`name`, `parent`, `status`, `visibility`, `contributors`, etc.) or land-level config or land-level extension state, it is kernel-named. If it touches `metadata.<extensionName>`, it is `set-meta` or `clear-meta`.

## Kernel-named actions

### Node CRUD

#### create-child

Creates a child node under the address position.

```
{ verb: "do", action: "create-child", position: "<parent position>", identity, payload: { name, type? } }
```

- `name` (required): string, kebab-case, unique among siblings.
- `type` (optional): node type identifier; defaults to "leaf".

Returns: `{ nodeId, address }` for the new child.

Errors: `INVALID_INPUT` (name conflicts or invalid), `FORBIDDEN` (not authorized to create at this position).

#### rename

Renames the node at the address.

```
{ verb: "do", action: "rename", position: "<position>", identity, payload: { name } }
```

Returns: `{ address }` (new address reflecting the rename).

#### move

Reparents the node at the address.

```
{ verb: "do", action: "move", position: "<position>", identity, payload: { newParent: "<position>" } }
```

Returns: `{ address }` (new address under the new parent).

Side effects: all five resolution chains (extension scope, tool scope, mode resolution, LLM connection, LLM config) shift to reflect the new ancestor chain. The `afterNodeMove` hook fires.

#### delete

Marks the node at the address as deleted.

```
{ verb: "do", action: "delete", position: "<position>", identity, payload: { force?: boolean } }
```

`force` bypasses extension role guards. Without it, nodes carrying any extension's `metadata.<ext>.role` cannot be deleted.

Returns: `{ deleted: true }` or rejects with `FORBIDDEN` if role guard blocks.

### Status

#### change-status

Sets the node's status.

```
{ verb: "do", action: "change-status", position: "<position>", identity, payload: { status, isInherited?: boolean } }
```

`status` is one of the registered status values (kernel: active, completed, trimmed; extensions may register more via the status registry).

### Notes

#### write-note

Creates a note at the address position.

```
{ verb: "do", action: "write-note", position: "<position>", identity, payload: { content, contentType? } }
```

`content` is the note body (string or binary depending on contentType). `contentType` defaults to `text/markdown`.

Returns: `{ noteId, address }`.

#### edit-note

Updates the content of an existing note.

```
{ verb: "do", action: "edit-note", position: "<position>/notes/<noteId>", identity, payload: { content } }
```

The kernel writes a new version under `note.history` and updates the current content.

#### delete-note

Removes a note from a node.

```
{ verb: "do", action: "delete-note", position: "<position>/notes/<noteId>", identity, payload: {} }
```

#### upload-artifact

Uploads a file artifact to the address position.

```
{ verb: "do", action: "upload-artifact", position: "<position>", identity, payload: { kind, name, contentType, bytes } }
```

`bytes` is base64-encoded for the WebSocket transport. Large uploads should chunk; the protocol supports `payload.chunkOf` for multi-frame uploads (see [server-protocol.md](server-protocol.md)).

Returns: `{ artifactId, position: "<position>/artifacts/<artifactId>" }`.

### Team and access

#### invite

Invites a user to the tree rooted at the address.

```
{ verb: "do", action: "invite", position: "<root position>", identity, payload: { user: <username or username@land> } }
```

Cross-land invites use `username@land`. The invite system handles delivery.

#### accept-invite

Accepts a pending invite.

```
{ verb: "do", action: "accept-invite", position: "<root position>", identity, payload: { inviteId } }
```

#### revoke

Removes a contributor from a tree.

```
{ verb: "do", action: "revoke", position: "<root position>", identity, payload: { user } }
```

#### transfer-owner

Transfers root ownership.

```
{ verb: "do", action: "transfer-owner", position: "<root position>", identity, payload: { user } }
```

Requires current owner identity. Side effects: `afterOwnershipChange` hook fires.

### Visibility

#### set-visibility

Sets the visibility of a node.

```
{ verb: "do", action: "set-visibility", position: "<position>", identity, payload: { visibility: "public" | "private" | "shared" } }
```

### Extensions

#### install-extension

Installs an extension to the land.

```
{ verb: "do", action: "install-extension", position: "<land>/", identity, payload: { name, version?, manifest?, files: [{ path, content }] } }
```

Requires `isAdmin` identity. Writes the extension files to disk; the extension is not loaded until restart.

#### enable-extension / disable-extension / uninstall-extension

```
{ verb: "do", action: "enable-extension",  position: "<land>/", identity, payload: { name } }
{ verb: "do", action: "disable-extension", position: "<land>/", identity, payload: { name } }
{ verb: "do", action: "uninstall-extension", position: "<land>/", identity, payload: { name, force?: boolean } }
```

#### publish-extension

Publishes an installed extension to the Horizon registry.

```
{ verb: "do", action: "publish-extension", position: "<land>/", identity, payload: { name, tags?, readme?, repoUrl?, maintainers?, releaseNotes? } }
```

#### scope-extension

Allows or blocks an extension at a specific node position. Walks the inheritance chain.

```
{ verb: "do", action: "scope-extension", position: "<position>", identity, payload: { name, scope: "allow" | "block" | "unallow" | "unblock" } }
```

### Config

#### set-config

Writes a land-level configuration key.

```
{ verb: "do", action: "set-config", position: "<land>/", identity, payload: { key, value } }
```

Requires `isAdmin` identity. Some keys are restricted; the land's config registry defines per-key permissions.

### LLM

#### set-llm-connection

Registers a custom LLM connection on the identity's user record.

```
{ verb: "do", action: "set-llm-connection", position: "<user position>", identity, payload: { name, baseUrl, model, apiKey? } }
```

#### remove-llm-connection

```
{ verb: "do", action: "remove-llm-connection", position: "<user position>", identity, payload: { connectionId } }
```

#### assign-llm-slot

Assigns a connection to an LLM slot on a node or user.

```
{ verb: "do", action: "assign-llm-slot", position: "<position>", identity, payload: { slot, connectionId } }
```

### Tree-wide ops

These act on the tree rooted at the address. They are kernel-named because they touch many nodes structurally.

#### compress

```
{ verb: "do", action: "compress", position: "<root position>", identity, payload: { budget?: number } }
```

#### prune

```
{ verb: "do", action: "prune", position: "<root position>", identity, payload: { cutoffDays?: number, dryRun?: boolean } }
```

#### split

```
{ verb: "do", action: "split", position: "<root position>", identity, payload: { criteria, dryRun?: boolean } }
```

#### reroot

```
{ verb: "do", action: "reroot", position: "<root position>", identity, payload: { newRoot: "<position>" } }
```

## Generic extension actions

All extension data writes use `set-meta` and `clear-meta`. The kernel routes these through `setExtMeta`/`getExtMeta` which enforce namespace isolation.

### set-meta

Writes data into the extension's metadata namespace at the address position.

```
{ verb: "do", action: "set-meta", position: "<position>", identity, payload: { extension, data, merge?: boolean } }
```

- `extension` (required): the extension's name (must match an installed extension).
- `data` (required): the object to write into `metadata[extension]`.
- `merge` (optional, default true): when true, performs a shallow merge with existing data. When false, replaces the namespace contents.

The kernel enforces that the requesting identity is authorized to write at this position and that the extension is allowed at this position (scope check).

Returns: `{ written: true }`.

### clear-meta

Removes keys from the extension's metadata namespace.

```
{ verb: "do", action: "clear-meta", position: "<position>", identity, payload: { extension, keys?: [<string>] } }
```

If `keys` is omitted, the entire namespace is cleared.

Returns: `{ cleared: true }`.

## What an extension does, in DO terms

An extension that today exposes `POST /api/v1/node/:nodeId/values { value, amount }` migrates to:

```
{ verb: "do", action: "set-meta", position: "<position>", identity, payload: { extension: "values", data: { value, amount }, merge: true } }
```

No new route. No new action name. The extension's logic for handling the write moves into:
- A hook on `afterMetadataWrite` listening for its namespace, OR
- A wrapper helper the extension exposes in its `init.exports` for convenience

The kernel does the dispatching. The extension does the reacting.

## What about complex extension operations?

Extensions sometimes have multi-step or computed operations (e.g., the `prune` extension's "scan stale branches" produces a list, not a metadata write). These are NOT `set-meta`. They are kernel-named DO actions if they manipulate node structure, OR they are exposed via TALK to a being-shaped extension surface.

Example: the `prune` action is kernel-named because it deletes nodes. Its "scan only" mode is `{ action: "prune", payload: { dryRun: true } }` returning the candidate list without mutation.

Example: an extension that wants to expose a tool the AI can use does NOT add a DO action; it registers a tool through the existing tool registry. The AI invokes the tool during a summoning; that is not a DO from the user's side.

## Authorization

Every DO is authorized at the land. The chain:

1. Identity must be valid (`UNAUTHORIZED` if not).
2. Identity must have write access at the address (`FORBIDDEN` if not).
3. For kernel-named actions: the action must be permitted for this identity at this position. Some actions (`install-extension`, `set-config`) require `isAdmin`.
4. For `set-meta`: the extension must be allowed at the address (scope check). Blocked extensions cannot have their metadata written.

Hooks `beforeNodeCreate`, `beforeNote`, `beforeContribution`, `beforeStatusChange`, `beforeNodeDelete` continue to fire as today. Extensions can gate DO actions through these hooks.

## Errors

See [protocol.md](protocol.md) for the full error vocabulary. The codes DO most commonly returns:

| Code | When |
|---|---|
| `INVALID_INPUT` | action payload does not match schema (missing field, wrong type, etc.) |
| `INVALID_STATUS` | change-status with an unrecognized value |
| `INVALID_TYPE` | create-child with an unrecognized node type |
| `ACTION_NOT_SUPPORTED` | unknown action name, or action not permitted at this position |
| `ADDRESS_PARSE_ERROR` | the address field could not be parsed |
| `EMBODIMENT_UNAVAILABLE` | qualifier in the address is not invocable here for this identity |
| `UNAUTHORIZED` | identity missing or invalid |
| `FORBIDDEN` | identity not authorized for this action at this address |
| `NODE_NOT_FOUND` | address does not resolve to a node |
| `EXTENSION_BLOCKED` | set-meta to a blocked extension at this position |
| `EXTENSION_NOT_FOUND` | set-meta to an uninstalled extension |
| `RESOURCE_CONFLICT` | action's preconditions not met (e.g., delete on a role-bearing node without force) |
| `UPLOAD_TOO_LARGE` | upload-artifact bytes exceed configured limit |
| `UPLOAD_MIME_REJECTED` | upload-artifact content type not accepted |
| `UPLOAD_DISABLED` | uploads disabled on this land |
| `DOCUMENT_SIZE_EXCEEDED` | payload exceeds size budget |
| `RATE_LIMITED` | throttled |
| `TIMEOUT` | action timed out internally |
| `INTERNAL` | server error during the mutation |

## See also

- [protocol.md](protocol.md) the four-verb spec
- [server-protocol.md](server-protocol.md) wire-level rules for the do op
- [stance-descriptor.md](stance-descriptor.md) the SEE response that reflects DO mutations
