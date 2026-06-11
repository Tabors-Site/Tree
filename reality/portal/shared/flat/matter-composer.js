// matter-composer.js . the PLACE flow: anything in, matter out.
//
// The place tab's "create matter" panel. One composer for every
// content shape — drop/pick a file, paste a URL, or type bare text
// (a context chunk) — with a live preview of what matter TYPE the
// input will become before anything is saved. Classification is
// registry-driven: the reality's discovery payload carries the
// matter-type catalog (each type's `claims` block), so extension
// types participate the moment they register, no portal changes.
//
// The create-matter DO is the only semantic act. For files, the
// bytes ride the HTTP content carrier (POST /api/v1/content) behind
// the scenes first — invisible plumbing on the Node version; the DO
// then carries the returned cas ref. URLs and text go straight into
// the DO (content {url} / string).
//
// Scoring table mirrors seed/materials/matter/classify.js — keep the
// constants in sync (claims data itself is single-sourced from
// discovery, so drift is bounded to the weights).

import { flat } from "./host.js";

const SCORE = {
  MIME_EXACT: 100,
  EXTENSION: 90,
  MIME_WILDCARD: 80,
  URL_PATTERN: 70,
  SCHEME: 60,
  FLOOR: 50,
  TEXT_BASE: 20,
};

function bareMime(mimeType) {
  if (typeof mimeType !== "string" || !mimeType.length) return null;
  return mimeType.split(";")[0].trim().toLowerCase() || null;
}

function extOf(fileName) {
  if (typeof fileName !== "string") return null;
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0 || dot === fileName.length - 1) return null;
  return fileName.slice(dot).toLowerCase();
}

function parseUrl(url) {
  if (typeof url !== "string" || !url.length) return null;
  const m = url.match(/^([a-z][a-z0-9+.-]*):\/\/(.+)$/i);
  if (!m) return null;
  return { scheme: m[1].toLowerCase(), rest: m[2].toLowerCase() };
}

// IBPA shape — mirrors IBPA_SHAPE_RE in seed classify.js (and
// IBPA_RE in portalOp.js). url and ibpa are completely different
// reference worlds with their own input fields: a url is an http
// link into the WWW (web matter, embeds); an ibpa is an IBP address
// into another reality / branch / position (type "ibpa" — the
// inter-reality portal; four verbs go through it, never an iframe).
const IBPA_SHAPE_RE = /^(?:[a-zA-Z0-9.\-_]+(?:#[^/]+)?|#[^/]+)\/.*$/;

function mimeMatches(pattern, mime) {
  if (!pattern || !mime) return null;
  if (pattern === mime) return "exact";
  if (pattern === "*/*") return "wildcard";
  if (pattern.endsWith("/*") && mime.startsWith(pattern.slice(0, -1))) return "wildcard";
  return null;
}

/** Local ranker over discovery's matterTypes catalog. */
export function classifyLocal(catalog, input) {
  const mime = bareMime(input?.mimeType);
  const ext = extOf(input?.fileName);
  const url = parseUrl(typeof input?.url === "string" ? input.url.trim() : null);
  const hasText = typeof input?.text === "string" && input.text.length > 0;
  const hasFileSignal = !!(mime || ext);
  if (!mime && !ext && !url && !hasText) return [];

  const out = new Map();
  const propose = (type, score, reason) => {
    const cur = out.get(type);
    if (!cur || score > cur.score) out.set(type, { score, reason });
  };

  for (const def of catalog || []) {
    const c = def.claims;
    const prio = c?.priority || 0;
    if (c) {
      if (mime && Array.isArray(c.mimeTypes)) {
        for (const pattern of c.mimeTypes) {
          const kind = mimeMatches(pattern, mime);
          if (kind === "exact") propose(def.name, SCORE.MIME_EXACT + prio, `mime ${mime}`);
          else if (kind === "wildcard") propose(def.name, SCORE.MIME_WILDCARD + prio, `mime ${pattern}`);
        }
      }
      if (ext && Array.isArray(c.extensions) && c.extensions.includes(ext)) {
        propose(def.name, SCORE.EXTENSION + prio, `extension ${ext}`);
      }
      if (url && Array.isArray(c.urlPatterns)) {
        for (const pattern of c.urlPatterns) {
          if (pattern && url.rest.includes(pattern)) {
            propose(def.name, SCORE.URL_PATTERN + prio, `url matches "${pattern}"`);
          }
        }
      }
      if (url && Array.isArray(c.schemes) && c.schemes.includes(url.scheme)) {
        propose(def.name, SCORE.SCHEME + prio, `scheme ${url.scheme}`);
      }
    }
    if (hasText && !hasFileSignal && !url && (def.contentKinds || []).includes("text")) {
      propose(def.name, SCORE.TEXT_BASE + prio, "accepts text");
    }
  }

  // Seed floor — mirror of classify.js. The url and ibpa fields each
  // DECLARE their reference world; the field decides, not sniffing.
  const has = (n) => (catalog || []).some((d) => d.name === n);
  const rawUrl = typeof input?.url === "string" ? input.url.trim() : null;
  const rawIbpa = typeof input?.ibpa === "string" ? input.ibpa.trim() : null;
  if (rawUrl && has("http")) propose("http", SCORE.FLOOR, "an http link — website content");
  if (rawIbpa && IBPA_SHAPE_RE.test(rawIbpa) && has("ibpa")) {
    propose("ibpa", SCORE.FLOOR, "an IBP address — a doorway to another world");
  }
  if ((ext === ".glb" || ext === ".gltf" || mime === "model/gltf-binary" || mime === "model/gltf+json") && has("model")) {
    propose("model", SCORE.FLOOR, "a 3D model");
  }
  if (hasFileSignal && !rawUrl && !rawIbpa && has("file")) propose("file", SCORE.FLOOR - 1, "bytes of a file");
  if (hasText && !hasFileSignal && !rawUrl && !rawIbpa && has("generic")) propose("generic", SCORE.FLOOR, "bare text — a context chunk");

  return [...out.entries()]
    .map(([type, { score, reason }]) => ({ type, score, reason }))
    .sort((a, b) => b.score - a.score || a.type.localeCompare(b.type));
}

function fmtBytes(n) {
  if (!Number.isFinite(n)) return "";
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)}KB`;
  return `${n}B`;
}

function mimeAllowed(allowed, mime) {
  if (!Array.isArray(allowed) || allowed.length === 0) return true;
  const m = bareMime(mime);
  if (!m) return false;
  return allowed.some((p) => mimeMatches(p.toLowerCase(), m) !== null);
}

/**
 * Render the composer into an inspector-panel body.
 *
 * @param {HTMLElement} body
 * @param {object} action   { address } — the position the matter lands at
 * @param {object} hooks    { refreshView }
 */
export function renderMatterComposer(body, action, { refreshView } = {}) {
  const catalog = flat.state?.discovery?.matterTypes || [];
  const upload = flat.state?.discovery?.upload || { enabled: true, maxUploadBytes: null, allowedMimeTypes: null };

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  const form = el("div", "op-form");
  const note = el("div", "op-form-note dim",
    "Pick what kind of matter to place — the form shows that type's inputs.");
  form.appendChild(note);

  // ── TYPE FIRST ──
  // The type dropdown leads; the visible inputs follow from the
  // chosen type so nobody fills three fields and accidentally makes
  // a generic. "auto" shows everything and classifies live
  // (last-edited input wins).
  const typeField = el("div", "op-field");
  typeField.appendChild(el("label", null, "type"));
  const typeSelect = document.createElement("select");
  typeSelect.className = "op-input";
  typeField.appendChild(typeSelect);
  form.appendChild(typeField);

  // ── inputs ──
  // Last-edited wins: the composer holds ONE pending input.
  let pending = null; // {kind:"file"|"url"|"ibpa"|"text", ...}

  const fileField = el("div", "op-field");
  fileField.appendChild(el("label", null, "file"));
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.className = "op-input";
  fileField.appendChild(fileInput);
  form.appendChild(fileField);

  const urlField = el("div", "op-field");
  urlField.appendChild(el("label", null, "url (www — an http link)"));
  const urlInput = document.createElement("input");
  urlInput.type = "text";
  urlInput.placeholder = "https://example.com/page";
  urlInput.className = "op-input";
  urlField.appendChild(urlInput);
  form.appendChild(urlField);

  // A COMPLETELY different reference world from url: an IBP address
  // into another reality / branch / position. Becomes type "ibpa"
  // (the inter-reality portal) via form-portal — verbs go through
  // it; it never opens an iframe.
  const ibpaField = el("div", "op-field");
  ibpaField.appendChild(el("label", null, "ibpa (a doorway — another reality / branch)"));
  const ibpaInput = document.createElement("input");
  ibpaInput.type = "text";
  ibpaInput.placeholder = "other.world#0/library  or  #1a/<spaceId>";
  ibpaInput.className = "op-input";
  ibpaField.appendChild(ibpaInput);
  form.appendChild(ibpaField);

  const textField = el("div", "op-field");
  textField.appendChild(el("label", null, "text (a context chunk)"));
  const textInput = document.createElement("textarea");
  textInput.rows = 4;
  textInput.className = "op-input op-input-json";
  textField.appendChild(textInput);
  form.appendChild(textField);

  const nameField = el("div", "op-field");
  nameField.appendChild(el("label", null, "name (optional)"));
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "op-input";
  nameField.appendChild(nameInput);
  form.appendChild(nameField);

  // Which inputs a type wants, from the catalog def (registry-driven:
  // binary contentKind → file picker, text contentKind → textarea,
  // url-scheme claims → url field; ibpa is the seed doorway type).
  const inputsForType = (typeName) => {
    if (!typeName) return { file: true, url: true, ibpa: true, text: true }; // auto
    const def = catalog.find((d) => d.name === typeName);
    if (!def) return { file: true, url: true, ibpa: true, text: true };
    const kinds = def.contentKinds || [];
    return {
      file: kinds.includes("binary"),
      text: kinds.includes("text"),
      url:  !!def.claims?.schemes?.length,
      ibpa: def.name === "ibpa",
    };
  };

  const applyTypeVisibility = () => {
    const want = inputsForType(typeSelect.value || null);
    fileField.style.display = want.file ? "" : "none";
    urlField.style.display  = want.url  ? "" : "none";
    ibpaField.style.display = want.ibpa ? "" : "none";
    textField.style.display = want.text ? "" : "none";
    // Drop a pending input whose field just got hidden — it would
    // silently place the wrong shape.
    if (pending) {
      const fits = (pending.kind === "file" && want.file)
        || (pending.kind === "url" && want.url)
        || (pending.kind === "ibpa" && want.ibpa)
        || (pending.kind === "text" && want.text);
      if (!fits) pending = null;
    }
  };

  const preview = el("div", "op-form-note");
  preview.style.minHeight = "1.2em";
  form.appendChild(preview);

  const actions = el("div", "op-form-actions");
  const placeBtn = el("button", "btn-sm btn-primary", "place");
  placeBtn.type = "button";
  actions.appendChild(placeBtn);
  form.appendChild(actions);

  const result = el("div", "action-result hidden");
  form.appendChild(result);

  body.appendChild(form);

  // ── classification + preview ──

  const classifyInput = () => {
    if (!pending) return null;
    if (pending.kind === "file") {
      return { mimeType: pending.file.type || null, fileName: pending.file.name || null, size: pending.file.size };
    }
    if (pending.kind === "url") return { url: pending.url };
    if (pending.kind === "ibpa") return { ibpa: pending.ibpa };
    return { text: pending.text };
  };

  // Built once; only the auto option's label updates with the live
  // classification (rebuilding options mid-interaction loses focus).
  const autoOption = document.createElement("option");
  autoOption.value = "";
  autoOption.textContent = "auto (classified from what you fill)";
  typeSelect.appendChild(autoOption);
  for (const def of catalog) {
    const o = document.createElement("option");
    o.value = def.name;
    o.textContent = def.name + (def.description ? ` — ${def.description.slice(0, 48)}` : "");
    typeSelect.appendChild(o);
  }

  const updatePreview = () => {
    const input = classifyInput();
    if (!input) {
      preview.textContent = typeSelect.value
        ? `placing: ${typeSelect.value} — fill its input above`
        : "";
      autoOption.textContent = "auto (classified from what you fill)";
      return;
    }
    const ranked = classifyLocal(catalog, input);
    const top = typeSelect.value
      ? { type: typeSelect.value, reason: "chosen explicitly" }
      : ranked[0] || null;
    autoOption.textContent = ranked[0]?.type
      ? `auto — ${ranked[0].type}`
      : "auto (classified from what you fill)";
    if (!top) {
      preview.textContent = "will become: (unknown — pick a type)";
      return;
    }
    const sizeNote = pending?.kind === "file" ? `, ${fmtBytes(pending.file.size)}` : "";
    const what = pending?.kind === "file" ? pending.file.name
      : pending?.kind === "url" ? pending.url
      : pending?.kind === "ibpa" ? pending.ibpa
      : `${pending.text.length} chars`;
    preview.textContent = `will become: ${top.type} — ${what}${sizeNote} (${top.reason})`;
  };

  fileInput.addEventListener("change", () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    pending = { kind: "file", file: f };
    if (!nameInput.value) nameInput.value = f.name;
    updatePreview();
  });
  urlInput.addEventListener("input", () => {
    if (!urlInput.value.trim()) return;
    pending = { kind: "url", url: urlInput.value.trim() };
    updatePreview();
  });
  ibpaInput.addEventListener("input", () => {
    if (!ibpaInput.value.trim()) return;
    pending = { kind: "ibpa", ibpa: ibpaInput.value.trim() };
    updatePreview();
  });
  textInput.addEventListener("input", () => {
    if (!textInput.value) return;
    pending = { kind: "text", text: textInput.value };
    updatePreview();
  });
  typeSelect.addEventListener("change", () => {
    applyTypeVisibility();
    updatePreview();
  });
  applyTypeVisibility();

  // ── submit ──

  const fail = (msg) => {
    result.className = "action-result action-error";
    result.textContent = msg;
  };
  const ok = (msg) => {
    result.className = "action-result";
    result.textContent = msg;
  };

  placeBtn.addEventListener("click", async () => {
    if (!pending) return fail("nothing to place — pick a file, paste a url, or type text");
    const chosenType = typeSelect.value || null; // null → server classifies
    const name = nameInput.value.trim() || undefined;
    placeBtn.disabled = true;
    ok("placing…");
    try {
      let args;
      if (pending.kind === "file") {
        const f = pending.file;
        if (upload.enabled === false) throw new Error("uploads are disabled on this reality");
        if (upload.maxUploadBytes && f.size > upload.maxUploadBytes) {
          throw new Error(`file is ${fmtBytes(f.size)}; this reality caps uploads at ${fmtBytes(upload.maxUploadBytes)}`);
        }
        if (!mimeAllowed(upload.allowedMimeTypes, f.type)) {
          throw new Error(`mime "${f.type || "unknown"}" is not allowed on this reality`);
        }
        // Byte plumbing: the content carrier stores the bytes, the DO
        // below is the act. (Kernel versions carry bytes natively.)
        const fd = new FormData();
        fd.append("file", f);
        const token = flat.state?.session?.token;
        const res = await fetch("/api/v1/content", {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: fd,
        });
        const bodyJson = await res.json().catch(() => null);
        if (!res.ok || !bodyJson?.content?.hash) {
          throw new Error(bodyJson?.error || `upload failed (${res.status})`);
        }
        args = { name, content: bodyJson.content };
      } else if (pending.kind === "ibpa") {
        // Doorways form through their own op: form-portal validates
        // the IBP address and births the typed (ibpa) portal matter
        // whole. Different reference world from url — never an iframe.
        const r = await flat.doOp(action.address, "form-portal", { target: pending.ibpa, name });
        ok(`portal formed${r?.matterId ? ` (${String(r.matterId).slice(0, 8)}…)` : ""} → ${pending.ibpa}`);
        result.classList.remove("hidden");
        if (typeof refreshView === "function") refreshView();
        return;
      } else if (pending.kind === "url") {
        // The url field means the WWW. Bare "example.com" intent is
        // still the web — give it its scheme.
        const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(pending.url) ? pending.url : `https://${pending.url}`;
        args = { name, content: { url } };
      } else {
        args = { name, content: pending.text };
      }
      if (chosenType) args.type = chosenType;
      const r = await flat.doOp(action.address, "create-matter", args);
      ok(`placed${r?.matterId ? ` (${String(r.matterId).slice(0, 8)}…)` : ""}`);
      result.classList.remove("hidden");
      if (typeof refreshView === "function") refreshView();
    } catch (err) {
      fail(`${err.code || "error"}: ${err.message || "place failed"}`);
    } finally {
      placeBtn.disabled = false;
      result.classList.remove("hidden");
    }
  });
}
