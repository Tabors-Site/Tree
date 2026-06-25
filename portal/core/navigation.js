// TreeOS Portal . core/navigation.js
//
// The one navigate(address) flow. History stickiness, history
// push/replace, hash sync, live re-subscribe, descriptor publication,
// stale-session and gone-history recovery, the rewind/return-to-now
// pair, and the per-navigate set-being:position emit all live here —
// once. Views never SEE-and-render on their own; they subscribe to
// the state model and render what navigation publishes.
//
// Publication meta (the second argument views receive):
//   { reason: "navigate", resetCamera: true }   a real move
//   { reason: "live",     resetCamera: false }  debounced live refetch
//   { reason: "rewind",   resetCamera: false }  historical SEE (at:)
//   { reason: "now",      resetCamera: false }  back to live, camera kept

// Error codes that mean "this saved pointer no longer corresponds to
// real substrate" — operator reset the DB, deleted being, tombstoned
// home, JWT rotation, deleted history.
export const STALE_SESSION_CODES = new Set([
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NODE_NOT_FOUND",
  "BEING_NOT_FOUND",
  "SPACE_NOT_FOUND",
  "HISTORY_NOT_FOUND",
  "CROSS_HISTORY_FORBIDDEN",
]);

// Heaven children — catalogs (`./beings`, `./operations`, ...) and
// dot-prefixed synthetic views (`/.acts/<id>`, `/.histories`) — are
// addresses the 3D scene has nothing meaningful to render at. The
// text/console/explorer views walk them happily; navigation tracks
// the last NON-heaven address so the 3D view can restore on activate.
export function isHeavenChildAddress(address) {
  if (typeof address !== "string" || address.length === 0) return false;
  const noHistory = address.replace(/#[^/]+/, "");
  const slash = noHistory.indexOf("/");
  const path = slash >= 0 ? noHistory.slice(slash) : noHistory;
  return path.startsWith("/.");
}

export function createNavigation(ctx) {
  const { state, events } = ctx;

  let _refetchTimer = null;
  let _recoveringHistory = false;

  // ── Address shaping ─────────────────────────────────────────────

  // History stickiness. Doctrine (2026-06-04): the address bar IS the
  // source of truth — a FULL typed address without `#` means main.
  // Only relative shorthands ("/foo", "~") inherit the active history.
  function withActiveHistory(address) {
    if (typeof address !== "string" || !address) return address;
    if (address.includes("#")) return address;
    const activeHistory = state.get("descriptor")?.address?.history || "0";
    if (activeHistory === "0") return address;
    const story = state.get("discovery")?.story;
    if (!story) return address;
    if (address.startsWith(story)) return address;
    if (address.startsWith("/") || address.startsWith("~")) {
      return `${story}#${activeHistory}${address === "/" ? "/" : address}`;
    }
    return address;
  }

  // Resolve a console/explorer-style input into a dispatchable
  // address. "@being" targets a being at the current position;
  // bare "/path" and "~" ride history stickiness; full addresses
  // pass through.
  function resolveAddressInput(raw) {
    if (typeof raw !== "string" || !raw) return raw;
    const trimmed = raw.trim();
    if (trimmed.startsWith("@")) {
      const desc = state.get("descriptor");
      const story = state.get("discovery")?.story || desc?.address?.place || "";
      const history = desc?.address?.history || "0";
      const bq = history === "0" ? "" : `#${history}`;
      const path = desc?.address?.pathByNames || "/";
      return `${story}${bq}${path}${trimmed}`.replace(/\/+@/, "/@");
    }
    return withActiveHistory(trimmed);
  }

  // The current position as a full dispatchable address, and the
  // signed-in being's own stance. Shared by every view that emits.
  function currentPositionAddress() {
    const desc = state.get("descriptor");
    const story = state.get("discovery")?.story || "";
    const path = desc?.address?.pathByNames || "/";
    const history = desc?.address?.history || "0";
    const bq = history === "0" ? "" : `#${history}`;
    return `${story}${bq}${path}`.replace(/\/+$/, "") || `${story}${bq}`;
  }

  function selfStance() {
    const session = state.get("session");
    if (session?.beingAddress) return session.beingAddress;
    const story = state.get("discovery")?.story || "";
    const history = state.get("descriptor")?.address?.history || "0";
    const bq = history === "0" ? "" : `#${history}`;
    const name = session?.username || "arrival";
    return `${story}${bq}/@${name}`;
  }

  // THE target-stance builder: the current position with a being as
  // the @qualifier. This is what the IBPA's right side shows when a
  // being is selected, and what SUMMON/DO/BE dispatch against — the
  // IBPA is the source of truth, so views call this instead of
  // hand-rolling `${story}${path}@${being}` strings.
  function stanceFor(beingName) {
    const desc = state.get("descriptor");
    const story = state.get("discovery")?.story || desc?.address?.place || "";
    const history = desc?.address?.history || "0";
    const bq = history === "0" ? "" : `#${history}`;
    const path = desc?.address?.pathByNames || "/";
    return `${story}${bq}${path}@${beingName}`.replace(/\/+@/, "/@");
  }

  // Select a being as the interaction target. The selection IS an
  // address refinement: the IBPA's right stance gains the @qualifier,
  // every view sees the same focus, and dispatches read stanceFor().
  // Pass null to clear. Cleared automatically on a space change.
  function selectBeing(beingId, name) {
    state.set({
      selectedBeing: beingId
        ? {
            beingId: String(beingId),
            name: name || null,
            lastSetAt: new Date().toISOString(),
          }
        : null,
    });
  }

  // ── Hash sync ───────────────────────────────────────────────────

  function restoreAddressFromHash() {
    const raw = (typeof location !== "undefined" ? location.hash : "").replace(
      /^#/,
      "",
    );
    if (!raw) return null;
    if (raw.startsWith("inhabit=")) return null;
    return raw;
  }

  function syncLocationHash(desc) {
    if (typeof location === "undefined") return;
    const existing = location.hash.replace(/^#/, "");
    if (existing.startsWith("inhabit=")) return;
    const story = desc?.address?.place || state.get("discovery")?.story || "";
    if (!story) return;
    const history = desc?.address?.history || "0";
    const path = desc?.address?.pathByNames || "/";
    const bq = history === "0" ? "" : `#${history}`;
    const next = `${story}${bq}${path === "/" ? "/" : path}`;
    if (existing !== next) {
      try {
        history.replaceState(null, "", `${location.pathname}#${next}`);
      } catch {}
    }
  }

  function clearLocationHash() {
    try {
      history.replaceState(null, "", location.pathname);
    } catch {}
  }

  // ── navigate ────────────────────────────────────────────────────

  async function navigate(address, { fromNav = false } = {}) {
    const client = ctx.client;
    if (!client) return;
    try {
      address = withActiveHistory(address);
      // Ghost walk: while a rewind anchor is set, every navigate
      // carries the SAME `at:` qualifier — the user walks around in
      // the past, and all four views render the fold at that moment.
      // (live and at are mutually exclusive on the wire; a historical
      // SEE never subscribes.) Return-to-now clears the anchor.
      const anchor = state.get("historicalAnchor");
      // Subscribe live: every change to this position arrives as a
      // descriptor event we refetch on. "/~" resolves server-side to
      // the caller's Being.homeSpace.
      const desc = anchor
        ? await client.see(address, { at: anchor })
        : await client.see(address, { live: true });

      // Stale-session mid-flight: the operator dropped the DB while
      // the page was open. Drop the session and reconnect anonymously
      // before any DO fires and bounces with BEING_NOT_FOUND.
      if (desc?.identity?.stale === true && state.get("session")) {
        await ctx.dropStaleSessionAndReconnect();
        return;
      }

      // Clear selectedBeing when the SPACE changed — focus was
      // contextual to the previous position. Same-space refreshes
      // keep it so a live event doesn't blow away the selection.
      const priorSpaceId = state.get("descriptor")?.address?.spaceId || null;
      const nextSpaceId = desc?.address?.spaceId || null;

      // Also fetch the caller's canonical inner face at the new
      // stance. Same shape every soul reads (LLM, scripted, human).
      // Live subscribe so reel arrivals on the face's weave refold
      // and push a fresh face. The wire layer registers the per-
      // stance subscription against the weave on this returned face;
      // subsequent calls on the same socket+stance rotate the weave
      // rather than minting a new id. A stance switch lands here too:
      // the new live SEE replaces the prior subscription's weave in
      // one round-trip (no history replay).
      // Best-effort: a failure here just hides the face panel; the
      // existing position descriptor stays the primary view.
      let innerFace = null;
      try {
        innerFace = await client.see("my-inner-face", { live: true });
      } catch {
        innerFace = null;
      }

      const partial = { descriptor: desc, currentAddress: address, innerFace };
      if (priorSpaceId && nextSpaceId && priorSpaceId !== nextSpaceId) {
        partial.selectedBeing = null;
      }
      // The left stance ALWAYS follows where the being is. A live
      // navigate moves the being (the set-being:position fact below),
      // so the actor's position tracks the view; only ghost view
      // leaves it behind (observing the past moves nobody).
      if (!desc?.isHistorical) {
        partial.actorPosition = desc?.address?.pathByNames || "/";
      }

      // History push unless we're stepping through it. Store the FULL
      // IBP-form address (story + history + path) so back/forward
      // restores the exact view even after history hops.
      if (!fromNav) {
        const story =
          desc?.address?.place || state.get("discovery")?.story || "";
        const history = desc?.address?.history || "0";
        const path = desc?.address?.pathByNames || "/";
        const bq = history === "0" ? "" : `#${history}`;
        const canonical = story
          ? `${story}${bq}${path === "/" ? "/" : path}`
          : desc?.address?.pathByNames || address;
        const navStack = state.get("navStack");
        const navIndex = state.get("navIndex");
        if (navStack[navIndex] !== canonical) {
          const trimmed = navStack.slice(0, navIndex + 1);
          trimmed.push(canonical);
          partial.navStack = trimmed;
          partial.navIndex = trimmed.length - 1;
        }
      }

      state.set(partial, { reason: "navigate", resetCamera: true });
      syncLocationHash(desc);

      // Two-humans-walking: mark this space as my position so other
      // sessions' descriptors show me here. Live navigation only —
      // a rewind must never write our LIVE position to a past space.
      if (
        !desc?.isHistorical &&
        desc?.identity?.beingId &&
        desc?.address?.spaceId
      ) {
        const stance = `${desc.address.pathByNames}@${desc.identity.name}`;
        client
          .do(stance, "set-being", {
            field: "position",
            value: desc.address.spaceId,
          })
          .catch((err) => {
            // Surface the failure — this is the seam where every navigate
            // stamps a position fact; a silent bounce here reads as "the
            // portal isn't tracking my walks."
            const msg = `${err?.code || ""} ${err?.message || err}`.trim();
            console.warn("[portal:nav] set-being:position failed:", msg);
            events.emit("status", `position write failed: ${msg}`);
          });
      }
      events.emit("navigated", { address, descriptor: desc });
      return desc;
    } catch (err) {
      events.emit(
        "status",
        `see failed: ${err.code || ""} ${err.message || ""}`,
      );
      // A navigate to a history that no longer exists self-heals to
      // main rather than stranding the client on the previous
      // descriptor (where the self-position loop would storm the
      // gone history). Re-entry guard stops a loop if main fails too.
      if (
        (err?.code === "HISTORY_NOT_FOUND" ||
          err?.code === "CROSS_HISTORY_FORBIDDEN") &&
        !_recoveringHistory
      ) {
        _recoveringHistory = true;
        clearLocationHash();
        try {
          await navigate(`${state.get("discovery")?.story || ""}/`);
          return;
        } catch (err2) {
          console.warn(
            "[portal:nav] history-gone recovery to main failed:",
            err2?.message || err2,
          );
        } finally {
          _recoveringHistory = false;
        }
      }
      throw err;
    }
  }

  // ── History ─────────────────────────────────────────────────────

  function back() {
    const i = state.get("navIndex");
    if (i <= 0) return;
    state.set({ navIndex: i - 1 });
    navigate(state.get("navStack")[i - 1], { fromNav: true });
  }

  function forward() {
    const i = state.get("navIndex");
    const navStack = state.get("navStack");
    if (i >= navStack.length - 1) return;
    state.set({ navIndex: i + 1 });
    navigate(navStack[i + 1], { fromNav: true });
  }

  // ── Rewind / return-to-now ─────────────────────────────────────
  //
  // Rewinding is "same place, different time," not a navigate: the
  // camera keeps its angle, the descriptor goes historical, and the
  // ghost guard (context) blocks every DO/SUMMON/BE until "now".

  async function rewindTo(atTimestamp) {
    const client = ctx.client;
    const address = state.get("currentAddress");
    if (!client || !address || !atTimestamp) return;
    try {
      const desc = await client.see(address, { at: { atTimestamp } });
      // Pin the ghost-walk anchor: subsequent navigates (a doorway in
      // 3D, a folder in explorer, `cd` in console) stay at this
      // moment until return-to-now.
      state.set(
        { descriptor: desc, historicalAnchor: { atTimestamp } },
        { reason: "rewind", resetCamera: false },
      );
      events.emit("status", `rewound to ${atTimestamp}`);
    } catch (err) {
      console.warn("[portal:nav] rewind failed:", err?.message);
    }
  }

  async function returnToNow({ preserveCamera = false } = {}) {
    const client = ctx.client;
    const address = state.get("currentAddress");
    if (!address) return;
    state.set({ historicalAnchor: null });
    if (preserveCamera && client) {
      // Fast-forward playback caught up to present — keep the angle
      // the user was watching from.
      try {
        const desc = await client.see(address);
        state.set({ descriptor: desc }, { reason: "now", resetCamera: false });
      } catch (err) {
        console.warn(
          "[portal:nav] resume-live (preserveCamera) failed:",
          err?.message,
        );
      }
      return;
    }
    await navigate(address);
  }

  // ── Live descriptor events ──────────────────────────────────────
  //
  // "position" / "fact" deltas pass straight through to whichever
  // view subscribes (the 3D scene applies them without a refetch).
  // Everything else triggers a debounced full-descriptor refetch —
  // the fat fallback covering create/delete, qualities writes,
  // ownership changes.

  function handleDescriptorEvent(event) {
    if (!state.get("currentAddress")) return;
    if (state.get("debugLiveEvents")) {
      console.log(
        "[portal:nav] live event:",
        event?.kind,
        event?.spaceId?.slice(0, 8),
      );
    }
    // Ghost-view guard: while rewound, live events must not replace
    // the descriptor — the user is observing a frozen past moment.
    // The history/timeline chrome still refreshes (shell listens for
    // this) so history visibly accumulates beyond the cursor.
    if (state.get("descriptor")?.isHistorical) {
      events.emit("live-while-historical", event);
      return;
    }
    // Inner-face push: a reel the current stance's weave indexes
    // received a fact; the server refolded and pushed the fresh face.
    // Update state.innerFace; consumers (portal face panel, prompt
    // previews) subscribe to that key and re-render. No refetch
    // round-trip; the server already did the work.
    if (event?.kind === "inner-face") {
      // The face rides in event.payload (the client routes
      // envelope.payload.data into the event.payload slot).
      const face = event?.payload || null;
      if (face) {
        state.set({ innerFace: face }, { reason: "live", resetCamera: false });
      }
      return;
    }
    if (event?.kind === "position" || event?.kind === "fact") {
      events.emit(`live-${event.kind}`, event);
      return;
    }
    if (_refetchTimer) return;
    _refetchTimer = setTimeout(async () => {
      _refetchTimer = null;
      if (state.get("descriptor")?.isHistorical) return;
      const client = ctx.client;
      const address = state.get("currentAddress");
      if (!client || !address) return;
      try {
        const desc = await client.see(address);
        state.set({ descriptor: desc }, { reason: "live", resetCamera: false });
      } catch (err) {
        console.warn("[portal:nav] live refetch failed:", err);
      }
    }, 100);
  }

  // ── Landing flows ──────────────────────────────────────────────
  //
  // Where to land right after a socket connects. Anonymous: the URL
  // hash if present, else "/", with substrate-gone and FORBIDDEN
  // fallbacks (a stale hash pointing at a private tree must not
  // strand arrival on a deny screen). Authenticated: hash first,
  // then the being's server-tracked position, then home, then the
  // being stance, then "/".

  async function landAnonymous() {
    state.set({ historicalAnchor: null }); // fresh connection lands in the present
    const fallbackCodes = new Set([...STALE_SESSION_CODES, "FORBIDDEN"]);
    const restored = restoreAddressFromHash() || "/";
    try {
      await navigate(restored);
    } catch (err) {
      if (fallbackCodes.has(err?.code) && restored !== "/") {
        clearLocationHash();
        try {
          await navigate("/");
        } catch {}
      }
    }
  }

  async function landAuthenticated(session, { ignoreHash = false } = {}) {
    state.set({ historicalAnchor: null }); // fresh connection lands in the present
    const client = ctx.client;
    const discovery = state.get("discovery");
    const beingAddress =
      session.beingAddress ||
      (session.username && discovery?.story
        ? `${discovery.story}/@${session.username}`
        : null);

    // Hash priority is for MID-SESSION RELOADS (restore the exact
    // view). On a fresh sign-in/register the hash still holds where
    // the ANONYMOUS arrival was browsing — landing there would yank
    // the new being away from its home/position AND write that yank
    // as a position fact. Fresh sign-ins drop the stale hash and land
    // where the being IS.
    if (ignoreHash) clearLocationHash();
    let landingAddress = (ignoreHash ? null : restoreAddressFromHash()) || "/";
    const landingFromHash = !!landingAddress && landingAddress !== "/";
    if (beingAddress) {
      try {
        const desc = await client.see(beingAddress);
        // Stale-token check: the wire decodes the JWT but the world
        // has no row for that beingId (DB reset, ended being).
        if (desc?.identity?.stale === true) {
          await ctx.dropStaleSessionAndReconnect();
          return false;
        }
        if (!landingFromHash) {
          // position (server-tracked) → homeSpace → session.homeSpaceId
          // (race-proof for a being who JUST registered) → stance.
          const pos = desc?.identity?.position || null;
          const home = desc?.identity?.homeSpace || null;
          const targetSpace = pos || home || session.homeSpaceId || null;
          landingAddress =
            targetSpace && discovery?.story
              ? `${discovery.story}/${targetSpace}`
              : beingAddress;
        }
      } catch (err) {
        if (STALE_SESSION_CODES.has(err?.code)) {
          await ctx.dropStaleSessionAndReconnect();
          return false;
        }
        // Network/timeout — fall through to landing.
      }
    }

    try {
      await navigate(landingAddress);
    } catch (err) {
      if (STALE_SESSION_CODES.has(err?.code)) {
        clearLocationHash();
        try {
          await navigate(beingAddress || "/");
        } catch (err2) {
          if (STALE_SESSION_CODES.has(err2?.code)) {
            await ctx.dropStaleSessionAndReconnect();
            return false;
          }
        }
      }
    }
    return true;
  }

  function destroy() {
    if (_refetchTimer) {
      clearTimeout(_refetchTimer);
      _refetchTimer = null;
    }
  }

  return {
    navigate,
    back,
    forward,
    rewindTo,
    returnToNow,
    withActiveHistory,
    resolveAddressInput,
    currentPositionAddress,
    selfStance,
    stanceFor,
    selectBeing,
    isHeavenChildAddress,
    handleDescriptorEvent,
    restoreAddressFromHash,
    clearLocationHash,
    landAnonymous,
    landAuthenticated,
    destroy,
  };
}
