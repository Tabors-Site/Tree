// TreeOS Portal . core/views.js
//
// The view registry and the view host. A VIEW is a way of rendering
// the current IBP state; the four views ARE the TreeOS user space
// (see ../PORTAL.md "The four views"). The registry is a closed set —
// extensions don't add views; growth happens by enriching the
// kernel's response and letting all four show it.
//
// Every view module exports createView() returning the contract:
//
//   {
//     mount(rootEl, ctx),         // draw into rootEl, read from ctx
//     onDescriptor(desc, meta),   // descriptor arrived or changed
//     onSelection(beingOrMatter), // cross-view focus changed
//     destroy(),                  // unmount, release listeners
//   }
//
// Modules load lazily: a text-first session never pays for Three.js.

// The four views are RENDERS; the statement bar (shared, at the bottom) is what ACTS — any
// Name with a being types the Word live in any view and the world changes under it. Retired
// 2026-06-18: "console" (traditional-computing drift) and "history" (raw verb:op, superseded
// by story). "text" renamed to "GUI".
const REGISTRY = {
  "3d":       () => import("../3d/view.js"),
  "GUI":      () => import("../flat/view.js"),
  "explorer": () => import("../explorer/view.js"),
  // The STORY view: the same `assembleStory` fold the LLM's RECALL reads, painted — facts woven
  // into past-tense Word, who × when × where. The machine as its own biography.
  "story":    () => import("../story/view.js"),
};

export const VIEW_NAMES = Object.keys(REGISTRY);

export function createViewHost(rootEl) {
  let active = null;        // { name, view, ctx }
  let unsubscribe = null;
  let switchSeq = 0;        // latest-wins guard for concurrent switches

  function _bindState(ctx, view) {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    unsubscribe = ctx.state.subscribe((partial, meta) => {
      if ("descriptor" in partial && partial.descriptor) {
        view.onDescriptor?.(partial.descriptor, meta);
      }
      if ("selectedBeing" in partial) {
        view.onSelection?.(partial.selectedBeing);
      }
    });
  }

  async function switchView(name, ctx) {
    if (!REGISTRY[name]) throw new Error(`unknown view "${name}"`);
    if (active && active.name === name && active.ctx === ctx) return active.view;
    const seq = ++switchSeq;

    const load = REGISTRY[name]();           // start the import first
    if (active) {
      try { active.view.destroy?.(); }
      catch (err) { console.warn(`[portal:views] destroy of "${active.name}" threw:`, err?.message || err); }
      active = null;
    }
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    rootEl.innerHTML = "";

    const mod = await load;
    if (seq !== switchSeq) return null;      // a newer switch superseded us
    const view = mod.createView();
    active = { name, view, ctx };
    ctx.state.set({ activeView: name });
    view.mount(rootEl, ctx);
    _bindState(ctx, view);
    // Feed the current descriptor so the swap is a render, not a refetch.
    const desc = ctx.state.get("descriptor");
    if (desc) view.onDescriptor?.(desc, { reason: "navigate", resetCamera: true, initial: true });
    return view;
  }

  return {
    switchView,
    get activeName() { return active?.name || null; },
    get activeCtx() { return active?.ctx || null; },
    destroy() {
      if (unsubscribe) { unsubscribe(); unsubscribe = null; }
      try { active?.view.destroy?.(); } catch {}
      active = null;
      rootEl.innerHTML = "";
    },
  };
}
