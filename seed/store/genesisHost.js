// genesisHost.js — the genesis-scoped host floor for genesis.word's creation acts. Passed on the ONE
// readAndRunGenesisWord runWordToStore call (genesis.js), NOT in floorHostEnv — these perceptions are
// genesis-only and must not load onto every cognition word (floorHostEnv is the always-on shared floor
// merged under every word run). runWordToStore merges floorHostEnv UNDER this env, so findByName (the
// existence guard) stays available from the floor while delegate-spec rides here.
//
// THE CUT: the LOOKUP/COMPUTE of a delegate's birth spec is floor (a READ — lays no fact); the
// be:form-being the Word stamps is the only world write. Reuses the SAME functions ensureSeedDelegates
// calls (SEED_DELEGATES roster, findIAm, getSpaceRootId, findByHeavenSpace, the ring math) — no
// reimplementation. The being SELF-STAMPS its be:birth (through = the new being, in birthBeing); the
// host only resolves what cannot be a Word literal: the I's being id, the space ids, the layout math.

import { SEED_DELEGATES } from "../materials/being/seedDelegates.js";

export function genesisHostEnv() {
  return {
    // delegate-spec(name) -> the resolved birth spec for one seed delegate: parented to the I (THE
    // seed-delegate distinction — the I makes its delegates directly, never through a mother), homed
    // at the story root (or, for host delegates, their heaven space), scripted/llm cognition, its own
    // able, a deterministic ring coord. The genesis.word birth line stamps this via `form a being
    // with $spec`. A pure READ — lays no fact (in SEE_FLOOR). Returns null for an unknown name.
    "delegate-spec": async ({ args: [name] }) => {
      const spec = SEED_DELEGATES.find((d) => d.name === String(name));
      if (!spec) return null;
      const { findIAm } = await import("../materials/being/identity.js");
      const { getSpaceRootId } = await import("../sprout.js");
      const { findByHeavenSpace, loadProjection } = await import(
        "../materials/projections.js"
      );

      const iAm = await findIAm();
      const parentBeingId = iAm ? String(iAm._id) : null; // the I — the root of the being-tree
      const rootId = getSpaceRootId();

      // Home: a host delegate (homeHeavenSpace set — http-server/websocket-pool/mongo) lives at its
      // heaven space; every other delegate at the story root. (seedDelegates.js:292-296.)
      let homeId = rootId ? String(rootId) : null;
      if (spec.homeHeavenSpace) {
        const slot = await findByHeavenSpace(spec.homeHeavenSpace, "0");
        if (slot?.id) homeId = String(slot.id);
      }

      // Ring coord: lay the delegates evenly around the root's center; host delegates stand at their
      // room center {4,4}. Read the MATERIALIZED size only — the host reader runs OUTSIDE any moment
      // (runWordToStore contract), so by boot-end the create-space is long sealed and the projection
      // IS folded; there is no pending-in-deltaF case. (Deliberately NOT porting seedDelegates.js:240's
      // `opts.moment.deltaF` read — a ReferenceError masked by a try/catch. Omit coord if size absent;
      // be:form-being then picks a random in-bounds cell, the same working fallback.)
      let coord;
      if (spec.homeHeavenSpace) {
        coord = { x: 4, y: 4 };
      } else if (rootId) {
        const size =
          (await loadProjection("space", String(rootId), "0"))?.state?.size ||
          null;
        if (
          size &&
          Number.isFinite(size.x) &&
          Number.isFinite(size.y) &&
          size.x > 0 &&
          size.y > 0
        ) {
          const i = SEED_DELEGATES.indexOf(spec);
          const total = SEED_DELEGATES.length;
          const cx = size.x / 2;
          const cy = size.y / 2;
          const r = Math.max(2, Math.min(size.x, size.y) / 4);
          const angle = (i / total) * Math.PI * 2;
          coord = {
            x: Math.round(cx + r * Math.cos(angle)),
            y: Math.round(cy + r * Math.sin(angle)),
          };
        }
      }

      // defaultAble (not `able`): birthBeing keys the non-human cognition able off defaultAble.
      return {
        name: spec.name,
        cognition: spec.cognition,
        defaultAble: spec.able,
        parentBeingId,
        homeId,
        ...(coord ? { coord } : {}),
      };
    },
  };
}
