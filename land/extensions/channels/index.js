import log from "../../seed/log.js";
import tools from "./tools.js";
import {
  setServices,
  deliverToChannels,
  getChannels,
  createChannel,
  removeChannel,
  acceptInvite,
  // Room primitives layered on top of channels
  createRoom,
  addAgentParticipant,
  addUserParticipant,
  addObserverParticipant,
  removeParticipant,
  postToRoom,
  readRoomTranscript,
  listRooms,
} from "./core.js";
export async function init(core) {
  setServices({ models: core.models, metadata: core.metadata });

  // ── onCascade: deliver signals through channel subscriptions ────────
  //
  // Runs AFTER propagation (propagation is a required dependency, so its
  // handler registered first). Nearby nodes get the signal through the
  // tree walk before distant partners get it through the channel shortcut.
  //
  // Two skip conditions prevent loops and misrouting:
  // 1. _channel tag present: this signal already arrived via a channel.
  //    One hop only. Never re-enter the channel system.
  // 2. _channelInvite present: this is an invitation signal, not content.
  //    Handled separately below.

  // ── onCascade: single handler, handles BOTH delivery and invitations ──
  //
  // Only one onCascade handler per extension is allowed; a second
  // register() overwrites the first. So the delivery path and the
  // invitation path must share one handler, branching by payload shape.
  core.hooks.register("onCascade", async (hookData) => {
    const { nodeId, payload, signalId, depth } = hookData;
    // Only process explicit payload deliveries (from deliverCascade, e.g.
    // channel routing or room posts). Kernel-originated cascades from
    // createNote only pass `writeContext` (metadata summary, no content);
    // picking those up would double-fire agents since rooms also trigger
    // their own deliverCascade with the full text.
    if (!payload) return;

    // Loop prevention: don't re-process a signal that already rode through
    // a channel once.
    if (payload._channel) return;

    // Invitation path: same-owner auto-accept.
    if (payload._channelInvite) {
      const invite = payload._channelInvite;
      const Node = core.models.Node;
      try {
        const targetNode = await Node.findById(nodeId).select("rootOwner").lean();
        const sourceNode = await Node.findById(invite.sourceNodeId).select("rootOwner").lean();
        if (targetNode?.rootOwner && sourceNode?.rootOwner &&
            targetNode.rootOwner.toString() === sourceNode.rootOwner.toString()) {
          await acceptInvite(nodeId, invite.channelName, "system");
          log.verbose("Channels", `Auto-accepted channel "${invite.channelName}" from ${invite.sourceNodeName}`);
        }
      } catch (err) {
        log.debug("Channels", `Auto-accept failed: ${err.message}`);
      }
      return;
    }

    // Delivery path: fan out to every active subscription on this node.
    log.info("Channels", `↪ onCascade at ${String(nodeId).slice(0, 8)} — fanning out to subscriptions`);
    const results = await deliverToChannels(nodeId, payload, signalId, depth);
    if (results.length > 0) {
      log.info("Channels", `Delivered from ${String(nodeId).slice(0, 8)} through ${results.length} subscription(s): ${results.map(r => `${r.kind || "?"}:${r.status}`).join(", ")}`);
    }
    return { channelDeliveries: results };
  }, "channels");

  // ── enrichContext: surface channel info + peer summaries ────────────
  //
  // Two jobs in one handler:
  //
  // 1. Light metadata ("channels" field) — the declared subscriptions so
  //    the AI knows what wires exist off this node.
  //
  // 2. Peer-peek ("peers" field) — for every active subscription, resolve
  //    the domain extension that owns the peer's root. If its vocabulary
  //    matches the current turn's message, call its getBriefForPrompt()
  //    and attach the one-line summary. This is how a user at /Fitness
  //    asking "did I eat protein" gets food's daily macros injected into
  //    fitness-coach's prompt without bloating every turn: the vocab
  //    gate is the SAME gate routing uses, so peers only light up when
  //    they would have claimed the message anyway.
  //
  // Fails open: any error on a single peer skips just that peer, never
  // breaks the turn.

  core.hooks.register("enrichContext", async ({ context, meta, message }) => {
    const channelMeta = meta.channels;
    if (!channelMeta?.subscriptions?.length) return;

    const active = channelMeta.subscriptions.filter(s => s.active);
    if (active.length === 0) return;

    context.channels = active.map(s => ({
      name: s.channelName,
      partner: s.partnerName,
      direction: s.direction,
      filter: s.filter?.tags || null,
    }));

    if (channelMeta.pending?.length > 0) {
      context.pendingChannelInvites = channelMeta.pending.length;
    }

    // ── Peer-peek ─────────────────────────────────────────────────────
    // Skip when there's no message to vocab-test against (background
    // scans / dump mode / getContextForAi without a message).
    if (!message || typeof message !== "string") return;

    let resolveDomainExtensionAtRoot, getExtension, flattenVocabulary;
    try {
      const loader = await import("../loader.js");
      resolveDomainExtensionAtRoot = loader.resolveDomainExtensionAtRoot;
      getExtension = loader.getExtension;
      flattenVocabulary = loader.flattenVocabulary;
    } catch {
      return;
    }

    // De-duplicate by peer rootId — if two subscriptions point at the
    // same peer root (rare, but possible), we only peek once.
    const seenRoots = new Set();
    const peers = {};
    let Node = null;

    for (const sub of active) {
      const peerRootId = sub?.agent?.rootId || sub?.partnerRootId || null;
      if (!peerRootId || seenRoots.has(peerRootId)) continue;
      seenRoots.add(peerRootId);

      try {
        if (!Node) Node = (await import("../../seed/models/node.js")).default;
        const peerNode = await Node.findById(peerRootId).select("metadata").lean();
        if (!peerNode) continue;

        const peerExtName = resolveDomainExtensionAtRoot(peerNode.metadata);
        if (!peerExtName) continue;
        if (peers[peerExtName]) continue;  // first peer of this domain wins

        // Vocab gate. If the peer extension's vocabulary doesn't claim
        // any part of the user's message, don't pay for the brief.
        const peerExt = getExtension(peerExtName);
        const peerManifest = peerExt?.manifest;
        if (!peerManifest) continue;
        const hints = flattenVocabulary(peerManifest) || [];
        if (hints.length === 0) continue;
        if (!hints.some(re => re.test(message))) continue;

        // Peer passes the gate. Ask for its one-line summary.
        const brief = await peerExt?.exports?.getBriefForPrompt?.(peerRootId);
        if (typeof brief === "string" && brief.length > 0) {
          peers[peerExtName] = brief;
        }
      } catch (err) {
        // Single peer failure never aborts the rest of enrichContext.
        log.debug("Channels", `peer-peek failed for ${peerRootId}: ${err.message}`);
      }
    }

    if (Object.keys(peers).length > 0) {
      context.peers = peers;
    }
  }, "channels");


  const { default: router } = await import("./routes.js");

  // ── Register quick links via treeos-base slot registry ────────────
  // "Rooms" link appears on user profile + tree pages so users can find
  // the rooms UI without knowing the URL.
  try {
    const { getExtension } = await import("../loader.js");
    const treeos = getExtension("treeos-base")?.exports;
    if (treeos?.registerSlot) {
      treeos.registerSlot("user-quick-links", "channels", ({ queryString }) =>
        `<li><a href="/rooms${queryString || ""}">Rooms</a></li>`,
        { priority: 30 }
      );
      treeos.registerSlot("tree-quick-links", "channels", ({ queryString }) =>
        `<a href="/rooms${queryString || ""}" class="back-link">Rooms</a>`,
        { priority: 45 }
      );
    }
  } catch (err) {
    log.debug("Channels", `Quick-links slot registration skipped: ${err.message}`);
  }

  // ── Register room visualization pages via html-rendering ────────────
  // /rooms           list view
  // /rooms/map       graph view (trees-and-rooms)
  // /rooms/:roomId   transcript viewer
  try {
    const { getExtension } = await import("../loader.js");
    const html = getExtension("html-rendering")?.exports;
    if (html?.registerPage) {
      const { renderRoomsList, renderRoomTranscript, renderRoomsMap } = await import("./pages/rooms.js");
      const authenticate = (await import("../../seed/middleware/authenticate.js")).default;
      // Map BEFORE :roomId so the static segment wins the route match.
      html.registerPage("get", "/rooms", authenticate, async (req, res) => {
        try { res.send(await renderRoomsList({ req })); }
        catch (err) { res.status(500).send(`Rooms page error: ${err.message}`); }
      });
      html.registerPage("get", "/rooms/map", authenticate, async (req, res) => {
        try { res.send(await renderRoomsMap({ nodeModel: core.models.Node, req })); }
        catch (err) { res.status(500).send(`Rooms map error: ${err.message}`); }
      });
      html.registerPage("get", "/rooms/:roomId", authenticate, async (req, res) => {
        try { res.send(await renderRoomTranscript({ roomId: req.params.roomId, nodeModel: core.models.Node, req })); }
        catch (err) { res.status(500).send(`Transcript page error: ${err.message}`); }
      });
      log.info("Channels", "Room pages registered at /rooms, /rooms/map, /rooms/:id");
    }
  } catch (err) {
    log.debug("Channels", `Room pages not registered: ${err.message}`);
  }

  // Clear any stale agent in-flight locks from orchestrations that were
  // interrupted by the last shutdown. Without this sweep, a process crash
  // or restart mid-orchestration leaves the lock held until its 45-min TTL
  // expires and all future dispatches to those agents short-circuit.
  try {
    const Node = core.models.Node;
    const rooms = await Node.find({ "metadata.channels.room": { $exists: true } }).select("_id metadata").lean();
    let cleared = 0;
    for (const r of rooms) {
      const meta = r.metadata instanceof Map ? r.metadata.get("channels") : r.metadata?.channels;
      const subs = meta?.subscriptions || [];
      let dirty = false;
      for (const s of subs) {
        if (s._runningAt) { s._runningAt = null; dirty = true; cleared++; }
      }
      if (dirty) {
        const doc = await Node.findById(r._id);
        if (doc) await core.metadata.setExtMeta(doc, "channels", meta);
      }
    }
    if (cleared > 0) log.info("Channels", `Cleared ${cleared} stale agent lock(s) from previous shutdown`);
  } catch (err) {
    log.debug("Channels", `Stale-lock sweep skipped: ${err.message}`);
  }

  log.info("Channels", "Direct signal channels + rooms loaded");

  // Make room-* tools available in the default conversational modes.
  // Matches how channel-* tools ship: on by default wherever channels is
  // loaded; can be turned off per-tree via `ext-block channels`.
  //
  // Tree zone gets the full set — binding an agent to (rootId, nodeId) is
  // a tree-scoped activity, so room-join-agent lives only here.
  //
  // Home zone is where the user oversees their rooms (create, list, peek,
  // post, leave, join themselves or observers). Binding a specific tree
  // to a room requires tree-zone context, so room-join-agent is omitted.
  const ROOM_TOOLS_TREE = [
    "room-create", "room-join-agent", "room-join-user", "room-join-observer",
    "room-leave", "room-post", "room-list", "room-peek",
  ];
  const ROOM_TOOLS_HOME = [
    "room-create", "room-join-user", "room-join-observer",
    "room-leave", "room-post", "room-list", "room-peek",
  ];

  return {
    router,
    tools,
    modeTools: [
      // Main conversational modes in the tree zone. Classification can
      // land on any of these depending on the user's wording, so all
      // carry the full tree room tool set to keep the UX consistent.
      { modeKey: "tree:respond",   toolNames: ROOM_TOOLS_TREE },
      { modeKey: "tree:converse",  toolNames: ROOM_TOOLS_TREE },
      { modeKey: "tree:librarian", toolNames: ROOM_TOOLS_TREE },
      { modeKey: "home:default",   toolNames: ROOM_TOOLS_HOME },
    ],
    exports: {
      getChannels,
      createChannel,
      removeChannel,
      acceptInvite,
      deliverToChannels,
      // Rooms
      createRoom,
      addAgentParticipant,
      addUserParticipant,
      addObserverParticipant,
      removeParticipant,
      postToRoom,
      readRoomTranscript,
      listRooms,
    },
  };
}
