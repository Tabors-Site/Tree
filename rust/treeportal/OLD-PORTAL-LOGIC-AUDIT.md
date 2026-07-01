# Old Portal → New Rust Portal — logic audit

Every feature found in the old JS portal (`portal/`, ~25k lines) checked against what the new Rust
portal (`rust/treeportal`) has. **Pick what to carry; the rest gets deleted with the old portal.**

Legend: ❌ not in new · 🟡 partial in new · ✅ already in new (listed for confidence) · 🗑️ likely
dropped by the new doctrine (moment/act only, no see-ops, thin client) — confirm before cutting.

---

## A. 3D world (`portal/3d/scene.js` 4028 lines + view.js/ui.js/hotbar.js/assetResolver/audioPlayer/factDispatcher)

New `world3d.rs` = first-person camera, WASD-as-move-Word, mouse-drag look, perspective grid, billboard bodies at coords, click being→@ / child→walk. Missing:

- ❌ **Pointer-lock mouse-look** (new uses drag, not lock) + **pitch** (new is yaw-only, flat)
- ❌ **Sprint** (Shift 1.9×), **jump + gravity** (Space, -22 m/s²), **noclip flight** (V toggle, C/Space/Ctrl up-down)
- ❌ **Self-position emit loop** — poll camera grid coord every 100ms, emit `set-being:coord` so your body actually moves (the real counterpart to the WASD move-Word; needs the move-word runtime)
- ❌ **glTF model loading** — manifest asset resolver (`harmony:drum`→glb), root-motion stripping, skeleton clone, bbox ground, 20MB lazy-load, preload pass
- ❌ **Skeletal animation** — AnimationMixer per entity, idle-loop detection, **fact-driven one-shot playback** (a fact plays the named clip, then restores idle)
- ❌ **Audio** — Web Audio unlock overlay, manifest sound resolve, fact-driven one-shot playback, decode cache
- ❌ **Portals (render-to-texture windows)** — foreign-story mini-scene rendered into a doorway with parallax true-window camera, 30Hz throttle, distance cull, **walk-through transit** (stand in doorway 3s → DO into foreign story, red-flash on refusal), foreign-SEE 15s cache
- ❌ **Screen matter** — video/iframe/YouTube embed meshes, MIME embed (pdf/img/audio/text/md/html), shared `http.currentUrl` fact, playback-position ticks
- ❌ **Gaze raycast + hover labels** — cast forward 18u, walk parent chain to entity, floating name label, move-tool context hints, cherub glare vignette
- ❌ **Proximity + activity bubbles** — open being panel within 3.5u, per-being activity bubbles (summoning/acting/summoned/said) from descriptor
- ❌ **Move tool** — pick up (lift mesh 0.6u), drop-into-child (container) or drop-on-cell (coord), Esc cancel, DO dispatch
- ❌ **Hotbar** (9-slot Minecraft inventory) — Move + Portal fixed slots, extension clones, number keys/wheel, tooltips
- ❌ **Clone graft / planter** — E-key plant template, parameter prompt modal, upload-model (POST /api/content → create-matter → set-model)
- ❌ **Action menus + schema forms** — descriptor-driven `being.actions[]` → arg forms (text/pw/number/select/checkbox/multiline), verb dispatch (BE/DO/CALL)
- ❌ **Creature panels** — Able-Manager editor, Being-Flow editor, LLM-Assigner (My Being/This Node/Place Default tabs), Summon chat panel
- ❌ **Sky/environment** — day/night cycle (9 palette keyframes), procedural clouds (Perlin fBm), starfield, sun+halo, fog=horizon, cloud-drift scaled by playback speed
- ❌ **Rewind visuals** — reposition camera to historical self-coord, frozen sky time, cloud-scale from history bar
- ❌ **Perf** — descriptor-signature skip, incremental entity diffing (rebuild only changed meshes)
- 🟡 **Sized-space land + grid overlay** (new draws an infinite grid; old sized the ground to the space bounds + edge frame + hash-ring fallback for unsized) — new has the hash/arc fallback only partially

## B. History / time-travel / branching / merge (`portal/3d/history-bar.js` 2855 lines)

New `history_bar.rs` = a basic ⏮ ● ⏵ scrubber + slider on `at_ord`/`now_ord`. Missing almost all of it:

- ❌ **Timeline strip of real moments** — a dot per act on a wall-clock axis genesis→now, click a dot to rewind
- ❌ **Wall-clock vs story-time modes** (absolute seconds vs discrete act-index ruler)
- ❌ **Playback speed tiers** (-8×…+8×, 9 levels), play/pause with resume-speed memory, auto-snap to now / auto-pause at genesis
- ❌ **Progressive mark loading** (fetch older 500-act batches as you rewind, stop at birth)
- ❌ **History tree panel** — every history+descendants as a fork tree, click to enter/switch
- ❌ **Being-aware history switch** (clicking a history BE-switches your seat to it)
- ❌ **Pointer-truthful labels** (`#0 (main, prod)`), history info dialog (lineage/pointers/anchor/scope/merge sources)
- ❌ **Pause / unpause a history** (freeze a branch; unpause gate)
- ❌ **Create-branch dialog** — parent picker, branch-point (datetime OR fact seq), scope limiter (subtree path), pointer name + conflict move, "history here" fork-at-scrubbed-moment, post-create switch offer
- ❌ **Merge dialog + conflict resolution** — two-source merge, after-merge action (keep/pause/soft-delete), pointer re-point, per-reel conflict panel (open/resolved/clean), **@merge-mediator LLM delegation**
- ❌ **Clone (download `.seed.json`) / graft (plant bundle)** from the bar
- 🗑️ **Cross-history acting doctrine** (three legit ways) — new keeps cross-history amber only

## C. Story / narrative (`portal/story/view.js`)

New `story.rs` = narrative lines for the active being. Missing:

- ❌ **Five scopes** — world / me / lineage / @selected / here (new does only the active being)
- ❌ **Day dividers**, **clickable time-anchors** (fold every view to that moment), anchor auto-highlight on rewind, return-to-now button, source label, footer

## D. Explorer view (`portal/explorer/view.js` + modelThumb.js) — ❌ **no explorer view exists in new**

- ❌ File-manager UI (spaces=folders, beings, matter=files), grid/list toggle, breadcrumb, up-folder
- ❌ Type-true matter previews (image, **rotating 3D GLB thumbnails**, video, portal, text, web), preview toggle
- ❌ Properties dialog (per-kind key-values + qualities + raw JSON)
- ❌ Right-click CRUD — new/rename/delete space, new/rename/delete matter, birth being, refresh, properties

## E. Flat / 2D mode (`portal/flat/*` — renderer 2500 lines + 12 panels) — ❌ **whole mode absent in new**

- ❌ **Chat / summons** — per-being chat panel, inbox.recent, live log (outgoing/reply/incoming/sub-summon/error), LLM-model indicator, root-correlation threading + stop button, per-intent summon buttons
- ❌ **Inbox panel** — pending summons, renderer-spec-driven rows (buttons/reply/dismiss), summoner resolution, `closeInboxOnAnswer`
- ❌ **Task menubar** — Story / History / Place / @being / Federation context tabs each with dropdown actions keyed off the address; inbox chip (15s poll)
- ❌ **Being inspector** — identity/state/inbox/permissions/qualities, BE actions, timeline (recent acts, click→fold), LLM chain preview, DO forms
- ❌ **Being timeline** — acts list (≤100), click an act → place state at that past moment
- ❌ **Matter inspector** — meta/preview/qualities + DO actions + facts-reel link
- ❌ **Ables panel** — where-you-are, effective can-do (aggregated grants), your grants + revoke, ables-hosted-here (search), author-a-able (canSee/Do/Summon/Be pickers), grant-a-able
- ❌ **LLM panel** — 7-step chain resolution view, your connections (add w/ encrypted apiKey, delete), being slots, space defaults (owner), story defaults (angel)
- ❌ **Matter composer** — type-first picker + `auto` live classifier (registry scorer), file/url/ibpa/text inputs, live "will become" preview, upload gating (maxBytes/mime)
- ❌ **Peers / federation** — peer rows (graft/offer/request), activity panel (incoming offers/requests, in-flight, completed log, accept/reject/fulfill/refuse)
- ❌ **System catalogs** — `.operations/.ables/.threads/.extensions` catalog + detail views
- ❌ **Explorers** — reel explorer (fact blocks + **chain verification ✓/◇/·/✗**), act-chain explorer, `.beings` catalog, thread detail, innerface rendering
- ❌ **Keyboard nav** — `/` focus address, `g h/b/o/r/t/i` quick-nav

## F. IBP console (`portal/3d/ibp-console.js`)

- 🗑️ Backtick console with SEE/DO/CALL/BE verb selector, address+JSON payload, envelope/ACK panes, round-trip ms, 50-call log — **this is the old 4-verb model; new is moment/act.** A moment/act equivalent (raw sender) could still be useful for debugging.

## G. Identity / name / login / session (`portal/shared/*` + core)

New = 3-path login (name+password / device keys / import) + set-password + vault sign. Missing:

- 🟡 **Key export** — export PEM + 24 words from a signed-in name (new shows words only at generate)
- ❌ **Credential ops** — credential-read (show stored password), credential-reset (new password, sign out old sessions)
- ❌ **Story provenance** — `{storyRoot, storyId, sig}` block, local WebCrypto Ed25519 verify (✓/✗)
- ❌ **Name look-up tab** — read another name's biographic card
- ❌ **Name tree / inheritation panel** — your being-tree on the current history, granted names as chips, +grant / ×revoke (grant-inheritation)
- ❌ **Being picker** — list a name's beings, passwordless be:connect, summon:mate @cherub for first being (birth flow w/ name-collision preflight + poll)
- 🟡 **Being tabs** — new drives one being; old had a **tab strip** (one per being, each remembers own view+nav+session)
- ❌ **Being release vs name release** — close-tab=be:release (keep name in), lock=name:release (full sign-out)
- ❌ **Sessions** — localStorage/sessionStorage persistence, restore on reload, stale-session auto-reconnect, hash `#inhabit=` handoff, multi-tab BroadcastChannel presence (parent-leaving → inheriter release)
- 🗑️ **Name channel** (separate socket event) — new folds names into the library reel (better)

## H. Navigation / routing / shell / wire (`portal/core/*`)

New = nav stack back/forward, `/` `~`, canonical IBP bar, moment/act wire, connection dot. Missing:

- ❌ **URL hash sync** (restore address on reload) — new has no persistence
- ❌ **Heaven-child detection** (`.acts/.histories` synthetic addresses 3D can't render → keep last real address for 3D restore)
- ❌ **Discovery bootstrap** — `GET /.well-known/treeos-portal` → `{ws, protocolVersion, place}`; place-URL resolution precedence (override/session/`?place=`/location/localhost); proxy detection
- ❌ **Context menus** (generic right-click surface w/ submenus, Esc/scroll dismiss) — shared primitive many views need
- ❌ **Op forms** (generic schema renderer) — shared primitive
- ❌ **Alt+1..5 / Backslash** view shortcuts; view-switcher preserves per-view state
- ❌ **Multi-context / multi-window** — old had isolated contexts per tab; new is single-window (fine for native, note it)
- 🗑️ **Live SEE subscriptions** (patch/replace/invalidate pushes) — new re-perceives on act; a live-moment push equivalent may be wanted
- ✅ back/forward, cross-history amber, canonical LEFT::RIGHT stance, story-domain learned from scene

---

## Quick triage (my read)

**High-value, in-vision, worth rebuilding as moment/act:** explorer view (D) · chat/inbox/summons (E) · being inspector + timeline (E) · matter composer (E) · history tree + branch/merge (B) · glTF models + fact-driven animation/audio (A) · self-position emit loop so WASD actually moves you (A) · key export + credential reset (G) · being picker + being tabs + be:release/name:release (G) · context menus & op forms as shared primitives (H).

**Environmental / polish (later):** sky/clouds/stars, portals-as-windows, hotbar, sprint/jump/noclip (A).

**Confirm before dropping (old-doctrine):** IBP console & SEE/DO/CALL/BE (F) · live-SEE subscriptions (H) · separate name channel (G) · multi-tab session handoff (G).
