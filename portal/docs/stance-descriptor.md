# Stance Descriptor: the JSON shape SEE returns

When SEE addresses a position (with or without an embodiment qualifier), the land returns a **Stance Descriptor**: structured JSON describing what is at that address. The portal renders the descriptor according to TreeOS conventions. No HTML, no land-supplied layout. The land owns the data; the portal owns the rendering.

## What the descriptor describes

The descriptor describes **what is at the addressed position**, with embodiment-specific augmentation when the address has a qualifier. Recall the terminology:

- **Position**: `<land>/<path>`. The slash is always present. The path may be empty (`treeos.ai/`, the land root), `~user...` (a home), or any tree node (`treeos.ai/flappybird/chapter-1`). A position is the actual place in the world.
- **Stance**: `<position>@<embodiment>`. A being at a position. `treeos.ai/flappybird@ruler`.
- **Portal Address**: `<stance> :: <stance>`. `tabor :: treeos.ai/flappybird@ruler`. Names the relationship between two stances. Used in UI and being-to-being framing; the verb envelope carries only the "to" side.

There are two things addressable in the world: a position (a place) and a stance (a being at a place). The SEE verb accepts either; the descriptor returned reflects which was asked for.

SEE accepts either an unqualified position or a qualified one:

- **Unqualified** (`see treeos.ai/flappybird`): the descriptor describes the position. Children, artifacts, lineage, governance, the list of beings invocable here. Embodiment-specific fields reflect the union of all invocable embodiments so the user can pick.
- **Qualified** (`see treeos.ai/flappybird@ruler`): the descriptor is augmented with the named embodiment's specific data. That embodiment's inbox, its honored intents, its response mode, its open conversations. The base position fields remain the same.

Same position with different embodiment qualifiers returns different augmented descriptors. The Ruler-augmented descriptor at /flappybird emphasizes governance state. The Historian-augmented descriptor emphasizes accumulated history. The Oracle-augmented descriptor emphasizes synthesis. Same position, same base shape, different augmentation.

The descriptor is **filtered by the requesting identity**. Which beings appear in the `beings` list, what data is visible in `governance` or `artifacts`, what panels are populated, all depend on what the requesting identity is permitted to see at this position. The descriptor is named "Stance Descriptor" because the requester-plus-addressed-position together form an implicit stance relationship even when the address itself is unqualified.

## Top-level shape

```jsonc
{
  // Identifies the stance this descriptor describes.
  // The address carries the path in BOTH forms (names and ids) at full
  // chain depth. The portal renders whichever form the user prefers
  // and can switch freely (the four forms in portal-address.md).
  "address": {
    "land": "treeos.ai",
    "path": "/flappybird/chapter-1",        // the form the request used (verbatim)
    "embodiment": "ruler",                  // the embodiment the request asked for
    "nodeId": "<uuid-b>",                   // leaf node id (canonical, stable across renames)
    "userId": "<uuid|null>",                // user-owner of this scope, when applicable

    // Full chain — BOTH representations, top-down (land root → leaf).
    // The portal uses these to render the four switchable path forms.
    "chain": [
      { "name": "flappybird", "id": "<uuid-a>" },
      { "name": "chapter-1",  "id": "<uuid-b>" }
    ],

    // Convenience derivations (the portal COULD compute these from
    // chain, but the server provides them so all clients agree on the
    // canonical strings).
    "pathByNames": "/flappybird/chapter-1",
    "pathByIds":   "/<uuid-a>/<uuid-b>",
    "leafName":    "chapter-1",
    "leafId":      "<uuid-b>"
  },

  // Zone type — controls which top-level chrome the portal draws.
  "zone": "land" | "home" | "tree",

  // Embodiments invocable AT this position by the addressing identity.
  // The portal uses this list to populate the address-bar autocomplete
  // and the chat-panel invoke dropdown.
  "beings": [
    {
      "embodiment": "ruler",
      "label": "Ruler",
      "description": "Coordinates work at this scope. Hires Planner/Contractor/Foreman, dispatches workers.",
      "invocableBy": "owner" | "anyone" | "members" | "custom-rule-name",
      "available": true,                    // whether the current identity is authorized to invoke this
      "honoredIntents": ["chat", "place", "query", "be"],  // which TALK intents this embodiment accepts
      "respondMode": "sync" | "async" | "none",            // how this embodiment delivers responses
      "triggerOn": ["message", "hook", "schedule"],        // when summoning fires for this embodiment
      "icon": "👑",
      // Per-embodiment inbox preview at this position
      "inbox": {
        "total":      47,
        "unconsumed": 3,
        "recent": [
          {
            "correlation": "msg-12",
            "from":        "tabor@treeos.ai",
            "intent":      "chat",
            "preview":     "begin",
            "sentAt":      "2026-05-15T20:30:00Z",
            "consumed":    true,
            "responseId":  "msg-13"
          }
        ]
      }
    },
    // ...
  ],

  // Children of this position (for navigation). Empty for leaves.
  "children": [
    {
      "name": "chapter-1-origins",
      "path": "/flappybird/chapter-1-origins",
      "type": "ruler" | "leaf" | "trio-plan" | "trio-contracts" | "trio-execution" | "<custom-type>",
      "summary": "Chapter on the origins of Flappy Bird. 5 sections, 1 leaf prose.",
      "noteCount": 3,                       // count of notes at the child
      "lifecycle": "running" | "completed" | "stalled" | "idle" | null
    },
    // ...
  ],

  // Artifact content at this position (notes, files, etc.) if any.
  // Lists what's CURRENTLY at this node, not what's planned.
  "artifacts": [
    {
      "kind": "note" | "file" | "image" | "code" | "custom",
      "name": "main-prose",
      "contentType": "text/markdown",
      "preview": "# Chapter 1: Origins\n\nIn the autumn of 2013...",
      "previewBytes": 4217,
      "totalBytes": 12894,
      "createdAt": "2026-05-15T10:38:00Z",
      "byBeing": "<embodiment that produced it>",
      "fullContentRef": "/api/v1/node/<nodeId>/notes/<noteId>"  // portal fetches on demand
    },
    // ...
  ],

  // Governance state at this scope (if this is a Ruler scope).
  // Mirrors what the existing governance dashboard shows but in
  // structured JSON the portal draws natively.
  "governance": {
    "ruler": {
      "promoted": "2026-05-15T08:00:00Z",
      "promotedFrom": "root",
      "lifecycle": "running",
      "depth": 0,
      "parentRulerId": null
    },
    "plan": {
      "active": { /* plan emission summary */ },
      "history": [ /* archived emissions */ ]
    },
    "contracts": {
      "active": { /* contract emission summary */ },
      "inherited": [ /* ancestor contracts in force */ ],
      "history": [ /* archived emissions */ ]
    },
    "execution": {
      "active": {
        "recordOrdinal": 1,
        "status": "running",
        "stepStatuses": [ /* per-step */ ]
      },
      "history": [ /* prior runs */ ]
    },
    "workers": {
      "running": [ /* leaf-step descriptors with running status */ ],
      "completed": [ /* leaves with done status */ ],
      "blocked":   [ /* leaves with blocked status + reason */ ],
      "failed":    [ /* leaves with failed status + error */ ]
    },
    "flags": {
      "pending": [ /* unresolved governing-flag-issue entries */ ],
      "resolved": [ /* pass 2 court will populate */ ]
    },
    "lifecycleAwaiting": "plan" | "contracts" | "dispatch" | "done" | null
  },

  // Extensions installed/active at this position. Each may contribute
  // its own renderable panel (the "extension surfaces" concept).
  "extensions": [
    {
      "name": "book-workspace",
      "version": "0.6.0",
      "active": true,
      "surfaces": [
        {
          "key": "outline-panel",
          "title": "Book outline",
          "renderRef": "/api/v1/ext/book-workspace/panel/outline?nodeId=<id>",
          "kind": "html-fragment" | "json-tree" | "json-list" | "custom"
        }
      ]
    }
  ],

  // Conversation threads at this position. A thread is a chain of TALK
  // messages walking inReplyTo back to an original message. The portal
  // renders one chat panel per active thread keyed by the originating
  // correlation id. This field replaces the older chatThreads/sessionId
  // model.
  "conversations": [
    {
      "rootCorrelation": "msg-12",         // correlation id of the message that started this thread
      "withStance":      "tabor@treeos.ai", // the other end of the conversation
      "embodiment":      "ruler",           // which being at this position is in the thread
      "openedAt":        "2026-05-15T09:00:00Z",
      "lastMessageAt":   "2026-05-15T10:42:00Z",
      "messageCount":    12,
      "lifecycleActive": true,             // is a spawn / Worker / dispatch running for this thread?
      "lifecyclePhase":  "dispatch-execution" | "hire-planner" | null
    }
  ],

  // Navigation breadcrumbs upward.
  "lineage": [
    { "path": "/", "name": "treeos.ai (land)" },
    { "path": "/~tabor", "name": "tabor's home" },
    { "path": "/~tabor/flappybird", "name": "Flappy Bird project" }
  ],

  // Sibling positions at the same depth (for sideways navigation).
  "siblings": [
    { "name": "chapter-2-mechanics", "path": "...", "lifecycle": "running" },
    { "name": "chapter-3-impact", "path": "...", "lifecycle": "idle" }
  ],

  // Live SEE subscription is requested via the live: true flag on the
  // original SEE call. Closing the WS connection ends all live SEEs.
  // The portal does not need a separate subscribe step; the field below
  // declares the patch granularity the land will emit if live SEE is
  // active on this address.
  "live": {
    "supportedScopes": ["position", "subtree"],
    "patchGranularity": "field"            // field-level RFC 6902 patches
  },

  // Identity context — who the server thinks is making this request.
  // Helps the portal confirm the identity panel matches reality.
  "identity": {
    "userId": "<uuid>",
    "username": "tabor",
    "displayName": "Tabor",
    "authorizedHere": true,                // can this identity act at this position?
    "writeAllowed": true
  },

  // Diagnostics + version. Portal surfaces these on error.
  "_meta": {
    "descriptorVersion": "1.0",
    "serverVersion": "treeos-land 1.0.0",
    "generatedAt": "2026-05-15T10:42:00Z",
    "renderHints": []                      // optional server-suggested rendering nudges
  }
}
```

## Variations by zone

The shape above is the union. Each zone uses a subset.

### Land zone (`zone: "land"`)

Public root. Discovery surface.

```jsonc
{
  "address": { "land": "treeos.ai", "path": "/" },
  "zone": "land",
  "beings": [ /* land-level beings: @citizen, @oracle (public knowledge), @merchant (marketplace), etc. */ ],
  "children": [
    /* PUBLIC trees on this land — anything ext-allow'd at land root */
    { "name": "tagay-book", "path": "/tagay-book", "type": "ruler", "lifecycle": "running" },
    { "name": "flappybird", "path": "/flappybird", "type": "ruler", "lifecycle": "completed" }
  ],
  "land": {
    /* metadata: who runs this land, what economy, what extensions, etc. */
    "name": "TreeOS Public Land",
    "operator": "tabor@treeos.ai",
    "extensionsAvailable": [ /* installable extensions this land hosts */ ],
    "policies": { "registrationOpen": true, "guestsAllowed": true }
  },
  /* no governance block — land root isn't a Ruler */
  /* no chat-threads block by default — though a "land citizen" being can be invoked */
}
```

### Home zone (`zone: "home"`)

User's tree root. Personal space.

```jsonc
{
  "address": { "land": "treeos.ai", "path": "/~tabor" },
  "zone": "home",
  "beings": [
    /* @dreamer, @builder, plus any beings the user has configured personally */
  ],
  "children": [
    /* user's personal trees */
    { "name": "tagay-book", "path": "/~tabor/tagay-book", "lifecycle": "running" },
    { "name": "polypong", "path": "/~tabor/polypong", "lifecycle": "completed" },
    { "name": "notes", "path": "/~tabor/notes", "type": "leaf" }
  ],
  "home": {
    "username": "tabor",
    "createdAt": "...",
    "extensionsActive": [ /* user-allowed extensions at home scope */ ],
    "stats": { "treeCount": 47, "totalNodes": 1820 }
  }
  /* no governance unless the user explicitly promoted home to a Ruler */
}
```

### Tree zone (`zone: "tree"`)

A stance inside a tree. The richest shape: governance + artifacts + children + everything.

The full union above is the example. Most tree-zone stances will have governance + children + maybe artifacts. Worker leaves have artifacts + maybe blocked-status. Intermediate Ruler stances have governance + children.

## How the portal uses each field

| Field | Portal surface |
|---|---|
| `address` | Address bar shows it. Tab title uses path + embodiment. |
| `zone` | Determines top-level chrome (land discovery / home dashboard / node renderer). |
| `beings` | Address-bar autocomplete on `@`. Chat-panel invoke dropdown. Each being's inbox drives a chat-panel preview. |
| `beings[].honoredIntents` | Portal-side intent picker for TALK. Disables intents the embodiment refuses. |
| `beings[].respondMode` | Portal-side rendering choice: sync (block UI for response) vs async (background panel + notification on response). |
| `beings[].inbox` | Preview of recent messages. Click expands to full conversation view. |
| `children` | Tree navigator. Click-to-navigate. |
| `artifacts` | Main view body. Renders each by `kind`. Notes as markdown, files as appropriate, images as images. |
| `governance` | Governance panel: plans, contracts, runs, workers, flags. Lifecycle pill in header. |
| `extensions` | Extension panels. Each surface renders its panel alongside main view. |
| `conversations` | Chat panel. Restored threads on page load. Click to focus a thread keyed by rootCorrelation. |
| `lineage` | Breadcrumbs at the top of the main view. |
| `siblings` | Sideways arrows. Quick-switch buttons in the tree navigator. |
| `live` | Declares what the land will emit for live SEE on this address. |
| `identity` | Identity panel sanity-check (if mismatch with portal's signed-in being, prompt to re-auth). |
| `_meta` | Error overlays, diagnostic toggles. |

## Why JSON, not HTML

- **Consistent rendering.** Every land's positions look like TreeOS positions because the portal draws them the same way. Visitors do not learn each land's UI; they learn TreeOS once.
- **Live updates.** Live SEE streams RFC 6902 patches. New plan emission patches `governance.plan.active`. New inbox message patches `beings[].inbox`. No re-fetching.
- **Embodiment-aware rendering.** The same position fetched as `@ruler` vs `@archivist` returns different subsets of the same shape. The portal strips DO/TALK write surfaces in archivist mode. The land does not render two variants; it returns the same descriptor with different `beings[].available` and `identity.writeAllowed`.
- **Federation.** A portal session can navigate across lands; each land returns the same descriptor shape; no per-land rendering quirks.
- **Extensibility.** Adding a new artifact `kind` or extension `surface` does not require a rewrite. It adds a field the portal recognizes.

## What the server returns when the stance does not resolve

The standard error envelope from [protocol.md](protocol.md):

```
{ status: "error", error: { code: "NODE_NOT_FOUND", message: "...", detail: { position: {...} } } }
```

The portal shows a TreeOS-flavored 404 with the breadcrumb back to a known stance.

## What the server returns when the requesting stance is not authorized

```
{ status: "error", error: { code: "FORBIDDEN", message: "Sign in as a being authorized at this stance.", detail: { stance, suggestedIdentitiesToSwitch: [...] } } }
```

The portal shows a sign-in prompt with the suggestions.

## Versioning

`_meta.descriptorVersion` is a SemVer the portal checks against its supported range. Backwards-incompatible changes bump the major. The portal falls back to a degraded mode when descriptor version is unsupported.

The Stance Descriptor format is the CONTRACT between portal and land server. It stays stable through Pass 1 and Pass 2. Pass 3+ may add fields, never remove.

## See also

- [protocol.md](protocol.md) the four-verb spec
- [server-protocol.md](server-protocol.md) wire-level rules for SEE
- [inbox.md](inbox.md) how inbox fields are populated
- [being-summoned.md](being-summoned.md) why beings have inboxes
