// TreeOS Portal — the story view.
//
// The book made a surface: the SAME `assembleStory` fold the kernel weaves for the LLM's RECALL,
// painted instead of read. Facts woven into past-tense WORD — "I_AM gave birth to cherub and
// granted cherub the global role." — never JSON, never verb:op. One coordinate system, who × when
// × where; the scope switcher picks the view:
//
//   world      the whole branch's story         (SEE story {scope:world})
//   me         your own thread, first person     (SEE story {scope:being})
//   lineage    you + your descendants            (SEE story {scope:lineage})
//   @selected  the selected being's thread        (SEE story {scope:being, being})
//   here       this space's whole history         (SEE story {scope:place, space})
//
// Click any moment's time and the whole portal folds to it (the ghost-walk anchor) — the book
// stays live while you read the past from the present. THE CONVERGENCE: this view and the LLM's
// recall read ONE fold. A story reads forward (genesis → now), so entries run oldest-first.
//
// Reuses the history view's chrome (#history-view css); only the body differs — a woven sentence,
// not a verb/actor/facts breakdown.
//
// Feel-word: REMEMBER — told as a story, not a log.

import "../styles/history-view.css";

export function createView() {
  let ctx = null, root = null, els = null;
  let scope = "world";          // world | me | lineage | selected | here
  let acts = [];
  let sourceLabel = "";
  let loadSeq = 0;
  const teardowns = [];

  // ── Mount ───────────────────────────────────────────────────────
  function mount(rootEl, portalCtx) {
    ctx = portalCtx; root = rootEl;
    const wrap = document.createElement("div");
    wrap.id = "history-view";          // reuse the history view's chrome styling
    wrap.classList.add("story-view");
    wrap.innerHTML = `
      <div id="hv-bar">
        <div class="hv-scope" data-el="scope"></div>
        <span class="hv-title" data-el="title"></span>
        <div class="hv-bar-spacer"></div>
        <button class="hv-tool hv-now" data-el="now" style="display:none" title="return every view to the present">⏵ return to now</button>
        <button class="hv-tool" data-el="refresh" title="re-read the story">↻</button>
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
    els.refresh.addEventListener("click", () => load());
    els.now.addEventListener("click", () => ctx.navigation.returnToNow());

    renderScope();
    load();

    teardowns.push(ctx.state.subscribe((partial) => {
      if ("historicalAnchor" in partial) paintAnchor();
    }));
  }

  function onDescriptor(_desc, meta = {}) {
    // a real move re-reads "world"/"here" (the place changed); other scopes are being-fixed
    if (meta.reason === "navigate" && (scope === "here" || scope === "world")) load();
    paintAnchor();
  }
  function onSelection() {
    renderScope();
    if (scope === "selected") load();
  }
  function destroy() {
    loadSeq++;
    for (const fn of teardowns.splice(0)) { try { fn(); } catch {} }
    els = null;
    if (root) root.innerHTML = "";
    root = null;
  }

  // ── scope (who × when × where) ──────────────────────────────────
  function scopes() {
    const m = ctx.state.get();
    const out = [{ id: "world", label: "world" }];
    if (m.descriptor?.identity?.beingId) {
      out.push({ id: "me", label: "me" });
      out.push({ id: "lineage", label: "lineage" });
    }
    if (m.selectedBeing?.beingId) out.push({ id: "selected", label: `@${m.selectedBeing.name || "selected"}` });
    if (m.descriptor?.address?.spaceId) out.push({ id: "here", label: "here" });
    return out;
  }
  function renderScope() {
    if (!els) return;
    const available = scopes();
    if (!available.some((s) => s.id === scope)) scope = "world";
    els.scope.innerHTML = "";
    for (const s of available) {
      const b = document.createElement("button");
      b.textContent = s.label;
      b.className = s.id === scope ? "active" : "";
      b.addEventListener("click", () => {
        if (scope === s.id) return;
        scope = s.id;
        renderScope();
        load();
      });
      els.scope.appendChild(b);
    }
  }

  // map the active scope to the SEE story args + a human label
  function storyRequest() {
    const m = ctx.state.get();
    if (scope === "world")   return { args: { scope: "world" },   label: "the world's story" };
    if (scope === "me")      return { args: { scope: "being" },   label: "my story" };
    if (scope === "lineage") return { args: { scope: "lineage" }, label: "my family's story" };
    if (scope === "selected") {
      const id = m.selectedBeing?.beingId; if (!id) return null;
      return { args: { scope: "being", being: String(id) }, label: `@${m.selectedBeing?.name || "selected"}'s story` };
    }
    if (scope === "here") {
      const id = m.descriptor?.address?.spaceId; if (!id) return null;
      return { args: { scope: "place", space: String(id) }, label: "this place's story" };
    }
    return null;
  }

  // ── load ────────────────────────────────────────────────────────
  async function load() {
    if (!ctx?.client) return;
    const req = storyRequest();
    if (!req) { acts = []; renderFeed("nothing to read here — sign in or pick a being"); return; }
    const seq = ++loadSeq;
    renderFeed("reading the story…");
    try {
      const res = await ctx.client.see("story", { args: req.args });
      if (seq !== loadSeq || !els) return;
      acts = Array.isArray(res?.acts) ? res.acts : [];
      sourceLabel = req.label;
      renderFeed();
    } catch (err) {
      if (seq !== loadSeq || !els) return;
      const refused = err?.code === "FORBIDDEN" || err?.code === "UNAUTHORIZED";
      renderFeed(refused
        ? "the story is readable once you claim an identity — register via @cherub"
        : `could not read the story: ${err?.code || ""} ${err?.message || ""}`);
    }
  }

  // ── render (a story reads forward; entries oldest-first, genesis → now) ──
  function paintAnchor() {
    if (!els) return;
    const anchor = ctx.state.get("historicalAnchor");
    els.now.style.display = anchor ? "" : "none";
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
    if (!acts.length) {
      const blank = document.createElement("div");
      blank.className = "hv-blank";
      blank.textContent = emptyText || "no story here yet";
      els.feed.appendChild(blank);
      return;
    }
    let lastDay = null;
    for (const a of acts) {
      const ts = a.date ? (typeof a.date === "string" ? a.date : new Date(a.date).toISOString()) : null;
      const day = ts ? ts.slice(0, 10) : "—";
      if (day !== lastDay) {
        lastDay = day;
        const d = document.createElement("div");
        d.className = "hv-day";
        d.textContent = day;
        els.feed.appendChild(d);
      }
      els.feed.appendChild(renderLine(a, ts));
    }
    const note = document.createElement("div");
    note.className = "hv-note";
    note.textContent = "— the chain remembers —";
    els.feed.appendChild(note);
    paintAnchor();
  }
  function renderLine(a, ts) {
    const row = document.createElement("div");
    row.className = "hv-entry";
    if (ts) row.dataset.t = Date.parse(ts);
    // the time IS the fold control: click → every view folds to this moment (ghost-walk anchor)
    if (ts) {
      const t = document.createElement("span");
      t.className = "hv-time";
      t.title = `${ts}\nclick: fold every view to this moment`;
      t.textContent = ts.slice(11, 19);
      t.addEventListener("click", () => ctx.navigation.rewindTo(ts));
      row.appendChild(t);
    }
    // the woven past-tense WORD — the story sentence, rendered verbatim (the same line recall reads)
    const body = document.createElement("div");
    body.className = "hv-body";
    const line = document.createElement("div");
    line.className = "hv-msg sv-line";
    line.textContent = a.line || "";
    body.appendChild(line);
    row.appendChild(body);
    return row;
  }

  return { mount, onDescriptor, onSelection, destroy };
}
