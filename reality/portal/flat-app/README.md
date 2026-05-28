# TreeOS Portal Flat

A flat HTML client over IBP. Sibling to `3d-app/`. Renders one position as
a list of beings, matter, and children; chat panel summons beings live
via Socket.IO. Built as a basic end-to-end test of the IBP surface,
separate from the 3D portal's Three.js rendering.

## Run

In one shell, start the reality server:

```
cd reality
npm run dev
```

In another shell, start the flat-app vite dev server:

```
cd reality/portal/flat-app
npm install
npm run dev
```

Open `http://localhost:5174`. Vite proxies `/api`, `/.well-known`, and
`/socket.io` to `http://localhost:3000` (the reality server). Override the
backend target with `PORTAL_LAND_TARGET=https://your-place npm run dev`.

## What it shows

- **Top bar.** Parent link, current address, identity chip with claim affordances.
- **Middle left.** Beings at this space; matter at this space. Click a row to inspect or chat.
- **Middle right.** Inspector (verbs available, permissions) when a non-chat row is selected. Chat panel when a being's chat affordance is opened.
- **Bottom bar.** Children spaces. Click to navigate.

## Identity

If no JWT is present, the auth overlay renders BE.claim / BE.register
controls. After claim, the JWT is stored in localStorage (mirrors
`3d-app`'s session storage) and threaded into the Socket.IO auth handshake.
Use the identity chip to release the session and reclaim as a different
being to test stance differences.

## Live updates

Uses the same `PortalClient` Socket.IO surface as `3d-app`:

- `client.see(address, { live: true })` subscribes to descriptor patches.
- Inbound `ibp:summon` envelopes drive chat updates (reply pushes,
  sub-summon spawn pushes).
- Cancel sub-summons by emitting a cancel SUMMON keyed by
  `rootCorrelation` (see `chat.js`).

## Scope

This is a basic test harness. Sub-summon tree rendering is flat-nested,
not depth-collapsing. Matter editing is limited to whatever the
operation registry exposes generically. No styling beyond plain CSS grid.
