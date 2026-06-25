// TreeOS Portal . core/boot.js
//
// THE entry. Both HTML entries (index.html → 3d-first, text.html →
// text-first) load this module; the only difference between them is
// the default view, read from <html data-default-view> or ?view=.
//
// Boot order: consume any inhabit handoff → create the primary
// context → mount the shell (chrome up, status visible) → bootstrap
// + connect + land → mount the default view (it renders the already-
// landed descriptor; no second fetch).

import { setPortalStatus } from "../shared/portal-status.js";
import { consumeInhabitHash, createPortalContext, wirePresence } from "./context.js";
import { mountShell } from "./shell.js";
import { VIEW_NAMES } from "./views.js";

function resolveDefaultView() {
  try {
    const q = new URLSearchParams(location.search).get("view");
    if (q && VIEW_NAMES.includes(q)) return q;
  } catch {}
  const attr = document.documentElement.dataset.defaultView;
  return VIEW_NAMES.includes(attr) ? attr : "3d";
}

async function main() {
  consumeInhabitHash(); // must run before the stored session loads

  const primaryCtx = createPortalContext({ id: "main", persist: true });
  wirePresence(primaryCtx);

  const defaultView = resolveDefaultView();
  const shell = mountShell({
    rootEl: document.getElementById("portal-root"),
    primaryCtx,
    defaultView,
  });

  await shell.startPrimary();
  await shell.switchView(defaultView);
}

main().catch((err) => {
  console.error("[portal] fatal:", err);
  setPortalStatus(`fatal: ${err?.message || err}`);
});
