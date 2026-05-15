# Position Descriptor — the JSON shape lands return

When the browser requests a Perspective Address from a land, the land returns a **Position Descriptor**: structured JSON describing what's at that position. The browser renders the descriptor according to TreeOS conventions — no HTML, no land-supplied layout. The land owns the data; the browser owns the rendering.

This document defines the contract.

## Top-level shape

```jsonc
{
  // Identifies the position this descriptor describes.
  // The address carries the path in BOTH forms (names and ids) at full
  // chain depth. The browser renders whichever form the user prefers
  // and can switch freely (the four forms in perspective-address.md).
  "address": {
    "land": "treeos.ai",
    "path": "/flappybird/chapter-1",        // the form the request used (verbatim)
    "embodiment": "ruler",                  // the embodiment the request asked for
    "nodeId": "<uuid-b>",                   // leaf node id (canonical, stable across renames)
    "userId": "<uuid|null>",                // user-owner of this scope, when applicable

    // Full chain — BOTH representations, top-down (land root → leaf).
    // The browser uses these to render the four switchable path forms.
    "chain": [
      { "name": "flappybird", "id": "<uuid-a>" },
      { "name": "chapter-1",  "id": "<uuid-b>" }
    ],

    // Convenience derivations (the browser COULD compute these from
    // chain, but the server provides them so all clients agree on the
    // canonical strings).
    "pathByNames": "/flappybird/chapter-1",
    "pathByIds":   "/<uuid-a>/<uuid-b>",
    "leafName":    "chapter-1",
    "leafId":      "<uuid-b>"
  },

  // Zone type — controls which top-level chrome the browser draws.
  "zone": "land" | "home" | "node",

  // Embodiments invocable AT this position by the addressing identity.
  // The browser uses this list to populate the address-bar autocomplete
  // and the chat-panel invoke dropdown.
  "beings": [
    {
      "embodiment": "ruler",
      "label": "Ruler",
      "description": "Coordinates work at this scope. Hires Planner/Contractor/Foreman, dispatches workers.",
      "invocableBy": "owner" | "anyone" | "members" | "custom-rule-name",
      "available": true,                    // whether the current identity is authorized to invoke this
      "modeKey": "tree:governing-ruler",    // server-side mode key (for chat panel routing)
      "icon": "👑"
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
      "fullContentRef": "/api/v1/node/<nodeId>/notes/<noteId>"  // browser fetches on demand
    },
    // ...
  ],

  // Governance state at this scope (if this is a Ruler scope).
  // Mirrors what the existing governance dashboard shows but in
  // structured JSON the browser draws natively.
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

  // Live chat threads ongoing at or addressing this position.
  // Each thread carries its own Perspective Address.
  "chatThreads": [
    {
      "threadId": "<uuid>",
      "address": "tabor -> treeos.ai/flappybird@ruler",
      "openedAt": "2026-05-15T09:00:00Z",
      "lastMessageAt": "2026-05-15T10:42:00Z",
      "messageCount": 12,
      "lifecycleActive": true,             // is a spawn / Worker / dispatch running for this thread?
      "lifecyclePhase": "dispatch-execution" | "hire-planner" | null
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

  // Live WS subscription hint. Once the browser has the descriptor,
  // it subscribes to events scoped to this position for live updates.
  "live": {
    "wsUrl": "wss://treeos.ai/ws",
    "subscribe": {
      "scope": "node" | "subtree" | "user-rooms",
      "rulerNodeId": "<uuid>",
      "rootId": "<uuid>"
    }
  },

  // Identity context — who the server thinks is making this request.
  // Helps the browser confirm the identity panel matches reality.
  "identity": {
    "userId": "<uuid>",
    "username": "tabor",
    "displayName": "Tabor",
    "authorizedHere": true,                // can this identity act at this position?
    "writeAllowed": true
  },

  // Diagnostics + version. Browser surfaces these on error.
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

### Node zone (`zone: "node"`)

A position inside a tree. The richest shape — governance + artifacts + children + everything.

The full union above is the example. Most node positions will have governance + children + maybe artifacts; Worker leaves have artifacts + maybe blocked-status; intermediate Ruler scopes have governance + children.

## How the browser uses each field

| Field | Browser surface |
|---|---|
| `address` | Address bar shows it. Tab title uses path + embodiment. |
| `zone` | Determines top-level chrome (land discovery / home dashboard / node renderer). |
| `beings` | Address-bar autocomplete on `@`. Chat-panel "new chat" dropdown. |
| `children` | Tree navigator. Click-to-navigate. |
| `artifacts` | Main view body — renders each by `kind`. Notes as markdown, files as appropriate, images as images. |
| `governance` | Governance panel — plans / contracts / runs / workers / flags. Lifecycle pill in header. |
| `extensions` | Extension panels — each surface renders its panel alongside main view. |
| `chatThreads` | Chat panel — restored threads on page load. Click to focus a thread. |
| `lineage` | Breadcrumbs at the top of the main view. |
| `siblings` | Sideways arrows. Quick-switch buttons in the tree navigator. |
| `live` | Browser opens WS connection and subscribes to events scoped here. |
| `identity` | Identity panel sanity-checks (if mismatch with browser's signed-in being, prompt to re-auth). |
| `_meta` | Error overlays, diagnostic toggles. |

## Why JSON, not HTML

- **Consistent rendering.** Every land's positions look like TreeOS positions because the browser draws them the same way. Visitors don't learn each land's UI; they learn TreeOS once.
- **Live updates.** WebSocket events update fields without re-fetching. New plan emission? Patch `governance.plan.active`. New worker started? Patch `governance.workers.running`.
- **Embodiment-aware rendering.** The same position fetched as `@ruler` vs `@archivist` returns different subsets of the same shape. The browser strips chat-write surfaces in archivist mode. The land doesn't have to render two HTML variants — it returns the same descriptor with different `beings` / `identity.writeAllowed`.
- **Federation.** A browser session can navigate across lands; each land returns the same descriptor shape; no per-land rendering quirks.
- **Extensibility.** Adding a new artifact `kind` or extension `surface` doesn't require an HTML rewrite — it adds a field the browser recognizes.

## What the server returns when it doesn't know the position

`{ status: "error", error: { code: "POSITION_NOT_FOUND", message: "...", address: {...} } }`

The browser shows a TreeOS-flavored 404 with the breadcrumb back to a known position.

## What the server returns when the identity isn't authorized

`{ status: "error", error: { code: "FORBIDDEN", message: "Sign in as a being authorized at this scope.", address, suggestedIdentitiesToSwitch: [...] } }`

The browser shows a sign-in prompt with the suggestions.

## Versioning

`_meta.descriptorVersion` is a SemVer the browser checks against its supported range. Backwards-incompatible changes bump the major. The browser falls back to legacy HTML mode when descriptor version is unsupported.

The Position Descriptor format is the CONTRACT between browser and land server. It needs to stay stable through Pass 1 and Pass 2. Pass 3+ may add fields, never remove.
