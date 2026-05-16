# IBP Document Types

IBP, the Inter-Being Protocol, does not have an umbrella name for its data. There is no "PDL," no "IBPL." Instead, IBP defines a small set of named document types and a small set of shared atoms. The protocol carries these directly.

This index lists the document types each verb works with, and the atoms they share. Each document type has its own detail doc; the atoms appear in the addressing docs.

## The four document types

### Position Description

The structured JSON description SEE returns. Names what's at the addressed position. Includes embodiment-augmented fields (inbox, honored intents, response mode, conversations for that embodiment) when the address carries an `@<embodiment>` qualifier.

- Detail: [position-description.md](position-description.md)
- Carried by: **SEE**
- Shape: `{ address, name, type, children?, notes?, namespaces?, beings?, ... }`

### Message Envelope

The TALK envelope. One uniform shape delivering messages to inboxes regardless of who's addressing whom.

- Detail: [message-envelope.md](message-envelope.md)
- Carried by: **TALK**
- Shape: `{ from, content, intent, correlation, inReplyTo?, attachments? }`

### Mutation Payload

The action-specific `payload` inside a DO envelope. The full DO body is `{ verb, action, position, identity, payload }`; the payload's shape varies per action. Structural actions (`create-child`, `rename`, `move`, `delete`, `change-status`, ...) and the generic namespace writes (`set-meta`, `clear-meta`) each declare their own payload shape.

- Catalog: [do-actions.md](do-actions.md)
- Carried by: **DO**
- Shape: action-specific

### Identity Operation

The BE envelope's body. Operation-specific data for registering, claiming, releasing, or switching identity at a stance. The four operations each have their own payload requirements.

- Detail: [be-operations.md](be-operations.md)
- Carried by: **BE**
- Shape: operation-specific

## Shared atoms

These appear inside every document type and inside addresses.

### Position

A place in the world. Form `<land>/<path>`. Examples: `treeos.ai/` (Land Position), `treeos.ai/~tabor` (home), `treeos.ai/flappybird` (tree node). Addressable; accepted by SEE and DO.

### Stance

A being at a position. Form `<position>@<embodiment>`. Examples: `treeos.ai/@auth`, `treeos.ai/flappybird@ruler`. Addressable; accepted by SEE, required by TALK and BE.

### Land

A sovereign server. Two forms distinguished by the trailing slash. `treeos.ai` (no slash) is the **Land identifier**, the name of the server, used by BE when dispatching to the land's auth-being. `treeos.ai/` (with slash) is the **Land Position**, the actual addressable place at path `/` on that land. The trailing slash is the load-bearing distinction.

### Embodiment

A cognitive shape. Form `@<identifier>` (e.g., `@ruler`, `@archivist`, `@tabor`). Combines with a Position to form a Stance. Not addressable on its own. The `@qualifier` in a Stance address names the embodiment but never targets it.

See [portal-address.md](portal-address.md) for the full grammar and [protocol.md](protocol.md) for how the verbs use these.

## Why no umbrella name

Most modern protocols don't have an umbrella name for their data. HTTP doesn't have "HTTP Data Language." gRPC carries Protocol Buffers as a separate reusable schema, not "gRPC data." IBP follows the same pattern. The protocol carries the identity; the data is named at the document-type level.

Adding an umbrella name later (if one earns its keep) is cheaper than retiring one in use.
