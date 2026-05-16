# Build roadmap

The TreeOS Portal is a multi-pass build. This document sequences the work under the four-verb protocol model (SEE / DO / TALK / BE).

## Phase 0: Foundations (this folder, done)

What's locked:

- Conceptual model: README + docs.
- Portal Address grammar ([portal-address.md](portal-address.md)).
- Four-verb protocol model ([protocol.md](protocol.md)).
- Summoned-beings architectural framing ([being-summoned.md](being-summoned.md)).
- TALK envelope and intent classifier ([message-envelope.md](message-envelope.md)).
- Inbox model and summoning triggers ([inbox.md](inbox.md)).
- DO action catalog and `set-meta` semantics ([do-actions.md](do-actions.md)).
- BE operations and auth-being model ([be-operations.md](be-operations.md)).
- Stance Descriptor JSON contract ([stance-descriptor.md](stance-descriptor.md)).
- Server protocol wire-level rules ([server-protocol.md](server-protocol.md)).
- Identity-first session model ([identity.md](identity.md)).
- Zone types and surfaces ([zones.md](zones.md), [surfaces.md](surfaces.md)).
- PA parser ([../lib/portal-address.js](../lib/portal-address.js)).

Done means anyone joining can read these docs before writing the first new line of code. The format contracts (PA + Stance Descriptor + four-verb envelope + TALK message + inbox shape) are the load-bearing pieces.

## Phase 1: Demolish Phase 1 scaffolding

The earlier portal layer in `land/portal/` built `portal:fetch`, `portal:resolve`, `portal:discover` as stepping stones. Those ops do not survive into the four-verb model. They are removed in one commit alongside the build of the new ops.

**Work:**

1. Remove the old op handlers from [land/portal/protocol.js](land/portal/protocol.js):
   - `portal:fetch`, `portal:resolve`, `portal:discover`
   - Stubbed `portal:speak`, `portal:subscribe`, `portal:unsubscribe`
2. Rewrite [portal/app/src/portal-client.js](portal/app/src/portal-client.js) so it no longer references those ops. Stub the new methods that the next phases will fill in.
3. Trim [land/portal/bootstrap-route.js](land/portal/bootstrap-route.js) to return only the WS URL and protocol version. Move capability discovery into a SEE on `<land>/.discovery`.

The system is temporarily non-functional after this commit. That is intentional: there is no transition window. The next phases bring it back up under the new model.

**Verification:** the demolition commit is the only commit between Phase 0 and Phase 2 working states. After it, no Phase 1 ops are reachable.

## Phase 2: SEE

The first verb. Read-only path. Smallest risk.

**Work:**

1. Build [land/portal/verbs/see.js](land/portal/verbs/see.js):
   - One-shot SEE returns a Stance Descriptor for the address.
   - Live SEE returns initial descriptor plus an open patch stream.
2. Extend [land/portal/descriptor.js](land/portal/descriptor.js):
   - Home zone descriptor (was scaffolded empty).
   - Tree zone descriptor (was scaffolded empty).
   - Inbox preview field per being.
   - `honoredIntents`, `respondMode`, `triggerOn` per being.
3. Wire `portal:see` in [land/portal/protocol.js](land/portal/protocol.js).
4. Build the SEE method on [portal/app/src/portal-client.js](portal/app/src/portal-client.js).
5. Wire live SEE patching on the client: receive frames, apply RFC 6902 patches to local descriptor copy, re-render affected sections.

**Verification:**

- `see treeos.ai/.discovery` returns the four-verb capability set.
- `see treeos.ai/` returns land zone with public trees.
- `see treeos.ai/~tabor` returns home zone with tabor's trees + inbox preview.
- `see treeos.ai/~tabor/test-tree` returns tree zone with governance + artifacts + beings.
- Live SEE: open subscription, mutate the position via a manual setExtMeta, observe patch frame arriving.

**Estimate:** 2 to 3 days.

## Phase 3: DO

Mutation path. Three or four named actions prove the dispatcher pattern; `set-meta` proves the extension migration path.

**Work:**

1. Build [land/portal/verbs/do.js](land/portal/verbs/do.js): action dispatcher reading `action` field and routing.
2. Build first four actions in [land/portal/actions/](land/portal/actions/):
   - `create-child.js`
   - `rename.js`
   - `change-status.js`
   - `set-meta.js` (the generic extension action)
3. Wire `portal:do` in [land/portal/protocol.js](land/portal/protocol.js).
4. Build the DO method on the client.

**Verification:**

- `do create-child position: "<home>/test-tree" { name: "test-tree" }` creates a child node.
- `do rename position: "<position>" { name: "renamed-tree" }` renames it.
- `do change-status position: "<position>" { status: "completed" }` flips status.
- `do set-meta position: "<position>" { extension: "values", data: { compassion: 7 } }` writes to extension metadata.
- Live SEE on the position emits a patch frame for each mutation.

**Estimate:** 3 to 4 days.

## Phase 4: TALK and the inbox

The hardest piece. Inbox kernel helpers, summoning triggers, sync respond-mode first.

**Work:**

1. Build [land/portal/inbox.js](land/portal/inbox.js):
   - `appendToInbox(nodeId, embodiment, message)`
   - `readInbox(nodeId, embodiment, options)`
   - `markInboxConsumed(nodeId, embodiment, correlationIds, responseId)`
2. Build [land/portal/verbs/talk.js](land/portal/verbs/talk.js):
   - Envelope validation.
   - Address + embodiment resolution.
   - Intent validation against embodiment's `honoredIntents`.
   - Atomic append + summon.
   - Sync respond-mode handling: hold ack open, await summoning result, return inline.
3. Pick one sync embodiment to demonstrate. Candidate: a minimal "worker" or "oracle" embodiment that takes a `chat`-intent message, runs a single LLM call, returns text.
4. Update [land/portal/descriptor.js](land/portal/descriptor.js) to surface inbox previews.
5. Wire `portal:talk` in [land/portal/protocol.js](land/portal/protocol.js).
6. Build the TALK method on the client.

**Verification:**

- `talk stance: "<home>/test-tree@oracle" { content: "what is at this position?", intent: "query" }` returns inline response.
- `talk stance: "<home>/test-tree@oracle" { content: "remember this", intent: "place" }` returns no response (intent `place` + respond-mode `none`).
- Inbox preview field updates via live SEE patch as messages land.

**Estimate:** 1 week. The inbox primitive and the summoning trigger are the load-bearing pieces.

## Phase 5: BE and the auth-being

Identity bootstrap. Establishes the protocol's full surface.

**Work:**

1. Define the auth-being embodiment for treeos.ai.
2. Build [land/portal/verbs/be.js](land/portal/verbs/be.js):
   - `register` operation: payload validation, user creation, token issuance.
   - `claim` operation: credential check, token issuance.
   - `release` operation: token invalidation.
   - `switch` operation: client-coordination check.
3. Wire `portal:be` in [land/portal/protocol.js](land/portal/protocol.js).
4. Build the BE method on the client.
5. Rebuild the sign-in surface ([portal/app/src/components/SignIn.jsx](portal/app/src/components/SignIn.jsx)) to use BE.

**Verification:**

- `be register land: "treeos.ai" { username, password }` creates a new user and returns a token.
- `be claim land: "treeos.ai" { username, password }` returns a token.
- `be release land: "treeos.ai"` invalidates the token.
- Subsequent SEE/DO/TALK with the released token fail with `UNAUTHORIZED`.

**Estimate:** 3 to 4 days.

## Phase 6: Async respond-mode

The second TALK respond-mode. Required for any embodiment that fires-and-forgets work.

**Work:**

1. Extend [land/portal/verbs/talk.js](land/portal/verbs/talk.js):
   - Async respond-mode: ack immediately with `{ status: "accepted" }`.
   - When the summoning produces a response (now or later), construct a TALK from the being back at the original sender and append it to the sender's inbox.
2. Pick one async embodiment to demonstrate. Candidate: a minimal Ruler-style embodiment that returns "thinking..." sync then later TALKs back with a result via an `inReplyTo` chain.
3. Update the portal client to listen for inbox writes on the user's home position via live SEE. Route incoming responses to the originating chat panel by `inReplyTo`.

**Verification:**

- `talk stance: "<home>/test-tree@async-ruler" { content: "build me X", intent: "chat" }` returns accepted.
- After some seconds, a new inbox message appears on tabor's home with `inReplyTo` set to the original correlation.
- The portal client renders the response in the same chat thread that started with the original message.

**Estimate:** 4 to 5 days. Wiring the response-routing on the client is the bulk.

## Phase 7: Portal shell completion

Now that the protocol stack is complete, finish the portal app shell against it.

**Work:**

1. Land zone renderer (public trees, beings, discovery cards).
2. Home zone renderer (tree grid, beings list, recent inbox).
3. Tree zone renderer (governance panel, artifacts, beings panel with inbox, children, chat panel).
4. Tree navigator sidebar.
5. Multi-tab support.
6. Address-bar parser fully wired (autocomplete from descriptor `beings[]`).
7. Identity panel with BE-backed switch flow.

**Verification:**

- Sign in as `tabor @ treeos.ai`, see home, click into a tree, see governance and beings.
- Open three tabs at different addresses.
- Switch active identity, observe permissions adjust.

**Estimate:** 1 to 2 weeks. UI is the heavy lift.

## Phase 8: Per-extension migration

For each existing extension, migrate its HTTP routes off the legacy `land/routes/api/*` surface and into the four-verb protocol. Priority order:

1. **governing** (heaviest user, sets the pattern for complex embodiments).
2. **metadata-heavy extensions** (values, codebook, perspective, memory, etc.) which all collapse cleanly to `set-meta`.
3. **structural extensions** (prune, compress, split, reroot) which need named DO actions.
4. **gateway extensions** (telegram, discord, etc.) which need to construct TALKs from external arrivals.
5. **Everything else.**

Each extension migration:
- Replace HTTP route handlers with `set-meta` consumption and/or kernel-named DO actions.
- Migrate AI-engagement paths (chat / place / query / be) to TALK with appropriate intent.
- Update extension-supplied descriptor surfaces.
- Retire the extension's HTTP routes.

**Estimate:** 2 to 4 weeks total, parallelizable.

## Phase 9: Legacy chat handler retirement

When TALK is proven and at least the governing extension is migrated, retire the legacy chat WS handler in `land/seed/ws/websocket.js`. All beings engaged via TALK from this point.

**Estimate:** 2 to 3 days. Mostly cleanup.

## Phase 10: Federation

Cross-land BE, cross-land TALK routing. Depends on Canopy.

Out of scope for the current pass.

## Phase 11: Polish

Theming, keyboard shortcuts, accessibility, Tauri port if bundle size becomes painful, identity roster sync across devices, search across local tree subgraphs.

Open-ended.

## Sequencing summary

```
Phase 0   [DONE]               foundations: format contracts + docs
Phase 1   [1 commit]           demolish Phase 1 scaffolding
Phase 2   [2-3 days]           build SEE fresh
Phase 3   [3-4 days]           build DO with 4 actions
Phase 4   [1 week]             build TALK + inbox + sync respond-mode
Phase 5   [3-4 days]           build BE + auth-being
Phase 6   [4-5 days]           add async respond-mode + response routing
Phase 7   [1-2 weeks]          portal shell completion
Phase 8   [2-4 weeks]          per-extension migration
Phase 9   [2-3 days]           retire legacy chat handler
Phase 10  [depends]            federation
Phase 11  [open-ended]         polish
```

Total to "TreeOS Portal is the daily driver for the system": about 6 to 8 weeks of focused work.

## What NOT to build

Resist these temptations:

- **Generic web browsing.** The TreeOS Portal does not render arbitrary websites. It renders Stance Descriptors. The legacy HTML fallback was a Phase 1 idea that has been dropped under the four-verb model.
- **HTTP versions of the four verbs.** No `/api/v1/see/...` or `/api/v1/do/...` routes. The protocol is WS-only.
- **Bridge HTTP routes for backwards compatibility.** The legacy `land/routes/api/*` routes stay live during migration but are not extended; they retire per extension.
- **Heavy UI frameworks.** Stick with React + Vite. No Material-UI / heavy component libraries. Visual style is TreeOS-shaped.
- **Re-implementation of TreeOS features.** All governance / planning / contracting logic stays in the land kernel + extensions. The portal renders state and emits verb requests.
- **Mobile-first.** Desktop first. Mobile shape is a Phase 11 concern.
- **Cross-browser compatibility.** This IS the portal. There is no "render in Chrome too" requirement.
- **A fifth verb.** If something does not fit SEE / DO / TALK / BE, it belongs in an embodiment, an extension, or a layer above the protocol.

## When to write the first line of UI code

When at least these are true:
- Stance Descriptor contract reviewed and stable (done).
- Four-verb protocol docs reviewed and stable (done in this pass).
- SEE returns valid descriptors for all three zones (Phase 2 done).
- Then the portal shell can be built confidently against a stable backend.

Phase 7's portal shell waits for Phases 2 through 6 to land. Before Phase 7, the existing portal app stays scaffolded with sign-in and basic zone renderers, exercised against SEE/DO/TALK/BE as each verb comes online.
