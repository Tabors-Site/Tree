// TreeOS Portal — the Being Picker.
//
// The "name, no being" floor: you are signed into your NAME but driving no
// being yet. This lists the beings your name owns (from the name-aware arrival
// roster / nameSee) and lets you pick one + a branch and CONNECT into it —
// passwordless, because your name already authed (the owned-connect path). It
// also offers signing out of the name (back to the Name menu).
//
// Each being is `@<name>` on a branch `#<branch>`; connecting drives that being
// in this tab. (Connecting to ANOTHER being from inside the world opens a new
// tab — that lives in the shell, not here.)

let _overlay = null;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/** Remove the Being Picker overlay if it is up. */
export function hideBeingPicker() {
  if (_overlay) { _overlay.remove(); _overlay = null; }
}

/**
 * Show the Being Picker.
 *
 * @param {object}   opts
 * @param {object}   opts.client        the PortalClient (nameSee)
 * @param {string}   opts.realityDomain shown in the IBPA
 * @param {string}   opts.nameId        the signed-in name
 * @param {Function} opts.onConnect     (beingName, branch) => connect into it
 * @param {Function} opts.onSignOut     () => release the name (Name menu)
 */
export async function showBeingPicker({ client, realityDomain = "", nameId, onConnect = () => {}, onSignOut = () => {} }) {
  hideBeingPicker();
  injectStyles();

  const overlay = el("div", "nf-overlay");
  const card = el("div", "nf-card bp-card");
  overlay.appendChild(card);

  card.appendChild(el("div", "nf-ibpa", realityDomain || "this reality"));
  const head = el("div", "bp-head");
  head.appendChild(el("h1", "nf-title", "Your beings"));
  const out = el("button", "bp-signout", "sign out");
  out.title = "sign out of your name (back to the Name menu)";
  out.onclick = () => { hideBeingPicker(); onSignOut(); };
  head.appendChild(out);
  card.appendChild(head);
  card.appendChild(el("p", "nf-sub", "Pick a being to drive. You own these, so no password is needed."));

  const list = el("div", "bp-list");
  const status = el("div", "nf-status");
  card.appendChild(list);
  card.appendChild(status);

  document.body.appendChild(overlay);
  _overlay = overlay;

  // Load the name's beings (leak-safe descriptor; no key).
  list.appendChild(el("div", "bp-loading", "loading your beings…"));
  let desc = null;
  try {
    desc = await client.nameSee(nameId);
  } catch (err) {
    list.innerHTML = "";
    status.textContent = `Couldn't load your beings: ${err?.message || err}`;
    status.className = "nf-status nf-err";
    return overlay;
  }
  list.innerHTML = "";

  const beings = Array.isArray(desc?.beings) ? desc.beings : [];
  if (beings.length === 0) {
    list.appendChild(el("div", "bp-empty", "You have no beings yet. Birth your first one to enter the world."));
    return overlay;
  }

  for (const b of beings) {
    const row = el("div", "bp-row");
    const meta = el("div", "bp-meta");
    meta.appendChild(el("div", "bp-name", `@${b.name || "(unnamed)"}`));
    meta.appendChild(el("div", "bp-branch", `#${b.homeBranch || "main"}`));
    row.appendChild(meta);

    const branchInput = el("input", "bp-branch-input");
    branchInput.value = b.homeBranch || "0";
    branchInput.title = "branch to connect on";
    row.appendChild(branchInput);

    const go = el("button", "nf-btn nf-primary bp-connect", "Connect");
    go.onclick = async () => {
      go.disabled = true;
      status.textContent = `Connecting to @${b.name}…`;
      status.className = "nf-status";
      try {
        await onConnect(b.name, branchInput.value.trim() || b.homeBranch || "0");
        hideBeingPicker();
      } catch (err) {
        status.textContent = `Connect failed: ${err?.message || err}`;
        status.className = "nf-status nf-err";
        go.disabled = false;
      }
    };
    row.appendChild(go);
    list.appendChild(row);
  }

  return overlay;
}

let _stylesInjected = false;
function injectStyles() {
  if (_stylesInjected) return;
  _stylesInjected = true;
  const css = `
.nf-overlay{position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;
  background:rgba(8,10,14,.92);backdrop-filter:blur(6px);font-family:system-ui,sans-serif;color:#e7eaf0;}
.nf-card{width:min(440px,92vw);background:#11151c;border:1px solid #232a36;border-radius:14px;
  padding:24px 24px 20px;box-shadow:0 20px 60px rgba(0,0,0,.5);}
.nf-ibpa{font-family:ui-monospace,monospace;font-size:12px;color:#7d8aa0;letter-spacing:.04em;}
.nf-title{margin:6px 0 2px;font-size:26px;font-weight:700;}
.nf-sub{margin:0 0 16px;font-size:13px;color:#9aa6ba;line-height:1.45;}
.nf-btn{padding:9px 14px;border:1px solid #2a3240;background:#1b2433;color:#e7eaf0;border-radius:8px;
  font-size:13px;cursor:pointer;}
.nf-btn[disabled]{opacity:.6;cursor:default;}
.nf-primary{background:#4a6cf7;border-color:#4a6cf7;color:#fff;font-weight:600;}
.nf-status{margin-top:12px;font-size:12.5px;min-height:16px;color:#9aa6ba;}
.nf-ok{color:#5fd08a;} .nf-err{color:#f0795f;}
.bp-head{display:flex;align-items:center;justify-content:space-between;}
.bp-signout{background:transparent;border:1px solid #2a3240;color:#9aa6ba;border-radius:7px;
  padding:5px 10px;font-size:12px;cursor:pointer;}
.bp-list{display:flex;flex-direction:column;gap:8px;max-height:50vh;overflow-y:auto;}
.bp-row{display:flex;align-items:center;gap:10px;padding:10px 12px;background:#0c1118;border:1px solid #232a36;
  border-radius:9px;}
.bp-meta{flex:1;min-width:0;}
.bp-name{font-weight:600;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.bp-branch{font-family:ui-monospace,monospace;font-size:11px;color:#7d8aa0;}
.bp-branch-input{width:70px;padding:7px 8px;border:1px solid #2a3240;background:#0b0f15;color:#e7eaf0;
  border-radius:7px;font-family:ui-monospace,monospace;font-size:12px;outline:none;}
.bp-branch-input:focus{border-color:#4a6cf7;}
.bp-connect{flex:0 0 auto;}
.bp-loading,.bp-empty{padding:14px;color:#9aa6ba;font-size:13px;text-align:center;}
`;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
}
