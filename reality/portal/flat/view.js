// TreeOS Portal — the text view.
//
// Implements the view contract (core/views.js) over the flat
// renderer. Document layout: descriptor fields as panels, lists,
// forms, breadcrumbs; HTML-native (and HTML stays the text view's
// substrate at every phase — see ../PORTAL.md "HTML stays for the
// text view"). The flat modules' `flat` singleton is a mount-scoped
// adapter populated from the PortalContext on every mount; the
// context's state model remains the single source.

import { mountFlatView } from "./host.js";

export function createView() {
  let ctx = null;
  let root = null;
  let wrapper = null;
  let handle = null;
  const teardowns = [];

  function mountInner() {
    handle = mountFlatView(wrapper, {
      client:        ctx.client,
      descriptor:    ctx.state.get("descriptor"),
      discovery:     ctx.state.get("discovery"),
      session:       ctx.state.get("session"),
      selectedBeing: ctx.state.get("selectedBeing"),
      onNavigate: (address) => {
        ctx.navigation.navigate(address).catch(() => {});
      },
      onSelectBeing: (beingId, name) => ctx.navigation.selectBeing(beingId, name),
      onSignIn: (op, name, password, opts) => ctx.signIn(op, name, password, opts),
      onSignOut: () => ctx.signOut(),
      // The name layer is the single auth path: re-present the shell's Name Form
      // / being menu (NOT a flat-local claim/register overlay — that bypassed
      // the name layer and could mint an i-am being).
      onNameAuth: () => ctx.shell?.presentNameGate?.(),
      onClose: () => ctx.shell?.switchView("3d"),
    });
  }

  function mount(rootEl, portalCtx) {
    ctx = portalCtx;
    root = rootEl;
    wrapper = document.createElement("div");
    wrapper.style.cssText =
      "position:absolute; inset:0; overflow:auto; background:#0a0d0c; color:#c8d3cb;";
    root.appendChild(wrapper);
    mountInner();

    // Sign-in / sign-out swaps the client; remount so every flat
    // module reads the live connection (the singleton is populated
    // per mount).
    teardowns.push(ctx.events.on("client", () => {
      try { handle?.dispose(); } catch {}
      mountInner();
      const desc = ctx.state.get("descriptor");
      if (desc) handle.update(desc);
    }));
  }

  function onDescriptor(desc) {
    handle?.update(desc);
  }

  function onSelection(sel) {
    // Selection changed (here or in another view): mirror it and
    // repaint so the menubar's @being menu appears/retargets.
    handle?.setSelection?.(sel);
    const desc = ctx.state.get("descriptor");
    if (desc) handle?.update(desc);
  }

  function destroy() {
    for (const fn of teardowns.splice(0)) { try { fn(); } catch {} }
    try { handle?.dispose(); } catch {}
    handle = null;
    wrapper?.remove();
    wrapper = null;
    root = null;
  }

  return { mount, onDescriptor, onSelection, destroy };
}
