// TreeOS Portal — the history view.
//
// The machine as its own biography (OSV2's deepest promise made a
// surface). A chronological feed over the chains the kernel already
// keeps — nothing here is synthesized client-side:
//
//   here       the current space's fact reel   (SEE /.reel/space/<id>)
//   me         your act chain                  (SEE /.acts/<beingId>)
//   @selected  the IBPA-selected being's chain (SEE /.acts/<beingId>)
//
// The killer interaction: click any moment's TIMESTAMP and the whole
// portal folds to it — the ghost-walk anchor pins navigation at that
// instant, so 3D, text, console, and explorer all show what was there.
// The feed itself stays live while anchored (the chain is the truth
// OF the past; you read it from the present).
//
// Feel-word: REMEMBER. The user REVISITS the structure.

import "../styles/history-view.css";

const ACT_PAGE = 60;

export function createView() {
  let ctx = null;
  let root = null;
  let els = null;
  let scope = "here";           // "here" | "me" | "selected"
  let entries = [];             // normalized, newest first
  let sourceLabel = "";
  let oldestActTs = null;       // paging cursor for act chains
  let exhausted = false;
  let loading = false;
  let loadSeq = 0;              // latest-wins guard
  const teardowns = [];

  // ── Mount ───────────────────────────────────────────────────────

  function mount(rootEl, portalCtx) {
    ctx = portalCtx;
    root = rootEl;
    const wrap = document.createElement("div");
    wrap.id = "history-view";
    wrap.innerHTML = `
      <div id="hv-bar">
        <div class="hv-scope" data-el="scope"></div>
        <span class="hv-title" data-el="title"></span>
        <div class="hv-bar-spacer"></div>
        <button class="hv-tool hv-now" data-el="now" style="display:none" title="return every view to the present">⏵ return to now</button>
        <button class="hv-tool" data-el="refresh" title="re-read the chain">↻</button>
      </div>
      <div id="hv-feed"></div>`;
    root.appendChild(wrap);
    els = {
      scope:   wrap.querySelector("[data-el=scope]"),
      title:   wrap.querySelector("[data-el=title]"),
      now:     wrap.querySelector("[data-el=now]"),
      refresh: wrap.querySelector("[data-el=refresh]"),
      feed:    wrap.querySelector("#hv-feed"),
    };
    els.refresh.addEventListener("click", () => load({ reset: true }));
    els.now.addEventListener("click", () => ctx.navigation.returnToNow());

    renderScope();
    load({ reset: true });

    // Anchored state drives the "return to now" affordance.
    teardowns.push(ctx.state.subscribe((partial) => {
      if ("historicalAnchor" in partial) paintAnchor();
    }));
  }

  function onDescriptor(_desc, meta = {}) {
    // A real move re-reads the chain for the new position ("here"),
    // and the selected being may have changed position context too.
    if (meta.reason === "navigate" && scope === "here") load({ reset: true });
    paintAnchor();
  }

  function onSelection() {
    renderScope();
    if (scope === "selected") load({ reset: true });
  }

  function destroy() {
    loadSeq++;
    for (const fn of teardowns.splice(0)) { try { fn(); } catch {} }
    els = null;
    if (root) root.innerHTML = "";
    root = null;
  }

  // ── Scope + sources ─────────────────────────────────────────────

  function scopes() {
    const m = ctx.state.get();
    const out = [{ id: "here", label: "here" }];
    if (m.descriptor?.identity?.beingId) out.push({ id: "me", label: "me" });
    if (m.selectedBeing?.beingId) out.push({ id: "selected", label: `@${m.selectedBeing.name || "selected"}` });
    return out;
  }

  function renderScope() {
    if (!els) return;
    const available = scopes();
    if (!available.some((s) => s.id === scope)) scope = "here";
    els.scope.innerHTML = "";
    for (const s of available) {
      const b = document.createElement("button");
      b.textContent = s.label;
      b.className = s.id === scope ? "active" : "";
      b.addEventListener("click", () => {
        if (scope === s.id) return;
        scope = s.id;
        renderScope();
        load({ reset: true });
      });
      els.scope.appendChild(b);
    }
  }

  function sourceAddress() {
    const m = ctx.state.get();
    const reality = m.discovery?.reality || m.descriptor?.address?.place || "";
    const branch = m.descriptor?.address?.branch || "0";
    const bq = branch === "0" ? "" : `#${branch}`;
    if (scope === "here") {
      const spaceId = m.descriptor?.address?.spaceId;
      if (!spaceId) return null;
      return { kind: "reel", address: `${reality}${bq}/.reel/space/${spaceId}`, label: `this space's reel` };
    }
    const beingId = scope === "me"
      ? m.descriptor?.identity?.beingId
      : m.selectedBeing?.beingId;
    const name = scope === "me"
      ? (m.session?.username || "me")
      : (m.selectedBeing?.name || "selected");
    if (!beingId) return null;
    return { kind: "acts", address: `${reality}${bq}/.acts/${beingId}`, label: `@${name}'s moments` };
  }

  // ── Loading ─────────────────────────────────────────────────────

  async function load({ reset = false, older = false } = {}) {
    if (!ctx?.client) return;
    // Dedupe only the pager: a scope switch or reset must always start
    // its load even mid-flight (loadSeq makes the latest one win), or
    // a click during the mount load silently keeps the old feed.
    if (loading && older) return;
    const src = sourceAddress();
    if (!src) {
      entries = [];
      renderFeed("nothing to read here — sign in or pick a being");
      return;
    }
    const seq = ++loadSeq;
    loading = true;
    if (reset) {
      entries = [];
      oldestActTs = null;
      exhausted = false;
      renderFeed("reading the chain…");
    }
    try {
      let batch = [];
      if (src.kind === "acts") {
        const opts = { limit: ACT_PAGE };
        if (older && oldestActTs) opts.before = oldestActTs;
        const desc = await ctx.client.see(src.address, opts);
        const acts = desc?.actChain?.acts || [];
        batch = acts.map(normalizeAct).filter(Boolean);
        if (batch.length) oldestActTs = batch[batch.length - 1].ts;
        if (acts.length < ACT_PAGE) exhausted = true;
      } else {
        const desc = await ctx.client.see(src.address);
        const facts = desc?.reel?.facts || [];
        batch = facts.map(normalizeFact).filter(Boolean)
          .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
        exhausted = true; // the reel SEE returns its window in one read
      }
      if (seq !== loadSeq || !els) return;
      sourceLabel = src.label;
      entries = older ? [...entries, ...batch] : batch;
      renderFeed();
    } catch (err) {
      if (seq !== loadSeq || !els) return;
      const refused = err?.code === "FORBIDDEN" || err?.code === "UNAUTHORIZED";
      renderFeed(refused
        ? "the chain is readable once you claim an identity — register via @cherub"
        : `could not read the chain: ${err?.code || ""} ${err?.message || ""}`);
    } finally {
      loading = false;
    }
  }

  // Normalize both chain shapes into one entry the feed renders.
  function normalizeAct(a) {
    const ts = a?.stampedAt || a?.receivedAt || null;
    if (!ts) return null;
    const facts = Array.isArray(a.facts) ? a.facts : [];
    return {
      id: a._id ? String(a._id) : null,
      ts: typeof ts === "string" ? ts : new Date(ts).toISOString(),
      actor: a.startMessage?.source || null,
      action: a.startMessage?.content || null,
      reply: a.endMessage?.content || null,
      verb: null,
      branch: a.branch || null,
      status: a.status || null,
      // Seal signature presence (older realities omit it on the wire).
      sig: a.sig?.by ? { alg: a.sig.alg || "ed25519", by: a.sig.by } : null,
      facts: facts.map((f) => `${f.verb}:${f.action}`),
    };
  }

  function normalizeFact(f) {
    const ts = f?.date || null;
    if (!ts) return null;
    return {
      ts: typeof ts === "string" ? ts : new Date(ts).toISOString(),
      actor: f.beingName || (f.beingId ? String(f.beingId).slice(0, 8) : null),
      action: f.action || null,
      reply: null,
      verb: f.verb || null,
      branch: null,
      status: null,
      facts: [],
      params: summarizeParams(f.params),
    };
  }

  function summarizeParams(p) {
    if (!p || typeof p !== "object") return null;
    try {
      const s = JSON.stringify(p);
      return s.length > 120 ? s.slice(0, 120) + "…" : s;
    } catch { return null; }
  }

  // ── Rendering ───────────────────────────────────────────────────

  function paintAnchor() {
    if (!els) return;
    const anchor = ctx.state.get("historicalAnchor");
    els.now.style.display = anchor ? "" : "none";
    // Highlight the entry closest to the anchor so the user sees
    // where the portal currently stands in its own history.
    const at = anchor?.atTimestamp ? Date.parse(anchor.atTimestamp) : null;
    for (const el of els.feed.querySelectorAll(".hv-entry")) {
      const t = Number(el.dataset.t);
      el.classList.toggle("anchored", at != null && Math.abs(t - at) < 1500);
    }
  }

  function renderFeed(emptyText = null) {
    if (!els) return;
    els.title.textContent = sourceLabel || "";
    els.feed.innerHTML = "";
    if (!entries.length) {
      const blank = document.createElement("div");
      blank.className = "hv-blank";
      blank.textContent = emptyText || "no moments recorded here yet";
      els.feed.appendChild(blank);
      return;
    }
    let lastDay = null;
    for (const e of entries) {
      const day = e.ts.slice(0, 10);
      if (day !== lastDay) {
        lastDay = day;
        const d = document.createElement("div");
        d.className = "hv-day";
        d.textContent = day;
        els.feed.appendChild(d);
      }
      els.feed.appendChild(renderEntry(e));
    }
    if (!exhausted) {
      const more = document.createElement("button");
      more.className = "hv-tool hv-more";
      more.textContent = "older…";
      more.addEventListener("click", () => load({ older: true }));
      els.feed.appendChild(more);
    } else if (entries.length) {
      const note = document.createElement("div");
      note.className = "hv-note";
      note.textContent = "— the chain remembers —";
      els.feed.appendChild(note);
    }
    paintAnchor();
  }

  function renderEntry(e) {
    const row = document.createElement("div");
    row.className = "hv-entry";
    row.dataset.t = Date.parse(e.ts);

    // The timestamp IS the fold control: click → every view shows
    // this moment (ghost-walk anchor).
    const t = document.createElement("span");
    t.className = "hv-time";
    t.title = `${e.ts}\nclick: fold every view to this moment`;
    t.textContent = e.ts.slice(11, 19);
    t.addEventListener("click", () => ctx.navigation.rewindTo(e.ts));
    row.appendChild(t);

    const body = document.createElement("div");
    body.className = "hv-body";
    const head = document.createElement("div");
    head.className = "hv-head";
    if (e.verb) {
      const v = document.createElement("span");
      v.className = "hv-verb";
      v.textContent = e.verb;
      head.appendChild(v);
    }
    if (e.actor) {
      const a = document.createElement("span");
      a.className = "hv-actor";
      a.textContent = e.actor.startsWith("@") ? e.actor : `@${e.actor}`;
      head.appendChild(a);
    }
    if (e.verb && e.action) {
      const act = document.createElement("span");
      act.className = "hv-action";
      act.textContent = e.action;
      head.appendChild(act);
    }
    if (e.branch && e.branch !== "0") {
      const b = document.createElement("span");
      b.className = "hv-branch";
      b.textContent = `#${e.branch}`;
      head.appendChild(b);
    }
    if (e.status) {
      const s = document.createElement("span");
      s.className = `hv-status ${e.status}`;
      s.textContent = e.status;
      head.appendChild(s);
    }
    if (e.sig) {
      // Signed at the seal: the signature commits the act + its facts.
      // "i-am" = the reality key itself; otherwise the signer's key id.
      // Click asks the reality to VERIFY it (the verify-act SEE op,
      // self-certifying against the signer id) — signed is a claim,
      // verified is a check.
      const g = document.createElement("span");
      g.className = "hv-sig";
      g.textContent = e.sig.by === "i-am" ? "✓ reality-signed" : "✓ signed";
      g.title = `sealed with ${e.sig.alg} by ${e.sig.by}\nclick to verify the signature`;
      if (e.id) {
        g.addEventListener("click", async (ev) => {
          ev.stopPropagation();
          g.textContent = "verifying…";
          try {
            const r = await ctx.client.see("verify-act", { args: { actId: e.id } });
            if (r?.verified) {
              g.className = "hv-sig hv-sig-verified";
              g.textContent = "✓ verified";
              g.title = `signature verified (${r.reason}) against ${r.by}`;
            } else {
              g.className = "hv-sig hv-sig-bad";
              g.textContent = "✗ not verified";
              g.title = `verification failed: ${r?.reason || "unknown"}`;
            }
          } catch (err) {
            g.textContent = e.sig.by === "i-am" ? "✓ reality-signed" : "✓ signed";
            g.title = `could not verify: ${err?.code || err?.message || err}`;
          }
        });
      }
      head.appendChild(g);
    }
    body.appendChild(head);

    // Acts: the moment's prose (what was asked / answered). Facts of
    // the moment summarize when there's no prose — a structured act's
    // content IS its facts.
    const prose = !e.verb ? (e.action || e.reply) : null;
    if (prose) {
      const m = document.createElement("div");
      m.className = "hv-msg";
      m.textContent = String(prose).slice(0, 280);
      body.appendChild(m);
    }
    if (e.params) {
      const m = document.createElement("div");
      m.className = "hv-msg";
      m.textContent = e.params;
      body.appendChild(m);
    }
    if (e.facts?.length) {
      const f = document.createElement("div");
      f.className = "hv-facts";
      const shown = e.facts.slice(0, 4).map((x) => `⛓ ${x}`).join("  ");
      f.innerHTML = `<span class="hv-fact-chip"></span>`;
      f.firstChild.textContent = shown + (e.facts.length > 4 ? `  +${e.facts.length - 4} more` : "");
      body.appendChild(f);
    }
    row.appendChild(body);
    return row;
  }

  return { mount, onDescriptor, onSelection, destroy };
}
