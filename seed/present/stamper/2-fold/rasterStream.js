// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// rasterStream.js . live rasterization of the inner face.
//
// 25.md Pillar D / rasterize.md / 26.md. buildInnerFace computes the
// moment's face as ONE snapshot; this module lets a consumer WATCH it
// form -- each piece delivered in rasterization order (self -> what I can
// do -> the world), one item at a time, the frame loading top-to-bottom.
//
// It is pure observability over the EXISTING fold: no new source of truth,
// no fact written. The completed face buildInnerFace returns is unchanged;
// this only streams the same pieces to whoever subscribed. Zero cost when
// nobody is watching (buildInnerFace guards on hasRasterSubscribers before
// it streams).
//
// ONE stream, three readers (26.md): the PORTAL watches the frame load
// (the human window / the generative face); the LLM path can build its
// prompt / KV-cache append-by-append from it (face-assembly = the context
// half, the fold the KV cache mirrors); a SCRIPTED being subscribes and
// reacts the instant its trigger item lands -- a reactive function over
// the fact-stream, "live reactive script beings". Keyed by the beingId
// whose face is forming; "*" is the watch-all key (an observer over every
// being's rasterization).

const _subs = new Map(); // key -> Set<fn>
const ALL = "*";

/**
 * Subscribe to a being's rasterization (or "*" for every being). Returns
 * an unsubscribe thunk. `fn` is called once per face item, in order.
 */
export function onRaster(key, fn) {
  if (typeof fn !== "function" || key == null) return () => {};
  const k = String(key);
  let set = _subs.get(k);
  if (!set) { set = new Set(); _subs.set(k, set); }
  set.add(fn);
  return () => offRaster(k, fn);
}

export function offRaster(key, fn) {
  const k = String(key);
  const set = _subs.get(k);
  if (!set) return;
  set.delete(fn);
  if (set.size === 0) _subs.delete(k);
}

/**
 * Does anyone watch this being's face? True if a watcher subscribed to
 * this beingId OR to the watch-all key. The caller (buildInnerFace) gates
 * on this so a moment with no watchers pays nothing.
 */
export function hasRasterSubscribers(key) {
  const k = key != null ? String(key) : null;
  return (k != null && (_subs.get(k)?.size || 0) > 0) || (_subs.get(ALL)?.size || 0) > 0;
}

function deliver(key, item) {
  const k = key != null ? String(key) : null;
  if (k != null) {
    for (const fn of _subs.get(k) || []) { try { fn(item); } catch {} }
  }
  // Watch-all observers always learn which being the item belonged to.
  if (k !== ALL) {
    for (const fn of _subs.get(ALL) || []) { try { fn({ ...item, beingId: k }); } catch {} }
  }
}

/**
 * Stream the inner face in rasterization order to whoever watches this
 * being. Items, in order, each with a monotonic `seq`:
 *   { seq, kind:"position", value }   . where the being stands
 *   { seq, kind:"able",     value }   . who it is (the able name)
 *   { seq, kind:"can", verb, words }  . one per non-empty capability verb
 *   { seq, kind:"see", block }        . one per canSee block (a world read)
 *   { seq, kind:"complete", face }    . the assembled face, frame loaded
 * No-op (allocates nothing) when nobody is watching.
 */
export function streamRasterFace(key, parts) {
  // Guard BEFORE touching `parts` so an unwatched call does literally
  // nothing (no destructure, no allocation) — true zero cost.
  if (!hasRasterSubscribers(key)) return;
  const { able, position, capabilities, blocks, face } = parts || {};
  let seq = 0;
  const emit = (item) => deliver(key, { seq: seq++, ...item });
  emit({ kind: "position", value: position ?? null });
  emit({ kind: "able", value: able ?? null });
  for (const verb of ["canDo", "canCall", "canBe"]) {
    const words = Array.isArray(capabilities?.[verb]) ? capabilities[verb] : [];
    if (words.length) emit({ kind: "can", verb, words });
  }
  for (const b of Array.isArray(blocks) ? blocks : []) emit({ kind: "see", block: b });
  emit({ kind: "complete", face: face ?? null });
}

/**
 * Replay a COMPLETED face as the same ordered item stream streamRasterFace
 * emits live -- for a consumer that gets the face AFTER the fold rather than
 * during it (e.g. the scripted reactor reading moment.innerFace in beat 3).
 * Order is identical to the live stream: position, able, caps, blocks,
 * complete. Each item carries a monotonic seq.
 */
export function faceItems(face) {
  if (!face) return [];
  const items = [];
  let seq = 0;
  const push = (it) => items.push({ seq: seq++, ...it });
  push({ kind: "position", value: face.position ?? null });
  push({ kind: "able", value: face.able ?? null });
  for (const verb of ["canDo", "canCall", "canBe"]) {
    const words = Array.isArray(face.capabilities?.[verb]) ? face.capabilities[verb] : [];
    if (words.length) push({ kind: "can", verb, words });
  }
  for (const b of Array.isArray(face.blocks) ? face.blocks : []) push({ kind: "see", block: b });
  push({ kind: "complete", face });
  return items;
}

// Test-only: drop every subscriber (so a verifier starts clean).
export function _resetRaster() {
  _subs.clear();
}
