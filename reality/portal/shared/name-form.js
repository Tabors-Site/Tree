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

  // ── Connect: real-name (or pubkey) + password, OR the private key / 24-word
  //    recovery phrase directly (no password — the key IS the proof).
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

    // The key path: your private key (PEM) or your 24-word recovery phrase.
    // Possessing it IS the proof; no password needed (and it recovers a name
    // whose password you've lost).
    body.appendChild(el("div", "nf-or", "— or use your key / recovery phrase —"));
    const keyInput = el("textarea", "nf-pem");
    keyInput.placeholder = "paste your private key (PEM) or your 24-word recovery phrase";
    body.appendChild(keyInput);
    const goKey = el("button", "nf-btn", "Connect with key / recovery phrase");
    goKey.onclick = async () => {
      if (!keyInput.value.trim()) { setStatus("Paste your private key or 24 words.", "err"); return; }
      busy(goKey, true); setStatus("Connecting with your key…");
      try {
        const r = await client.nameConnectKey(keyInput.value.trim());
        setStatus("Connected.", "ok");
        hideNameForm();
        onConnected(r || null);
      } catch (err) {
        setStatus(`Connect refused: ${err?.message || err}`, "err");
        busy(goKey, false);
      }
    };
    body.appendChild(goKey);
    token.focus();
  }

  // ── Create: mint a new name (the name's "birth"). Reveal the key ONCE for
  // backup (public key + private key + 24 words — same as the being-wallet
  // used to show at birth), THEN enter.
  function renderCreate() {
    const name = field(body, "Real name (your handle)");
    const pw = field(body, "Password (optional — recommended; or keep only your private key)", "password");
    const pw2 = field(body, "Confirm password (if set)", "password");
    const go = el("button", "nf-btn nf-primary", "Create name");
    go.onclick = async () => {
      if (!name.value.trim()) { setStatus("A real name is required.", "err"); return; }
      if (pw.value !== pw2.value) { setStatus("Passwords don't match.", "err"); return; }
      busy(go, true); setStatus("Minting your name…");
      try {
        const dec = await client.nameDeclare({ name: name.value.trim(), password: pw.value || null, soulType: "human" });
        showReveal(dec?.reveal || null, name.value.trim(), pw.value || null);
      } catch (err) {
        setStatus(`Couldn't create: ${err?.message || err}`, "err");
        busy(go, false);
      }
    };
    body.appendChild(go);
    name.focus();
  }

  // The key reveal — shown ONCE after create. The private key + 24 words ARE
  // the identity; the public key is the name's id. Back it up, then enter.
  function showReveal(reveal, realName, password) {
    body.innerHTML = "";
    // Lock the form to the reveal: hide the Connect/Create/Look-up tabs so the
    // holder can't navigate away from the ONE-TIME key backup. The only way
    // forward is the "I saved it" button below.
    tabsRow.style.display = "none";
    setStatus(`Created "${realName}". Back up your key — this is the ONLY time it is shown.`, "ok");
    if (!reveal) {
      // No reveal came back (shouldn't happen for a fresh mint) — fall through
      // to entering, but warn.
      setStatus(`Created "${realName}", but the key reveal was unavailable. Export it from the lock menu.`, "err");
    } else {
      const wrap = el("div", "nf-reveal");
      wrap.appendChild(el("div", "nf-reveal-label", "public key (your name's id)"));
      wrap.appendChild(codeBox(reveal.nameId));
      wrap.appendChild(copyRow(reveal.nameId, "copy public key"));

      if (reveal.mnemonic) {
        wrap.appendChild(el("div", "nf-reveal-label", "your key as 24 words — WRITE THESE DOWN"));
        const words = el("div", "nf-words");
        reveal.mnemonic.split(/\s+/).forEach((w, i) => words.appendChild(el("span", "nf-word", `${i + 1} ${w}`)));
        wrap.appendChild(words);
        wrap.appendChild(copyRow(reveal.mnemonic, "copy words"));
      }

      wrap.appendChild(el("div", "nf-reveal-label", "private key (PEM)"));
      const ta = el("textarea", "nf-pem"); ta.readOnly = true; ta.value = reveal.privateKeyPem;
      wrap.appendChild(ta);
      wrap.appendChild(copyRow(reveal.privateKeyPem, "copy private key"));
      body.appendChild(wrap);
    }

    const enter = el("button", "nf-btn nf-primary", password ? "I saved it — enter" : "I saved it");
    enter.onclick = async () => {
      busy(enter, true);
      if (password) {
        try {
          const r = await client.nameConnect(realName, password);
          hideNameForm();
          // Pass the FULL connect result ({ token, nameId }) so the shell can
          // persist the name-token — passing only nameId loses it (a refresh
          // would bounce back to the Name Form).
          onConnected(r || { nameId: reveal?.nameId || null });
        } catch (err) {
          setStatus(`Saved, but connect failed: ${err?.message || err}`, "err");
          busy(enter, false);
        }
      } else {
        // No password: the portal can't open a session (connect needs the
        // password to decrypt the key into the session). The holder enters by
        // importing the private key as a password-bearing name, or acts over
        // the API with the raw key. Guide them back to Connect.
        setStatus("No password set — set one (or re-create with a password) to use this name in the portal. Your key is your backup.", "err");
        busy(enter, false);
      }
    };
    body.appendChild(enter);
  }

  // tiny inline helpers (the Name Form is self-contained, no shared deps).
  function codeBox(text) { const c = el("code", "nf-code", text); return c; }
  function copyRow(text, label) {
    const row = el("div", "nf-row");
    const b = el("button", "nf-mini", label);
    b.onclick = () => { try { navigator.clipboard?.writeText(text); b.textContent = "copied"; setTimeout(() => (b.textContent = label), 1200); } catch { /* ignore */ } };
    row.appendChild(b);
    return row;
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
.nf-reveal{margin-top:6px;max-height:46vh;overflow:auto;}
.nf-reveal-label{margin:12px 0 5px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#8b97ab;}
.nf-code{display:block;padding:8px 10px;background:#0b0f15;border:1px solid #232a36;border-radius:6px;
  font-family:ui-monospace,monospace;font-size:11.5px;color:#9fd0ff;word-break:break-all;}
.nf-words{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;}
.nf-word{padding:6px 7px;background:#0b0f15;border:1px solid #232a36;border-radius:6px;
  font-family:ui-monospace,monospace;font-size:11px;color:#c7d0df;}
.nf-pem{width:100%;height:84px;padding:8px 10px;background:#0b0f15;border:1px solid #232a36;border-radius:6px;
  font-family:ui-monospace,monospace;font-size:10.5px;color:#9aa6ba;resize:vertical;}
.nf-row{margin-top:6px;}
.nf-mini{padding:5px 9px;border:1px solid #2a3240;background:#161d28;color:#c7d0df;border-radius:6px;
  font-size:11.5px;cursor:pointer;}
.nf-or{margin:16px 0 10px;text-align:center;font-size:11.5px;color:#7d8aa0;letter-spacing:.03em;}
`;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
}
