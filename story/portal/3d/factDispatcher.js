// factDispatcher.js
//
// Rung-3 fact dispatcher for the 3D portal.
//
// Consumes see/fact envelopes pushed alongside position deltas on the
// per-space subscriber bucket, and dispatches across every loaded entity
// in the scene whose render block names the incoming action:
//   1. A one-shot skeletal animation clip on each matching entity's
//      THREE.AnimationMixer (interrupt-and-play; no queueing).
//   2. A parallel fire-and-forget sound through the audio player.
//
// Doctrine:
//   - The portal is a renderer of fact streams across multiple sensory
//     channels. Animation is one channel; sound is another. Future
//     channels (particle effects, controller rumble, voice synthesis,
//     ambient lighting, screen reader for accessibility) plug into the
//     same shape: each fact-arrival dispatches to every channel whose
//     mapping is declared on the entity, all in parallel, all reading
//     from the same chain.
//   - **Population-level dispatch.** Every visible entity whose render
//     block names the incoming action reacts, regardless of whether the
//     fact targeted that entity directly. This is what makes "all
//     dancers sway when the drum ticks" work: the dancers declare
//     "harmony:tick" → "sway" in their render block; when the drum
//     stamps a harmony:tick fact targeting the drum matter, the push
//     fires on the dance-floor space, the portal walks every loaded
//     entity in the scene, and every dancer whose render block names
//     "harmony:tick" plays its sway clip in parallel. The chain is the
//     world; each entity declares what events it cares about via its
//     own render block.
//   - One .glb per character, many named clips inside, driven by a
//     single per-entity THREE.AnimationMixer. Motion is continuous
//     skeletal interpolation. Per-state .glb swap is not built and not
//     supported.
//   - Conflict policy on rapid facts is reset-and-play. Mid-clip facts
//     cut the current clip; cuts are intentional and realistic.
//   - One-shot clips run with LoopOnce + clampWhenFinished so the last
//     frame holds briefly, then fade back to the looping idle action.
//   - Sound is parallel to animation. No scheduling, no await.

import * as THREE from "three";
import { playSound } from "./audioPlayer.js";

// Track which mixers already have our 'finished' listener installed, so
// we wire it exactly once per dispatcher lifetime per entity. WeakSet so
// scenes that drop entities don't leak.
const _finishedHooksInstalled = new WeakSet();

function installFinishedHook(state) {
  if (!state || !state.mixer) return;
  if (_finishedHooksInstalled.has(state.mixer)) return;
  _finishedHooksInstalled.add(state.mixer);

  state.mixer.addEventListener("finished", (e) => {
    if (!state.idleAction) return;
    // Restore the idle loop. If the entity's idle action and the
    // finished one-shot are the same AnimationAction (happens when an
    // extension declares animations[action] = <same clip used as idle>,
    // or when there's only one clip in the file so it doubles as both),
    // the previous reset().setLoop(LoopOnce).play() left LoopOnce set
    // on the shared action. Explicitly restore LoopRepeat before play
    // so the idle resumes looping rather than completing once and
    // freezing.
    state.idleAction.reset().setLoop(THREE.LoopRepeat, Infinity);
    state.idleAction.clampWhenFinished = false;
    state.idleAction.fadeIn(0.2).play();
  });
}

function fireEntity(state, act) {
  const renderBlock = state.renderBlock || {};

  // Animation branch.
  const animName = renderBlock.animations?.[act];
  if (animName && state.actions && typeof state.actions.get === "function") {
    const clipAction = state.actions.get(animName);
    if (clipAction) {
      installFinishedHook(state);

      // Soft hand-off from idle so the cut isn't a hard snap. Only fade
      // out idle if it's actually a different action than the one we're
      // about to play.
      if (state.idleAction && state.idleAction !== clipAction) {
        state.idleAction.fadeOut(0.1);
      }

      // Reset-and-play: interrupt any in-flight instance of this clip.
      // No queue. Successive triggers cut cleanly.
      clipAction.reset().setLoop(THREE.LoopOnce, 1).play();
      clipAction.clampWhenFinished = true;
    }
  }

  // Sound branch, parallel and fire-and-forget. Audio policy
  // (tap-to-enable overlay on first load) lives in audioPlayer.
  const soundId = renderBlock.sounds?.[act];
  if (soundId) {
    try {
      playSound(soundId);
    } catch (_err) {
      // Don't let an audio failure swallow the animation path; sound is
      // a parallel decoration, not a precondition.
    }
  }
}

export function createFactDispatcher({ scene }) {
  if (!scene) {
    throw new Error("createFactDispatcher: scene is required");
  }

  return function dispatch(event) {
    // 1. Validate envelope shape. Bail quietly on anything malformed;
    //    the subscriber bucket fans out all kinds and we just ignore
    //    non-facts or facts we don't have enough info to act on.
    const data = event && event.payload && event.payload.data;
    if (!data) return;
    const { act } = data;
    if (!act) return;

    // 2. Population-level dispatch. Walk every loaded entity in the
    //    scene's mixer registry; any entity whose render block names
    //    this action fires its animation + sound channels. The target
    //    entity isn't privileged . it's just one of N entities that
    //    might react. (For O(small N) per fact at typical scene size,
    //    this is cheap enough that filtering by target first wouldn't
    //    win anything.)
    const iter = scene.getAllEntityMixerStates?.();
    if (!iter) return;
    for (const state of iter) {
      fireEntity(state, act);
    }
  };
}
