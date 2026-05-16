# DO Actions

The DO verb mutates the world. **All DO actions target positions.** Position data has many namespaces; different actions modify different parts of it. This document catalogs the actions.

Read [protocol.md](protocol.md) first.

## What DO acts on

Everything in TreeOS reduces to: positions have data. The data has namespaces. DO mutates position data through one of these channels:

- **Structural fields** of the Node schema: `name`, `parent`, `status`, `visibility`, `contributors`. These are kernel-known and changed through named actions (`rename`, `move`, `change-status`, etc.).
- **Position-level content**: notes, file artifacts. Changed through named actions (`write-note`, `edit-note`, `upload-artifact`).
- **Namespaced metadata** in `metadata.<namespace>`. Many kinds:
  - extension namespaces (`metadata.values`, `metadata.codebook`, ...) carry extension-specific data.
  - embodiment namespaces (`metadata.ruler`, `metadata.archivist`, ...) carry embodiment configuration: system instructions, tools, permissions. When an embodiment is summoned at this position, the summoning reads its configuration from this namespace.
  - kernel-aware namespaces (`metadata.modes`, `metadata.tools`, `metadata.scope`, `metadata.inbox`) carry first-class protocol state.

  All namespaces are written through the same `set-meta` action. The namespace's name is in the payload.
- **Inbox writes**, technically a kind of namespaced metadata, but happen through **TALK** rather than DO. TALK is its own verb because it triggers summoning; DO would not.
- **Land-level operations** (install/disable/uninstall extensions, set-config, publish to Horizon). Same DO grammar, addressed at the Land Position (`<land>/`).

Embodiments are not data targets. They are active instances, summoned on demand to read position data and act. The "programming" of an embodiment is just position data in the embodiment's namespace. There is no separate embodiment-tier of addressing; the only target is the position.

## Address shape

Every DO carries one form. `position` is the only address field.

```
{
  verb:     "do",
  action:   "<action name>",
  position: "<position>",
  identity: <token>,
  payload:  <action-specific>
}
```

DO accepts `position` only. There is no `stance` form. The world is data at positions; embodiments are not data targets. If authorization checks need to know the requester's embodiment, they read it from the identity token, not from the address.

Action names are kebab-case strings. Payload shape varies per action; this document specifies each.

## Action catalog

The kernel mints the primitives below. Extensions can register additional named DO actions on top (see "Extension-registered DO actions" further down). The primitives are grouped by what part of position data they modify.

### Structural actions

Mutate fields on the Node schema (`name`, `parent`, `status`, `visibility`, `rootOwner`, `contributors`). Kernel-known because each has specific validation and side-effect semantics.

#### create-child

Creates a child node under the address position.

```
{ verb: "do", action: "create-child", position: "<parent position>", identity, payload: { name, type? } }
```

- `name` (required): string, kebab-case, unique among siblings.
- `type` (optional): node type identifier; defaults to "leaf".

Returns: `{ nodeId, name, position }` for the new child.

#### rename

Renames the node at the address. Writes `Node.name`.

```
{ verb: "do", action: "rename", position: "<position>", identity, payload: { name } }
```

Returns: `{ nodeId, name }`.

#### move

Reparents the node at the address. Writes `Node.parent`. Side effects: all five resolution chains (extension scope, tool scope, mode resolution, LLM connection, LLM config) shift to reflect the new ancestor chain. The `afterNodeMove` hook fires.

```
{ verb: "do", action: "move", position: "<position>", identity, payload: { newParent: "<position>" } }
```

Returns: `{ nodeId, position }` (new address under the new parent).

#### delete

Marks the node at the address as deleted.

```
{ verb: "do", action: "delete", position: "<position>", identity, payload: { force?: boolean } }
```

`force` bypasses extension role guards. Without it, nodes carrying any extension's `metadata.<ext>.role` cannot be deleted.

Returns: `{ deleted: true }`.

#### change-status

Writes `Node.status`. Value must be a registered status (kernel: `active`, `completed`, `trimmed`; extensions may register more via the status registry).

```
{ verb: "do", action: "change-status", position: "<position>", identity, payload: { status, isInherited?: boolean } }
```

Returns: `{ nodeId, status }`.

#### set-visibility

Writes `Node.visibility`.

```
{ verb: "do", action: "set-visibility", position: "<position>", identity, payload: { visibility: "public" | "private" | "shared" } }
```

#### transfer-owner

Writes `Node.rootOwner`. Requires current owner identity. The `afterOwnershipChange` hook fires.

```
{ verb: "do", action: "transfer-owner", position: "<Land Position>", identity, payload: { user } }
```

#### invite

Adds a user to `Node.contributors` on the tree root. Cross-land invites use `username@land`. The invite system handles delivery.

```
{ verb: "do", action: "invite", position: "<Land Position>", identity, payload: { user } }
```

#### accept-invite

Confirms a pending invite. Adds the requester to `Node.contributors`.

```
{ verb: "do", action: "accept-invite", position: "<Land Position>", identity, payload: { inviteId } }
```

#### revoke

Removes a user from `Node.contributors`.

```
{ verb: "do", action: "revoke", position: "<Land Position>", identity, payload: { user } }
```

### Position-level content

Notes (stored in the Note collection, attached to positions by nodeId) and file artifacts.

#### write-note

Creates a note at the position.

```
{ verb: "do", action: "write-note", position: "<position>", identity, payload: { content, contentType? } }
```

`content` is the note body (string or binary depending on contentType). `contentType` defaults to `text/markdown`.

Returns: `{ noteId, position }`.

#### edit-note

Updates the content of an existing note. The kernel writes a new version under `note.history` and updates the current content.

```
{ verb: "do", action: "edit-note", position: "<position>/notes/<noteId>", identity, payload: { content } }
```

#### delete-note

```
{ verb: "do", action: "delete-note", position: "<position>/notes/<noteId>", identity, payload: {} }
```

#### upload-artifact

Uploads a file artifact at the position.

```
{ verb: "do", action: "upload-artifact", position: "<position>", identity, payload: { kind, name, contentType, bytes } }
```

`bytes` is base64-encoded for the WebSocket transport. Large uploads should chunk; the protocol supports `payload.chunkOf` for multi-frame uploads (see [server-protocol.md](server-protocol.md)).

Returns: `{ artifactId, position: "<position>/artifacts/<artifactId>" }`.

### Namespaced metadata

Writes to `metadata.<namespace>` on the Node document. The same action shape covers every kind of namespace: extension data, embodiment configuration, kernel-aware namespaces (`modes`, `tools`, `scope`).

#### set-meta

Writes data into a metadata namespace at the position.

```
{ verb: "do", action: "set-meta", position: "<position>", identity, payload: { namespace, data, merge?: boolean } }
```

- `namespace` (required): the namespace key. Examples:
  - An extension name: `"values"`, `"codebook"`, `"governance"`. Writes the extension's data.
  - An embodiment name: `"ruler"`, `"archivist"`, `"<custom-embodiment>"`. Writes that embodiment's configuration at this position. When the embodiment is summoned here, the summoning reads from this namespace.
  - A kernel-aware namespace: `"modes"`, `"tools"`, `"scope"`. Writes first-class protocol state.
- `data` (required): the object to write into `metadata[namespace]`.
- `merge` (optional, default true): when true, performs a shallow merge with existing data. When false, replaces the namespace contents.

The kernel enforces:
- Reserved namespace names cannot be written through this action (the kernel owns them: `inbox` for example, which is written through TALK).
- For extension namespaces: the extension must not be blocked at this position (scope check).
- The requesting identity must be authorized to write to this namespace at this position. Authorization is action+namespace-keyed: writing `metadata.ruler` may require ruler-level role; writing `metadata.values` may only require contributor role.

Returns: `{ written: true, nodeId, namespace }`.

#### clear-meta

Removes keys from a metadata namespace (or the whole namespace if `keys` is omitted).

```
{ verb: "do", action: "clear-meta", position: "<position>", identity, payload: { namespace, keys?: [<string>] } }
```

Returns: `{ cleared: true, nodeId, namespace }`.

#### scope-extension

Allows or blocks an extension at a position. The kernel walks the inheritance chain when resolving scope.

```
{ verb: "do", action: "scope-extension", position: "<position>", identity, payload: { name, scope: "allow" | "block" | "unallow" | "unblock" } }
```

This is structurally a metadata write to `metadata.scope`, but the kernel exposes it as a named action because the scope semantics (confined vs global, allowance vs block, inheritance) carry rules `set-meta` would not validate.

#### assign-llm-slot

Assigns an LLM connection to a slot at a position or user. Writes `metadata.llm.slots`. The kernel exposes it as a named action because slot semantics (slot name registry, connection ownership check) carry rules `set-meta` would not validate.

```
{ verb: "do", action: "assign-llm-slot", position: "<position>", identity, payload: { slot, connectionId } }
```

### Land-level operations

Operations targeted at the Land Position (`<land>/`). These manipulate the land's installed-extensions list, configuration, and user-record-level LLM connections.

#### install-extension

Installs an extension to the land. Requires `isAdmin`. Writes the extension files to disk; the extension is not loaded until restart.

```
{ verb: "do", action: "install-extension", position: "<land>/", identity, payload: { name, version?, manifest?, files: [{ path, content }] } }
```

#### enable-extension / disable-extension / uninstall-extension

```
{ verb: "do", action: "enable-extension",   position: "<land>/", identity, payload: { name } }
{ verb: "do", action: "disable-extension",  position: "<land>/", identity, payload: { name } }
{ verb: "do", action: "uninstall-extension", position: "<land>/", identity, payload: { name, force?: boolean } }
```

#### publish-extension

Publishes an installed extension to the Horizon registry.

```
{ verb: "do", action: "publish-extension", position: "<land>/", identity, payload: { name, tags?, readme?, repoUrl?, maintainers?, releaseNotes? } }
```

#### set-config

Writes a land-level configuration key. Requires `isAdmin`. Some keys are restricted; the land's config registry defines per-key permissions.

```
{ verb: "do", action: "set-config", position: "<land>/", identity, payload: { key, value } }
```

#### set-llm-connection

Registers a custom LLM connection on the identity's user record.

```
{ verb: "do", action: "set-llm-connection", position: "<user position>", identity, payload: { name, baseUrl, model, apiKey? } }
```

#### remove-llm-connection

```
{ verb: "do", action: "remove-llm-connection", position: "<user position>", identity, payload: { connectionId } }
```

## Extension-registered DO actions

The kernel mints only the primitives listed above. **Extensions can register their own named DO actions** when they expose a direct manipulation surface that doesn't reduce to a single metadata write. The action goes through the same `portal:do` dispatcher; the action's payload schema and behavior are owned by the extension.

Common examples from existing extensions (each implemented by an extension, not by the kernel):

| Action | Extension | What it does |
|---|---|---|
| `compress` | `tree-compress` (treeos-intelligence) | Summarizes sections of a tree under a budget. Touches notes and metadata across many nodes. |
| `prune` | `prune` (treeos-maintenance) | Deletes stale branches. `dryRun: true` returns the candidate list without mutation. |
| `reroot` | `reroot` (treeos-maintenance) | Reorganizes the tree's root assignment. |
| `split` | `split` (standalone) | Partitions a tree into multiple trees by some criterion. |

These actions compose kernel primitives. The kernel does not know what `compress` means. The `tree-compress` extension registers it, the dispatcher routes the call, and the extension internally invokes kernel `set-meta` and `delete` actions on the affected nodes.

If an extension only needs to write to its metadata namespace, it does NOT register a named action. It uses `set-meta` with its namespace. Named actions are reserved for operations whose payload semantics are not "write this data here."

## What an extension does, in DO terms

An extension that today exposes `POST /api/v1/node/:nodeId/values { value, amount }` migrates to:

```
{ verb: "do", action: "set-meta", position: "<position>", identity, payload: { namespace: "values", data: { value, amount }, merge: true } }
```

No new route. No new action name. The extension's logic for handling the write moves into:
- A hook on `afterMetadataWrite` listening for its namespace, OR
- A wrapper helper the extension exposes in its `init.exports` for convenience.

The kernel does the dispatching. The extension does the reacting.

## What configuring an embodiment looks like in DO terms

Configuring how a `@ruler` embodiment behaves at a position is the same shape: a `set-meta` write to the embodiment's namespace.

```
{ verb: "do", action: "set-meta", position: "<position>", identity, payload: { namespace: "ruler", data: { systemInstructions: "...", tools: ["..."], permissions: { ... } } } }
```

When `@ruler` is summoned at this position, the summoning reads `metadata.ruler` from the position and acts according to it. The embodiment itself does not store anything; the position holds the configuration the embodiment reads.

## What about complex extension operations?

Extensions sometimes have multi-step or computed operations (e.g., the `prune` extension's "scan stale branches" produces a list, not a metadata write). Two options:

1. **Register a named DO action** (as `compress`, `prune`, etc. do above). The extension owns the dispatcher payload + return shape. Use this when the operation has a clear request/response surface from the user's side.
2. **Expose a TALK-engaged being** (an embodiment whose summoning runs the operation). Use this when the operation is conversational, ongoing, or wants the being-summoned mental model (LLM reasoning, multi-step decisions, async work).

Example: an extension that wants to expose a tool the AI can use does NOT add a DO action; it registers a tool through the existing tool registry. The AI invokes the tool during a summoning; that is not a DO from the user's side.

## Authorization

DO authorization is action+namespace-keyed. The chain:

1. Identity must be valid (`UNAUTHORIZED` if not).
2. Identity must have write access at the position (`FORBIDDEN` if not).
3. The action must be permitted for this identity at this position. The kernel resolves the active role from the address (the embodiment qualifier in `stance`, if present) and checks per-action permission. Some actions (`install-extension`, `set-config`) require `isAdmin`.
4. For namespaced-metadata writes (`set-meta`, `clear-meta`):
   - The namespace must not be a reserved kernel namespace (`inbox` is not writable via set-meta).
   - For extension namespaces: the extension must not be blocked at this position (scope check).
   - For embodiment namespaces: writing the embodiment's configuration may require a higher-trust role than writing extension data; the kernel applies the per-namespace policy.

Hooks `beforeNodeCreate`, `beforeNote`, `beforeContribution`, `beforeStatusChange`, `beforeNodeDelete`, `beforeMetadataWrite` continue to fire as today. Extensions can gate DO actions through these hooks.

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
- [position-description.md](position-description.md) the SEE response that reflects DO mutations
