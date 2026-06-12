import "../styles/audio-player.css";

// audioPlayer.js . rung-3 Web Audio playback for fact-driven cues.
//
// One-shot sound playback parallel to skeletal animation. The drummer
// stamps a fact with action "harmony:tick" targeting matter (the drum);
// the portal's fact-arrival path dispatches to the TARGET entity, which
// triggers a sound via playSound("harmony:hit") (the actual id comes
// from the entity's qualities.render.sounds map). No scheduling,
// no queueing. start(0) and let the AudioContext mix.
//
// Browser audio policy. Most browsers refuse to start an AudioContext
// without a user gesture. ensureUnlockOverlay() injects a small
// "tap to enable sound" overlay on first load; the click handler
// calls unlockAudio() which creates and resumes the context.
//
// Conflict rule (mirrors the animation side). On rapid facts we do
// NOT queue. A new playSound() call spawns a fresh AudioBufferSourceNode
// while any in-flight node keeps playing to its natural end (Web Audio
// sources are one-shot by design, so overlapping rings just sum at the
// destination). That's the audible analogue of .reset().play() on
// the AnimationMixer side: cuts feel realistic, not delayed.
//
// Cache shape:
//
//   buffers       . URL  . AudioBuffer
//   pendingLoads  . URL  . Promise<AudioBuffer | null>
//
// Decode happens on the live AudioContext when available. If a caller
// preloads before unlock, we fetch the bytes and stash them as an
// ArrayBuffer; the first unlockAudio() drains those pending decodes.

import { resolveSoundUrl } from "./assetResolver.js";

let audioCtx = null;
const buffers = new Map();          // URL . AudioBuffer
const pendingLoads = new Map();     // URL . Promise<AudioBuffer | null>
const pendingBytes = new Map();     // URL . ArrayBuffer (decoded once ctx exists)

let _overlayEl = null;

// soundId . URL cache so playSound() can skip the manifest fetch on hot paths.
const _idToUrl = new Map();

async function resolveUrlCached(soundId) {
  if (_idToUrl.has(soundId)) return _idToUrl.get(soundId);
  const url = await resolveSoundUrl(soundId);
  if (url) _idToUrl.set(soundId, url);
  return url;
}

/**
 * Create the AudioContext and resume it. Idempotent. Must be called
 * from a user-gesture handler the first time (click, keydown, touch)
 * so the browser's autoplay policy lets the context run.
 */
export async function unlockAudio() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) {
      console.warn("[audioPlayer] Web Audio not supported in this browser");
      return;
    }
    try {
      audioCtx = new Ctx();
    } catch (err) {
      console.warn("[audioPlayer] AudioContext construction failed:", err?.message || err);
      audioCtx = null;
      return;
    }
  }
  if (audioCtx.state === "suspended") {
    try {
      await audioCtx.resume();
    } catch (err) {
      console.warn("[audioPlayer] AudioContext resume failed:", err?.message || err);
    }
  }
  // Drain any bytes that were fetched before the context existed.
  if (pendingBytes.size > 0) {
    const entries = [...pendingBytes.entries()];
    pendingBytes.clear();
    await Promise.allSettled(entries.map(async ([url, bytes]) => {
      if (buffers.has(url)) return;
      try {
        const buf = await audioCtx.decodeAudioData(bytes.slice(0));
        buffers.set(url, buf);
      } catch (err) {
        console.warn(`[audioPlayer] deferred decode failed for ${url}:`, err?.message || err);
      }
    }));
  }
}

/**
 * Whether the context exists and is running. Use to gate playback or
 * to decide whether to show the unlock overlay.
 */
export function isAudioUnlocked() {
  return !!audioCtx && audioCtx.state === "running";
}

/**
 * Resolve, fetch, decode, and cache a sound by id. Returns the cached
 * AudioBuffer (or null on any failure: missing manifest entry, 404,
 * decode error). Safe to call before unlockAudio() . if the context
 * isn't live yet we stash the raw bytes and decode them when unlock
 * happens. De-dupes concurrent loads of the same URL.
 */
export async function preloadSound(soundId) {
  const url = await resolveUrlCached(soundId);
  if (!url) return null;
  if (buffers.has(url)) return buffers.get(url);
  if (pendingLoads.has(url)) return pendingLoads.get(url);

  const promise = (async () => {
    let bytes;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`[audioPlayer] fetch ${url} . ${res.status}`);
        return null;
      }
      bytes = await res.arrayBuffer();
    } catch (err) {
      console.warn(`[audioPlayer] fetch failed for ${url}:`, err?.message || err);
      return null;
    }

    if (!audioCtx) {
      // Park the bytes; unlockAudio() will decode them when the
      // context comes online. Return null for this call (no buffer
      // yet) but the cache will be ready for the next playSound.
      pendingBytes.set(url, bytes);
      return null;
    }

    try {
      const buf = await audioCtx.decodeAudioData(bytes.slice(0));
      buffers.set(url, buf);
      return buf;
    } catch (err) {
      console.warn(`[audioPlayer] decode failed for ${url}:`, err?.message || err);
      return null;
    }
  })().then((result) => {
    pendingLoads.delete(url);
    return result;
  });

  pendingLoads.set(url, promise);
  return promise;
}

/**
 * Parallel preload pass. Fire every load at once; resolve when all
 * settle. Mirrors preloadModels() in assetResolver.js.
 */
export async function preloadSounds(soundIds) {
  if (!Array.isArray(soundIds) || soundIds.length === 0) return;
  const unique = Array.from(new Set(soundIds.filter(Boolean)));
  if (unique.length === 0) return;
  await Promise.allSettled(unique.map((id) => preloadSound(id)));
}

/**
 * Play a sound once. No-op if audio isn't unlocked yet (silent skip,
 * not error . the overlay will appear on first load, and once the
 * user taps, subsequent facts ring). Lazy-loads the buffer if it
 * wasn't preloaded.
 *
 * AudioBufferSourceNodes are one-shot; we create a fresh node per
 * call and let it free itself when the buffer finishes. Rapid
 * successive calls overlap at the destination . the audible analogue
 * of the animation side's interrupt-don't-queue cut rule.
 */
export async function playSound(soundId) {
  if (!audioCtx || audioCtx.state !== "running") return;
  const url = await resolveUrlCached(soundId);
  if (!url) return;
  let buf = buffers.get(url);
  if (!buf) {
    buf = await preloadSound(soundId);
    if (!buf) return;
  }
  try {
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    src.connect(audioCtx.destination);
    src.start(0);
  } catch (err) {
    console.warn(`[audioPlayer] playback failed for ${soundId}:`, err?.message || err);
  }
}


/**
 * Inject a one-time "tap to enable sound" overlay. Click anywhere to
 * dismiss; the click handler unlocks audio. Idempotent. Skips entirely
 * if audio is already unlocked (e.g. a page refresh after the user
 * has already gestured this session).
 */
export function ensureUnlockOverlay() {
  if (isAudioUnlocked()) return;
  if (_overlayEl) return;

  const el = document.createElement("div");
  el.className = "audio-unlock-overlay";
  const card = document.createElement("div");
  card.className = "audio-unlock-card";
  card.textContent = "tap to enable sound";
  el.appendChild(card);

  const dismiss = async () => {
    el.removeEventListener("click", dismiss);
    await unlockAudio();
    el.classList.add("fading");
    setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
      if (_overlayEl === el) _overlayEl = null;
    }, 240);
  };
  el.addEventListener("click", dismiss);

  document.body.appendChild(el);
  _overlayEl = el;
}
