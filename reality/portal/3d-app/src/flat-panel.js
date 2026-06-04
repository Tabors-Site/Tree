// TreeOS Portal 3D — flat-panel.
//
// Toggleable text-mode overlay that takes over the viewport. Mounts
// the shared flat renderer (portal/shared/flat/host.js) into an
// overlay div, pauses the Three.js scene while up, and resumes it on
// close. Both modes always render the same IBP address — the panel
// reads L.state.descriptor and re-renders on the same descriptor
// events the scene subscribes to, so they stay synced trivially.

import { mountFlatView } from "../../shared/flat/host.js";

let _overlay = null;
let _handle  = null;

export function isFlatPanelOpen() {
  return !!_overlay;
}

export function openFlatPanel(L) {
  if (_overlay) return;
  if (!L?.state?.client) {
    console.warn("[flat-panel] no client — cannot open");
    return;
  }

  // Mount overlay div above every other panel. Full viewport, dark
  // theme. Pointer events on so it captures clicks.
  _overlay = document.createElement("div");
  _overlay.className = "flat-panel-overlay";
  _overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 100;
    background: #0a0d0c; color: #c8d3cb;
    overflow: auto; pointer-events: auto;
  `;
  document.body.appendChild(_overlay);

  // Pause the scene before mounting. Mount happens while the scene
  // graph is frozen, so a render-flicker on switch is impossible.
  if (L.scene && typeof L.scene.pause === "function") {
    L.scene.pause();
  }

  _handle = mountFlatView(_overlay, {
    client:         L.state.client,
    descriptor:     L.state.descriptor,
    discovery:      L.state.discovery,
    session:        L.state.session,
    selectedBeing:  L.state.selectedBeing,
    onNavigate(address) {
      // Route through the 3D portal's existing navigate() so the
      // hash, history, and descriptor pipeline all update together.
      if (typeof L.navigate === "function") L.navigate(address);
    },
    onSignIn(op, name, password) {
      // The 3D portal owns the auth flow; the flat view delegates.
      if (typeof L.signIn === "function") return L.signIn(op, name, password);
    },
    onSignOut() {
      if (typeof L.signOut === "function") return L.signOut();
    },
    onClose() {
      closeFlatPanel(L);
    },
  });

  // Subscribe to descriptor changes so the panel updates when
  // navigations or live events land. L.subscribeDescriptor returns
  // an unsubscribe; we capture it for dispose.
  if (typeof L.subscribeDescriptor === "function") {
    _handle._unsubscribeDescriptor = L.subscribeDescriptor((desc) => {
      if (_handle && desc) _handle.update(desc);
    });
  }

  // Stub: request that the selected being position adjacent to the
  // user. The portal-side hook for the future substrate-side
  // active-position reconciler. No-op until the reconciler lands.
  requestAdjacency(L, L.state.selectedBeing?.beingId);
}

export function closeFlatPanel(L) {
  if (!_overlay) return;
  try {
    if (typeof _handle?._unsubscribeDescriptor === "function") {
      _handle._unsubscribeDescriptor();
    }
    _handle?.dispose?.();
  } catch (err) {
    console.warn("[flat-panel] dispose error:", err?.message);
  }
  _handle = null;
  _overlay.remove();
  _overlay = null;

  if (L?.scene && typeof L.scene.resume === "function") {
    L.scene.resume();
  }

  // After scene resumes, recenter the camera on the selected being
  // if there is one. The being may have moved (active-position
  // reconciler, once it ships); either way the camera lands wherever
  // the being currently is, so the user doesn't have to hunt.
  const sel = L?.state?.selectedBeing;
  if (sel?.beingId && L?.scene?.recenterCamera) {
    L.scene.recenterCamera(sel.beingId);
  }
}

export function toggleFlatPanel(L) {
  if (_overlay) closeFlatPanel(L);
  else          openFlatPanel(L);
}

// ──────────────────────────────────────────────────────────────────
// Active-position hook (stub)
// ──────────────────────────────────────────────────────────────────

// Portal-side request that a being's coord be moved adjacent to the
// active user. The substrate-side active-position reconciler decides
// whether/how to honor it. Until that reconciler lands, this logs
// once and returns. Future shape: emit a do:set-being:coord (gated
// by stance-auth on the actor) OR a domain-level "request-presence"
// signal the reconciler picks up.
//
// Wired here so the call site exists and the flow is invocation-
// ready when the reconciler arrives.
function requestAdjacency(L, beingId) {
  if (!beingId) return;
  if (!L?.state?.client) return;
  // No-op stub. See plan: graceful-jingling-garden.md §5 "active-
  // position reconciler" deferred.
  if (L.state?.debugLiveEvents) {
    console.log("[flat-panel] requestAdjacency stub:", beingId);
  }
}
