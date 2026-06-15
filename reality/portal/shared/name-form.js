// TreeOS Portal — the Name Form.
//
// The PRE-WORLD pre-panel: what a connection sees BEFORE it has a name. The
// Name layer sits in front of the world (you need a name to do anything), so
// when the socket carries no nameId the portal shows this instead of landing
// in a world. Its IBPA is just the bare reality domain (the "Name menu").
//
// It speaks the client's `name` channel (nameDeclare / nameConnect / nameSee),
// which rides the dedicated "name" socket event — NOT the world `ibp` verbs.
// Three things, no world underneath them:
//   Connect  real-name + password -> name:connect -> bind the session, enter.
//   Create   real-name + password -> name:declare -> mint a name (the name's
//            "birth"), then connect it.
//   Look up  real-name or pubkey -> name:see -> the name's biographic card.
//
// On a successful connect it calls onConnected() so the shell lands the world
// (the now-name-bound socket sees the name-aware arrival roster). Releasing the
// name (the lock button -> nameRelease) brings this back up.

let _overlay = null;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function field(parent, label, type = "text") {
  const wrap = el("div", "nf-field");
  wrap.appendChild(el("label", "nf-label", label));
  const input = el("input", "nf-input");
  input.type = type;
  wrap.appendChild(input);
  parent.appendChild(wrap);
  return input;
}

/** Remove the Name Form overlay if it is up. */
export function hideNameForm() {
  if (_overlay) { _overlay.remove(); _overlay = null; }
}

/**
 * Show the Name Form over the whole viewport.
 *
 * @param {object}   opts
 * @param {object}   opts.client       the PortalClient (name channel methods)
 * @param {string}   opts.realityDomain the bare reality (shown as the IBPA)
 * @param {Function} opts.onConnected   called with the bound nameId after a
 *                                      successful name:connect
 */
export function showNameForm({ client, realityDomain = "", onConnected = () => {} }) {
  hideNameForm();
  injectStyles();

  const overlay = el("div", "nf-overlay");
  const card = el("div", "nf-card");
  overlay.appendChild(card);

  // The IBPA: at the Name menu it is only the reality domain.
  card.appendChild(el("div", "nf-ibpa", realityDomain || "this reality"));
  card.appendChild(el("h1", "nf-title", "Name"));
  card.appendChild(el("p", "nf-sub",
    "You need a name to enter. Connect to yours, create a new one, or look one up."));

  const tabsRow = el("div", "nf-tabs");
  const body = el("div", "nf-body");
  const status = el("div", "nf-status");
  card.appendChild(tabsRow);
  card.appendChild(body);
  card.appendChild(status);

  const setStatus = (msg, kind = "") => { status.textContent = msg || ""; status.className = "nf-status" + (kind ? " nf-" + kind : ""); };
  const busy = (btn, on) => { btn.disabled = on; btn.dataset.busy = on ? "1" : ""; };

  const tabs = [
    { key: "connect", label: "Connect", render: renderConnect },
    { key: "create",  label: "Create",  render: renderCreate  },
    { key: "lookup",  label: "Look up", render: renderLookup  },
  ];
  let active = "connect";
  const tabButtons = {};
  for (const t of tabs) {
    const b = el("button", "nf-tab", t.label);
    b.onclick = () => { active = t.key; paint(); };
    tabButtons[t.key] = b;
    tabsRow.appendChild(b);
  }

  function paint() {
    for (const t of tabs) tabButtons[t.key].classList.toggle("nf-tab-active", t.key === active);
    body.innerHTML = "";
    setStatus("");
    (tabs.find((t) => t.key === active) || tabs[0]).render();
  }

  // ── Connect: real-name (or pubkey) + password -> enter the world.
  function renderConnect() {
    const token = field(body, "Name (real name or public key)");
    const pw = field(body, "Password", "password");
    const go = el("button", "nf-btn nf-primary", "Connect");
    go.onclick = async () => {
      if (!token.value.trim() || !pw.value) { setStatus("Name and password required.", "err"); return; }
      busy(go, true); setStatus("Connecting…");
      try {
        const r = await client.nameConnect(token.value.trim(), pw.value);
        setStatus("Connected.", "ok");
        hideNameForm();
        onConnected(r || null);
      } catch (err) {
        setStatus(`Connect refused: ${err?.message || err}`, "err");
        busy(go, false);
      }
    };
    body.appendChild(go);
    token.focus();
  }

  // ── Create: mint a new name (the name's "birth"), then offer to connect it.
  function renderCreate() {
    const name = field(body, "Real name (your handle)");
    const pw = field(body, "Password", "password");
    const pw2 = field(body, "Confirm password", "password");
    const go = el("button", "nf-btn nf-primary", "Create name");
    go.onclick = async () => {
      if (!name.value.trim()) { setStatus("A real name is required.", "err"); return; }
      if (pw.value !== pw2.value) { setStatus("Passwords don't match.", "err"); return; }
      busy(go, true); setStatus("Minting your name…");
      try {
        await client.nameDeclare({ name: name.value.trim(), password: pw.value || null, soulType: "human" });
        setStatus(`Created "${name.value.trim()}". Connecting…`, "ok");
        if (pw.value) {
          const r = await client.nameConnect(name.value.trim(), pw.value);
          hideNameForm();
          onConnected(r?.nameId || null);
        } else {
          setStatus(`Created "${name.value.trim()}". It has no password — connect with its private key over the API.`, "ok");
          busy(go, false);
        }
      } catch (err) {
        setStatus(`Couldn't create: ${err?.message || err}`, "err");
        busy(go, false);
      }
    };
    body.appendChild(go);
    name.focus();
  }

  // ── Look up: a name's biographic card (no key, ever).
  function renderLookup() {
    const token = field(body, "Name (real name or public key)");
    const out = el("pre", "nf-lookup");
    const go = el("button", "nf-btn", "Look up");
    go.onclick = async () => {
      if (!token.value.trim()) { setStatus("Enter a name to look up.", "err"); return; }
      busy(go, true); setStatus("Looking up…"); out.textContent = "";
      try {
        const d = await client.nameSee(token.value.trim());
        setStatus("");
        out.textContent =
          `name:      ${d?.name ?? "(none)"}\n` +
          `id:        ${d?.nameId ?? "?"}\n` +
          `soul:      ${d?.soulType ?? "?"}\n` +
          `lineage:   ${d?.parentNameId ?? "?"}\n` +
          `banished:  ${d?.isBanished ? "yes" : "no"}\n` +
          `beings:    ${d?.beingCount ?? 0}\n` +
          `acts:      ${d?.actCount ?? 0}`;
      } catch (err) {
        setStatus(`No such name: ${err?.message || err}`, "err");
      }
      busy(go, false);
    };
    body.appendChild(go);
    body.appendChild(out);
    token.focus();
  }

  document.body.appendChild(overlay);
  _overlay = overlay;
  paint();
  return overlay;
}

let _stylesInjected = false;
function injectStyles() {
  if (_stylesInjected) return;
  _stylesInjected = true;
  const css = `
.nf-overlay{position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;
  background:rgba(8,10,14,.92);backdrop-filter:blur(6px);font-family:system-ui,sans-serif;color:#e7eaf0;}
.nf-card{width:min(420px,92vw);background:#11151c;border:1px solid #232a36;border-radius:14px;
  padding:26px 26px 22px;box-shadow:0 20px 60px rgba(0,0,0,.5);}
.nf-ibpa{font-family:ui-monospace,monospace;font-size:12px;color:#7d8aa0;letter-spacing:.04em;}
.nf-title{margin:6px 0 2px;font-size:30px;font-weight:700;letter-spacing:-.01em;}
.nf-sub{margin:0 0 18px;font-size:13px;color:#9aa6ba;line-height:1.45;}
.nf-tabs{display:flex;gap:6px;margin-bottom:16px;}
.nf-tab{flex:1;padding:8px;border:1px solid #232a36;background:#0c1118;color:#9aa6ba;border-radius:8px;
  font-size:13px;cursor:pointer;}
.nf-tab-active{background:#1b2433;color:#e7eaf0;border-color:#34405a;}
.nf-field{margin-bottom:12px;display:flex;flex-direction:column;gap:5px;}
.nf-label{font-size:12px;color:#9aa6ba;}
.nf-input{padding:10px 12px;border:1px solid #2a3240;background:#0b0f15;color:#e7eaf0;border-radius:8px;
  font-size:14px;outline:none;}
.nf-input:focus{border-color:#4a6cf7;}
.nf-btn{margin-top:6px;width:100%;padding:11px;border:1px solid #2a3240;background:#1b2433;color:#e7eaf0;
  border-radius:8px;font-size:14px;cursor:pointer;}
.nf-btn[disabled]{opacity:.6;cursor:default;}
.nf-primary{background:#4a6cf7;border-color:#4a6cf7;color:#fff;font-weight:600;}
.nf-status{margin-top:12px;font-size:12.5px;min-height:16px;color:#9aa6ba;}
.nf-ok{color:#5fd08a;}
.nf-err{color:#f0795f;}
.nf-lookup{margin-top:12px;padding:12px;background:#0b0f15;border:1px solid #232a36;border-radius:8px;
  font-family:ui-monospace,monospace;font-size:12px;white-space:pre-wrap;color:#c7d0df;}
`;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
}
