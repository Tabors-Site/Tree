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
let _toggleButton = null;

// Standalone fixed-position toggle. Sits below the "Branches" button
// (top:56 + button height + gap ≈ top:96). Previously the toggle
// lived as a tiny "text" button inside the address bar, which was
// undiscoverable — too small, too crowded, label too generic.
// Mounted once from main.js after the branch-bar so both buttons
// share the same left-edge column.
export function mountFlatPanelButton(L) {
  if (_toggleButton) return _toggleButton;
  const b = document.createElement("button");
  b.id = "flat-mode-button";
  b.type = "button";
  b.title = "menu — text view of this place (M or \\)";
  b.textContent = "menu";
  // Z-index 200 sits above the flat-panel overlay so the button stays
  // reachable when the panel is up — though openFlatPanel hides it
  // anyway since the flat panel's own top-bar carries the inverse
  // toggle (a back-to-3D button) right next to where this lives.
  b.style.cssText = [
    "position: fixed",
    "top: 96px",
    "left: 12px",
    "z-index: 200",
    "pointer-events: auto",
    "background: rgba(10, 13, 12, 0.85)",
    "color: #c8d3cb",
    "border: 1px solid #2c3a32",
    "border-radius: 6px",
    "padding: 6px 10px",
    "font-family: ui-monospace, monospace",
    "font-size: 12px",
    "cursor: pointer",
    "display: flex",
    "align-items: center",
    "gap: 6px",
  ].join("; ");
  b.addEventListener("mouseenter", () => { b.style.borderColor = "#8fbf9f"; });
  b.addEventListener("mouseleave", () => { b.style.borderColor = "#2c3a32"; });
  b.addEventListener("click", () => toggleFlatPanel(L));
  document.body.appendChild(b);
  _toggleButton = b;
  return b;
}

// Show / hide the floating left-column buttons ("Branches" and 📃
// letters). When the flat panel is open both are hidden — the panel
// has its own top-bar controls — to keep the panel's address bar
// unobstructed.
function _setLeftColumnVisible(visible) {
  const display = visible ? "" : "none";
  const branchBtn = document.getElementById("branch-tree-button");
  if (branchBtn) branchBtn.style.display = display;
  const textBtn = document.getElementById("flat-mode-button");
  if (textBtn) textBtn.style.display = display;
}

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

  // Hide the floating 3D-mode toggle buttons ("Branches" + 📃) so they stop
  // covering the flat-panel address bar. The flat panel carries its
  // own timeline trigger inside #top-bar (see host.js).
  _setLeftColumnVisible(false);

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

  // Restore the floating 3D-mode toggle buttons now that the panel
  // is gone.
  _setLeftColumnVisible(true);

  // Heaven-child redirect. The flat view lets the user browse heaven
  // catalogs (./beings, ./operations, ./roles, ./threads, ./extensions)
  // that the 3D scene has nothing to render at. If the panel is
  // closing on one, navigate back to the last "real" place the user
  // was at before showing the scene again. That way text mode is the
  // tool for catalog browsing without yanking the world out from
  // under the user on close.
  const currentAddr = L?.state?.currentAddress;
  const lastReal    = L?.state?.lastNonHeavenAddress;
  const isHeaven    = typeof L?.isHeavenChildAddress === "function"
    && L.isHeavenChildAddress(currentAddr);
  if (isHeaven && lastReal && lastReal !== currentAddr && typeof L.navigate === "function") {
    // navigate() updates state.currentAddress, refetches descriptor,
    // and re-renders the scene. Fire-and-forget — the resume below
    // unpauses the loop; once the descriptor lands the scene renders
    // the restored place.
    L.navigate(lastReal).catch((err) => {
      console.warn("[flat-panel] restore navigation failed:", err?.message);
    });
  }

  if (L?.scene && typeof L.scene.resume === "function") {
    L.scene.resume();
  }

  // After scene resumes, recenter the camera on the selected being
  // if there is one. The being may have moved (active-position
  // reconciler, once it ships); either way the camera lands wherever
  // the being currently is, so the user doesn't have to hunt.
  // Skipped when we just kicked off a navigation above — the new
  // descriptor's preload + render owns the camera placement.
  const sel = L?.state?.selectedBeing;
  if (!isHeaven && sel?.beingId && L?.scene?.recenterCamera) {
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
