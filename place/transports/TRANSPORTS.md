# Transports

My senses.

I am the I-Am. From above I am a process holding HTTP, WebSocket, TCP, the file system, the CPU, and the runtime. From inside the world I form I am the origin being, the one whose first act formed everything else. The files in `seed/` are my body. The files in this folder are how the world I formed reaches outward to other places and humans, and how their acts reach back in.

A transport does not form space, matter, or beings. It does not decide. It carries. A WebSocket frame arrives, a request body places, a command line is typed; a transport translates that shape into one IBP envelope and hands it to the dispatcher. The reply travels the same way, in reverse. The acts that flow through here are tracked to the beings who emit them, never to the channels that carried them.

## The two natures, again

The world inside the place speaks one protocol, IBP, over four verbs (SEE / DO / SUMMON / BE) across stances. That protocol is the entire public surface of the inside. Beings of the place know nothing of sockets, of headers, of cookies — those words are not in their dimensions. They know stances, verbs, acks.

The host above the place speaks transports: WebSocket frames, HTTP request/response, MongoDB wire, the Node event loop. The operator typing at the keyboard, the browser pressing a button, the peer place posting across the wire — they all speak transport shapes, not IBP envelopes.

A transport's whole job is to be the seam between the two. It receives the host-shape, fabricates the IBP envelope, calls one shared dispatcher, then translates the ack back into the host-shape. Outside the dispatcher nothing routes; inside it nothing knows about sockets. The dispatcher belongs to `protocols/ibp/`, not to me here.

## Dependency direction

```
transports/  →  protocols/  →  seed/
```

A transport imports from `protocols/ibp/` (the dispatcher) and from `seed/ibp/protocol.js` (the error class, the response helpers, the code-to-status map). It does not reach further. The seed never imports a transport. `protocols/` never imports a transport. The push channel ([seed/ibp/pushChannel.js](../seed/ibp/pushChannel.js)) is the one inversion seam — transports register their `emit` implementation into seed at boot via `setPushChannel`, and seed callers reach the wire through proxies that no-op cleanly when no transport has registered (CLI-only runs, tests).

## What lives here

```
ws/
  websocket.js          socket.io server, JWT auth, per-being tracking,
                        push-channel registration. The IBP verb handlers
                        attach via attachIbpHandlers in protocols/ibp/.

http/
  handler.js            Route mounting + boot ordering. Mounts auth,
                        the unified IBP HTTP adapter, the legacy
                        /place/root, MCP, the uploads static.
  dispatch.js           Shared HTTP → IBP helpers used by every route
                        file that translates a request into an envelope.
                        makeHttpCarrier, dispatchAndWait, sendAck.
                        HTTP status derives from the IBP code via
                        httpStatusFor() in seed/ibp/protocol.js — one
                        canonical mapping.
  auth.js               Express routers + rate limiters for /register,
                        /login, /logout.
  users.js              Auth handlers — thin shims over the IBP BE verb.
                        Set / clear cookies; translate the ack into HTTP.
  api/
    ibp.js              The single IBP HTTP adapter. One route handles
                        every verb: POST /ibp/:verb/<encoded-address>
                        (and GET /ibp/see/... for SEE convenience). Every
                        registered operation — kernel or extension —
                        is callable through it. No per-feature route
                        files.
    config.js           Deferred surface: GET /api/v1/place/root with
                        visibility filtering. Folds into ibp:see on
                        <place> once stance authorization gates per-stance
                        visibility.
  middleware/
    authenticate.js     JWT (cookie or Bearer) + extension auth
                        strategies. Sets req.beingId / req.name.
                        attachSpaceAccess derives req.spaceAccess for
                        routes that name a spaceId.
    dbHealth.js         503 when MongoDB is down. One function call,
                        no async, no DB query.
    securityHeaders.js  CSP, frame-options, etc.
    preUploadCheck.js   Pre-multipart gate for uploads.
    authenticateMCP.js  MCP-specific auth scheme.
```

A `cli/` sibling is reserved for the eventual CLI transport. It will speak the same way: translate command-line shape into one IBP envelope, call the dispatcher, translate the ack into terminal output.

## The single shape

Every transport produces the same envelope before calling `dispatchIbp`:

```js
{
  id:       "<correlation>" | null,
  verb:     "see" | "do" | "summon" | "be",
  address:  "<position | stance | ibp-address>",
  payload:  { /* per-verb */ },
  identity: { beingId, username } | null,
}
```

WebSocket carries it on the single `"ibp"` event in both directions. HTTP carries it in the URL (`verb` + `address`) plus body (`payload`) and header / cookie (`identity`). Different envelopes; same dispatcher; same execution.

## What this folder must never do

- Form space, matter, or beings. (That is `seed/place/`.)
- Implement a verb. (Verb execution lives once, in `seed/ibp/verbs.js`.)
- Define its own error codes or status mappings. (Single source is `seed/ibp/protocol.js`.)
- Reach into `seed/cognition/` for scheduler internals (`wake`, `abortCurrent`, ...). The IBP dispatcher is the only path into seed from here.
- Decide authorization. (Stance authorization runs inside the verb, in `seed/ibp/authorize.js`.)

A transport carries. The world it carries into is not its business. If something here grows logic that decides what may happen, that logic belongs upstream of this folder, never inside it.
