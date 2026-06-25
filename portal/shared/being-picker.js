// TreeOS Portal — the Being Panel.
//
// The "name, no being" surface: you are signed into your NAME but driving no
// being yet, so you stand on the ARRIVAL FLOOR (the cherub gate) in the world.
// This is NOT a wall — it's a NON-BLOCKING docked panel: the world (and cherub)
// stays visible and interactive beside it, and you can close it.
//
// It lists the beings your name owns (client.nameSee) so you can drive one
// (passwordless owned be:connect), offers "birth your first being" (summon:mate
// @cherub — the name's first TOP-LEVEL being, owned by the name), and a sign
// out (name:release, back to the Name menu).

let _panel = null;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/** Remove the Being Panel if it is up. */
export function hideBeingPicker() {
  if (_panel) { _panel.remove(); _panel = null; }
}

/**
 * Show the Being Panel (non-blocking, docked).
 *
 * @param {object}   opts
 * @param {object}   opts.client        the PortalClient (nameSee)
 * @param {string}   opts.storyDomain shown in the header
 * @param {string}   opts.nameId        the signed-in name
 * @param {Function} opts.onConnect     (beingName, history) => drive that being
 * @param {Function} opts.onBirthFirst  (beingName) => summon:mate @cherub
 * @param {Function} opts.onSignOut     () => release the name (Name menu)
 */
export async function showBeingPicker({ client, storyDomain = "", nameId, onConnect = () => {}, onBirthFirst = () => {}, onSignOut = () => {} }) {
  hideBeingPicker();
  injectStyles();

  const panel = el("div", "bp-dock");
  const card = el("div", "bp-card");
  panel.appendChild(card);

  const head = el("div", "bp-head");
  const titles = el("div", "bp-titles");
  titles.appendChild(el("div", "bp-ibpa", storyDomain || "this story"));
  titles.appendChild(el("h1", "bp-title", "Your beings"));
  head.appendChild(titles);
  const close = el("button", "bp-x", "×");
  close.title = "close (you stay signed in, on the arrival floor)";
  close.onclick = () => hideBeingPicker();
  head.appendChild(close);
  card.appendChild(head);

  card.appendChild(el("p", "bp-sub", "Drive one of your beings (no password — you own them), or birth your first one through cherub. Close this to stand at the arrival floor."));

  // ── Birth your first being (summon:mate @cherub). Always offered; this is
  //    how a name makes its first TOP-LEVEL being, owned by the name.
  const birthRow = el("div", "bp-birth");
  const birthName = el("input", "bp-input");
  birthName.placeholder = "name your first being";
  const birthGo = el("button", "bp-btn bp-primary", "Birth your first being");
  birthGo.title = "summon:mate cherub — your first being, owned by your name";
  const status = el("div", "bp-status");
  birthGo.onclick = async () => {
    const nm = birthName.value.trim();
    if (!nm) { status.textContent = "Give your first being a name."; status.className = "bp-status bp-err"; return; }
    birthGo.disabled = true; status.textContent = `Birthing @${nm} through cherub…`; status.className = "bp-status";
    try {
      await onBirthFirst(nm);
      status.textContent = `@${nm} born — connecting…`; status.className = "bp-status bp-ok";
    } catch (err) {
      status.textContent = `Couldn't birth: ${err?.message || err}`; status.className = "bp-status bp-err";
      birthGo.disabled = false;
    }
  };
  birthRow.appendChild(birthName);
  birthRow.appendChild(birthGo);
  card.appendChild(birthRow);
  card.appendChild(status);

  const sep = el("div", "bp-sep", "your beings");
  card.appendChild(sep);

  const list = el("div", "bp-list");
  card.appendChild(list);

  const foot = el("div", "bp-foot");
  const out = el("button", "bp-signout", "sign out of your name");
  out.title = "sign out of your name (name:release) — back to the Name menu";
  out.onclick = () => { hideBeingPicker(); onSignOut(); };
  foot.appendChild(out);
  card.appendChild(foot);

  document.body.appendChild(panel);
  _panel = panel;

  // Load the name's beings (leak-safe descriptor; no key).
  list.appendChild(el("div", "bp-loading", "loading your beings…"));
  let desc = null;
  try {
    desc = await client.nameSee(nameId);
  } catch (err) {
    list.innerHTML = "";
    list.appendChild(el("div", "bp-empty", `Couldn't load your beings: ${err?.message || err}`));
    return panel;
  }
  list.innerHTML = "";

  const beings = Array.isArray(desc?.beings) ? desc.beings : [];
  if (beings.length === 0) {
    list.appendChild(el("div", "bp-empty", "No beings yet — birth your first one above to enter the world as it."));
    sep.style.display = "none";
    return panel;
  }

  for (const b of beings) {
    const row = el("div", "bp-row");
    const meta = el("div", "bp-meta");
    meta.appendChild(el("div", "bp-name", `@${b.name || "(unnamed)"}`));
    meta.appendChild(el("div", "bp-history", `#${b.homeHistory || "main"}`));
    row.appendChild(meta);

    const historyInput = el("input", "bp-history-input");
    historyInput.value = b.homeHistory || "0";
    historyInput.title = "history to connect on";
    row.appendChild(historyInput);

    const go = el("button", "bp-btn bp-primary bp-connect", "Drive");
    go.onclick = async () => {
      go.disabled = true;
      status.textContent = `Connecting to @${b.name}…`;
      status.className = "bp-status";
      try {
        await onConnect(b.name, historyInput.value.trim() || b.homeHistory || "0");
        hideBeingPicker();
      } catch (err) {
        status.textContent = `Connect failed: ${err?.message || err}`;
        status.className = "bp-status bp-err";
        go.disabled = false;
      }
    };
    row.appendChild(go);
    list.appendChild(row);
  }

  return panel;
}

let _stylesInjected = false;
function injectStyles() {
  if (_stylesInjected) return;
  _stylesInjected = true;
  const css = `
/* NON-BLOCKING: the dock takes no pointer events; only its card does, so the
   world (and cherub on the arrival floor) stays clickable beside it. */
.bp-dock{position:fixed;top:0;right:0;bottom:0;z-index:8000;display:flex;align-items:stretch;
  justify-content:flex-end;pointer-events:none;font-family:system-ui,sans-serif;color:#e7eaf0;}
.bp-card{pointer-events:auto;width:min(380px,92vw);margin:14px;align-self:flex-start;max-height:calc(100vh - 28px);
  overflow:auto;background:#11151cf2;border:1px solid #232a36;border-radius:14px;padding:18px 18px 14px;
  box-shadow:0 20px 60px rgba(0,0,0,.5);backdrop-filter:blur(8px);}
.bp-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;}
.bp-titles{min-width:0;}
.bp-ibpa{font-family:ui-monospace,monospace;font-size:11px;color:#7d8aa0;letter-spacing:.04em;}
.bp-title{margin:4px 0 0;font-size:22px;font-weight:700;}
.bp-x{flex:0 0 auto;background:transparent;border:1px solid #2a3240;color:#9aa6ba;border-radius:7px;
  width:28px;height:28px;font-size:16px;line-height:1;cursor:pointer;}
.bp-sub{margin:8px 0 14px;font-size:12.5px;color:#9aa6ba;line-height:1.45;}
.bp-birth{display:flex;gap:7px;}
.bp-input{flex:1;min-width:0;padding:9px 11px;border:1px solid #2a3240;background:#0b0f15;color:#e7eaf0;
  border-radius:8px;font-size:13px;outline:none;}
.bp-input:focus{border-color:#4a6cf7;}
.bp-btn{padding:9px 13px;border:1px solid #2a3240;background:#1b2433;color:#e7eaf0;border-radius:8px;
  font-size:13px;cursor:pointer;white-space:nowrap;}
.bp-btn[disabled]{opacity:.6;cursor:default;}
.bp-primary{background:#4a6cf7;border-color:#4a6cf7;color:#fff;font-weight:600;}
.bp-status{margin-top:9px;font-size:12px;min-height:15px;color:#9aa6ba;}
.bp-ok{color:#5fd08a;} .bp-err{color:#f0795f;}
.bp-sep{margin:16px 0 9px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#7d8aa0;
  border-top:1px solid #1d2430;padding-top:11px;}
.bp-list{display:flex;flex-direction:column;gap:8px;}
.bp-row{display:flex;align-items:center;gap:9px;padding:9px 11px;background:#0c1118;border:1px solid #232a36;border-radius:9px;}
.bp-meta{flex:1;min-width:0;}
.bp-name{font-weight:600;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.bp-history{font-family:ui-monospace,monospace;font-size:11px;color:#7d8aa0;}
.bp-history-input{width:58px;padding:6px 7px;border:1px solid #2a3240;background:#0b0f15;color:#e7eaf0;
  border-radius:7px;font-family:ui-monospace,monospace;font-size:12px;outline:none;}
.bp-history-input:focus{border-color:#4a6cf7;}
.bp-connect{flex:0 0 auto;}
.bp-loading,.bp-empty{padding:12px;color:#9aa6ba;font-size:12.5px;}
.bp-foot{margin-top:14px;border-top:1px solid #1d2430;padding-top:11px;}
.bp-signout{background:transparent;border:1px solid #2a3240;color:#9aa6ba;border-radius:7px;
  padding:6px 11px;font-size:12px;cursor:pointer;}
`;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
}
