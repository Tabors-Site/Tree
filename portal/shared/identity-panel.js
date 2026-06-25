// TreeOS Portal — the identity panel.
//
// A being IS its ed25519 keypair plus its chain: the public key is the
// permanent id (the z... did:key value that appears in every address,
// reel, and act), the NAME is the contextual label, and the act-chain
// is the substance. This panel surfaces that contract per
// philosophy/OS/IDENTITY.md "What the frontend builds":
//
//   - id display     the z... key as canonical identity, name as label
//   - key export     DO key-export at the self stance; the one path a
//                    private key ever leaves the story (PEM download)
//   - credentials    credential-read / credential-reset (password)
//   - provenance     the discovery chain block { storyRoot,
//                    storyId, sig }, verified LOCALLY via WebCrypto
//                    when the browser has Ed25519 (self-certifying:
//                    the key decodes straight from the storyId)
//
// Deliberately NOT here (no backend yet, do not invent UI): key
// import/recovery, BIP39 phrases, rotation, unlock sessions, per-act
// verification. Export-only, display-only, honest.
//
// Two consumers: the text view's identity chip / @being menu (panel
// into the inspector pane) and the post-register moment (body-level
// overlay via showBirthIdentityOverlay, which survives view remounts).

import "../styles/identity-panel.css";

// ── base58btc (mirror of seed/materials/name/keys.js) ──
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function b58decode(str) {
  let zeros = 0;
  while (zeros < str.length && str[zeros] === "1") zeros++;
  const bytes = [0];
  for (let i = zeros; i < str.length; i++) {
    const val = B58.indexOf(str[i]);
    if (val < 0) throw new Error(`invalid base58 character: ${str[i]}`);
    let carry = val;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry = carry >> 8;
    }
    while (carry) { bytes.push(carry & 0xff); carry = carry >> 8; }
  }
  const out = new Uint8Array(zeros + bytes.length);
  for (let i = 0; i < bytes.length; i++) out[zeros + bytes.length - 1 - i] = bytes[i];
  return out;
}

/** True when an id is one of the z... ed25519 key ids (not "i-am"). */
export function isKeyId(id) {
  return typeof id === "string" && id.length > 8 && id[0] === "z";
}

/**
 * Verify the discovery chain block locally. Self-certifying: the
 * public key decodes from storyId itself. Returns true/false, or
 * null when this browser's WebCrypto lacks Ed25519 (cannot judge).
 */
export async function verifyStoryRootLocal(chain) {
  if (!chain?.storyRoot || !chain?.storyId || !chain?.sig) return null;
  if (!window.crypto?.subtle) return null;
  let key;
  try {
    const decoded = b58decode(String(chain.storyId).slice(1));
    if (decoded[0] !== 0xed || decoded[1] !== 0x01) return false;
    key = await crypto.subtle.importKey(
      "raw", decoded.slice(2), { name: "Ed25519" }, false, ["verify"]);
  } catch {
    return null; // no Ed25519 in this WebCrypto — display-only
  }
  try {
    const msg = new TextEncoder().encode(String(chain.storyRoot));
    const sig = Uint8Array.from(atob(chain.sig), (c) => c.charCodeAt(0));
    return await crypto.subtle.verify("Ed25519", key, sig, msg);
  } catch {
    return false;
  }
}

// ── small DOM helpers ──────────────────────────────────────────────

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function copyBtn(value, label = "copy") {
  const b = el("button", "idp-btn idp-copy", label);
  b.onclick = async () => {
    try {
      await navigator.clipboard.writeText(value);
      b.textContent = "copied";
    } catch {
      b.textContent = "copy failed";
    }
    setTimeout(() => { b.textContent = label; }, 1200);
  };
  return b;
}

function downloadBtn(filename, text, label) {
  const b = el("button", "idp-btn", label);
  b.onclick = () => {
    const url = URL.createObjectURL(new Blob([text], { type: "application/x-pem-file" }));
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  return b;
}

function section(parent, title) {
  const s = el("div", "idp-section");
  s.appendChild(el("div", "idp-section-title", title));
  parent.appendChild(s);
  return s;
}

function keyRow(parent, id) {
  const row = el("div", "idp-key-row");
  const code = el("code", "idp-key", id);
  code.title = id;
  row.appendChild(code);
  row.appendChild(copyBtn(id));
  parent.appendChild(row);
  if (isKeyId(id)) {
    parent.appendChild(el("div", "idp-note", `did:key:${id} · ed25519, the key IS the id (self-certifying)`));
  }
  return row;
}

function noteLine(parent, text, cls = "idp-note") {
  parent.appendChild(el("div", cls, text));
}

// Render the story-provenance block (shared by panel + overlay).
// The bootstrap discovery is slim; the chain block rides the full
// socket-side `.discovery`, so fetch it through `see` when missing.
async function provenanceSection(parent, discovery, see) {
  const s = section(parent, "story");
  s.appendChild(el("div", "idp-label", discovery?.story || "(unknown)"));
  let chain = discovery?.chain;
  if (!chain?.storyId && see && discovery?.story) {
    try {
      const full = await see(`${discovery.story}/.discovery`);
      chain = full?.chain;
    } catch { /* provenance stays absent */ }
  }
  if (!chain?.storyId) {
    noteLine(s, "no signed chain root in discovery (older story)");
    return;
  }
  noteLine(s, "story key (the I-Am's, = storyId):", "idp-sub");
  keyRow(s, String(chain.storyId));
  if (chain.storyRoot) {
    const r = el("div", "idp-root", `chain root ${String(chain.storyRoot).slice(0, 16)}…`);
    r.title = chain.storyRoot;
    s.appendChild(r);
  }
  const verdict = el("div", "idp-verify idp-verify-pending", "checking root signature…");
  s.appendChild(verdict);
  verifyStoryRootLocal(chain).then((ok) => {
    if (ok === true) {
      verdict.className = "idp-verify idp-verify-ok";
      verdict.textContent = "✓ root signature verified locally against the story key";
    } else if (ok === false) {
      verdict.className = "idp-verify idp-verify-bad";
      verdict.textContent = "✗ root signature DID NOT verify";
    } else {
      verdict.className = "idp-verify";
      verdict.textContent = "root signature present (this browser cannot verify ed25519 locally)";
    }
  });
}

// The key-export flow: one explicit, auth-gated DO; result shown once,
// downloadable, never persisted client-side.
function exportSection(parent, { doOp, stance, name }) {
  const s = section(parent, "your key");
  noteLine(s,
    "This story holds your signing key in custody and signs your acts at the seal. " +
    "Export gives you the private key itself: your backup and your exit.");
  const btn = el("button", "idp-btn idp-primary", "export private key");
  const out = el("div", "idp-export-out");
  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = "exporting…";
    out.innerHTML = "";
    try {
      const res = await doOp(stance, "key-export", {});
      const r = res?.result || res || {};
      if (!r.hasKey || !r.privateKeyPem) {
        noteLine(out, "this being has no exportable key (born before keys, or foreign).");
      } else {
        if (r.mnemonic) {
          // The paper form first: 24 words ARE the key (BIP39 of the
          // ed25519 seed). Write them down; they rebuild everything.
          noteLine(out, "your key as 24 words — write these on paper:", "idp-sub");
          const words = el("div", "idp-words");
          r.mnemonic.split(" ").forEach((w, i) => {
            const chip = el("span", "idp-word", `${i + 1} ${w}`);
            words.appendChild(chip);
          });
          out.appendChild(words);
          out.appendChild(copyBtn(r.mnemonic, "copy words"));
        }
        const ta = el("textarea", "idp-pem");
        ta.readOnly = true;
        ta.value = r.privateKeyPem;
        out.appendChild(ta);
        const row = el("div", "idp-row");
        row.appendChild(downloadBtn(`${name || "being"}.key.pem`, r.privateKeyPem, "download .pem"));
        row.appendChild(copyBtn(r.privateKeyPem, "copy key"));
        out.appendChild(row);
        noteLine(out,
          "Anyone holding the words or the key can sign as you. Keep them offline. " +
          "The story keeps its encrypted copy; this export is recorded on your chain (the key itself is not). " +
          "Importing them on a story you control births you there with this same identity.",
          "idp-warn");
      }
    } catch (err) {
      noteLine(out, `export refused: ${err?.message || err}`, "idp-warn");
    }
    btn.disabled = false;
    btn.textContent = "export private key";
  };
  s.appendChild(btn);
  s.appendChild(out);
}

// (The per-being "signing" section was removed. Signing belongs to the NAME,
// not the being: it is unlocked/locked by the ONE top-right name lock
// — name:connect / name:release — never a separate per-being toggle. The dead
// signing-unlock / signing-lock DO ops were removed with it.)

function credentialSection(parent, { doOp, stance }) {
  const s = section(parent, "password");
  const out = el("div", "idp-export-out");
  const row = el("div", "idp-row");

  const read = el("button", "idp-btn", "show stored password");
  read.title = "returns the auto-generated password, if one was stored";
  read.onclick = async () => {
    out.innerHTML = "";
    try {
      const res = await doOp(stance, "credential-read", {});
      const r = res?.result || res || {};
      if (r.hasPlain && r.plaintext) {
        const code = el("code", "idp-key", r.plaintext);
        out.appendChild(code);
        out.appendChild(copyBtn(r.plaintext));
      } else {
        noteLine(out, "no stored plaintext: you chose this password yourself.");
      }
    } catch (err) {
      noteLine(out, `refused: ${err?.message || err}`, "idp-warn");
    }
  };
  row.appendChild(read);

  const reset = el("button", "idp-btn", "reset password");
  reset.onclick = async () => {
    out.innerHTML = "";
    reset.disabled = true;
    try {
      const res = await doOp(stance, "credential-reset", {});
      const r = res?.result || res || {};
      if (r.plaintext) {
        noteLine(out, "new password (older sessions are now signed out):");
        const code = el("code", "idp-key", r.plaintext);
        out.appendChild(code);
        out.appendChild(copyBtn(r.plaintext));
      }
    } catch (err) {
      noteLine(out, `refused: ${err?.message || err}`, "idp-warn");
    }
    reset.disabled = false;
  };
  row.appendChild(reset);

  s.appendChild(row);
  s.appendChild(out);
}

/**
 * Render the identity panel.
 *
 * Self mode (no `being`): full panel — own id, key export, password,
 * story provenance, sign out. Reads the live model via `state`.
 *
 * Being mode (`being` = a descriptor beings[] entry): read-only id
 * card for someone else; key ops are credential-authority-gated
 * server-side and self-only here, so they are not offered.
 *
 * @param {HTMLElement} body
 * @param {{ state: object, doOp?: Function, signOut?: Function, being?: object }} opts
 */
export function renderIdentityPanel(body, { state, doOp, see, signOut, being = null }) {
  body.innerHTML = "";
  const wrap = el("div", "identity-panel");
  body.appendChild(wrap);

  if (being) {
    const name = being.being || being.name || "?";
    const s = section(wrap, `@${name}`);
    noteLine(s, "a being is a presence, not an identity — the id below is its stable presence handle (a content hash); the NAME it expresses is what signs", "idp-sub");
    if (being.beingId) {
      keyRow(s, String(being.beingId));
      if (String(being.beingId) === "i-am") {
        noteLine(s, "the I-Am names itself \"i-am\" from inside; its key identity IS the story key below");
        provenanceSection(wrap, state?.discovery, see);
      }
    } else {
      noteLine(s, "(no id on this entry)");
    }
    return;
  }

  const session = state?.session;
  const identity = state?.descriptor?.identity;
  const name = session?.username || identity?.name || "arrival";
  const beingId = session?.beingId || identity?.beingId || null;
  const nameId = session?.nameId || identity?.nameId || null;

  // THE NAME — your identity, the thing that SIGNS. The same name across every
  // being you drive and every history/story; its public key is below. This is
  // the permanent identity (the being below is just the presence it acts through).
  if (nameId) {
    const nm = section(wrap, "your name");
    noteLine(nm, "your identity — the name that signs your acts, the same across every being you drive", "idp-sub");
    keyRow(nm, String(nameId));
  }

  // THE BEING — the presence you're driving. `@name` is a world label (it can
  // differ per history/story); the id is a local presence handle (a content
  // hash of the birth), NOT the signing key — that's the Name above.
  const who = section(wrap, `@${name}`);
  noteLine(who, "the being you're driving — its name is a world label; the id below is a local presence handle", "idp-sub");
  if (beingId) {
    keyRow(who, String(beingId));
  } else if (session?.token) {
    noteLine(who, "(no being on this session — you're signed in as a name; pick a being to drive)");
  } else {
    noteLine(who, "anonymous arrival — connect a name to enter");
  }

  if (session?.token && doOp) {
    const stance = session.beingAddress
      || `${state?.discovery?.story || ""}/@${name}`;
    // No signing section here: signing is the NAME's, toggled by the ONE
    // top-right name lock (name:connect/release). The identity panel is about
    // the being you're driving — export (the Name's key) + the being password.
    exportSection(wrap, { doOp, stance, name });
    credentialSection(wrap, { doOp, stance });
  }

  provenanceSection(wrap, state?.discovery, see);

  if (session?.token && signOut) {
    const s = section(wrap, "session");
    const btn = el("button", "idp-btn", "sign out");
    btn.onclick = () => signOut();
    s.appendChild(btn);
  }
}

/**
 * The post-register moment: a body-level overlay (survives the view
 * remount that follows reconnect) showing the freshly minted identity
 * and offering the key backup right away.
 *
 * @param {object} ctx   PortalContext (client + state)
 * @param {object} result  the cherub birth result ({ beingId, name, beingAddress, ... })
 */
export function showBirthIdentityOverlay(ctx, result) {
  if (!result?.beingId || !isKeyId(String(result.beingId))) return;
  const overlay = el("div", "overlay");
  const card = el("div", "overlay-card identity-panel idp-birth");
  overlay.appendChild(card);

  card.appendChild(el("h2", null, `@${result.name || "you"} — your identity`));
  card.appendChild(el("div", "sub", "a fresh ed25519 keypair; the public key below IS your permanent id"));

  keyRow(card, String(result.beingId));

  const doOp = (addr, op, args) => ctx.client.do(addr, op, args);
  const stance = result.beingAddress
    || `${ctx.state.get("discovery")?.story || ""}/@${result.name}`;
  exportSection(card, { doOp, stance, name: result.name });

  const cont = el("button", "btn", "continue");
  cont.onclick = () => overlay.remove();
  card.appendChild(cont);

  document.body.appendChild(overlay);
}
