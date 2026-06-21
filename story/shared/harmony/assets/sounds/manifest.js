// harmony/assets/sounds — sounds for harmony events.
//
// Served at /assets/harmony/sounds/<file>. The portal plays drumhit
// on tick facts arriving from the drum; footstep on harmony:walk
// facts arriving from any dancer.

export default {
  kind:    "asset",
  name:    "sounds",
  version: "0.1.0",
  description: "Sounds for harmony events: drumhit, footstep.",
  requires: [],
  files: {
    mp3: {
      "drum-hit": "drumhit.mp3",
      "footstep": "footstep.mp3",
    },
  },
};
