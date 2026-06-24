// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// set-model — give a being, space, or matter its 3D body.
//
// Models ARE matter (type "model", .glb bytes in the content store). The flow is two ops,
// cleanly split:
//
//   1. UPLOAD is create-matter: POST the bytes to /api/v1/content, then
//      `do create-matter { type: "model", content: <ref> }` targeting the story root's
//      `skins` space — the catalog space that holds every uploaded model so the 3D portal
//      can display them all and beings can see which ids exist.
//
//   2. SET is this op: `do set-model { modelMatterId }` on a being, space, or matter.
//      Clicking a model in the skins space calls this against your own being; copying the
//      id lets you set it on spaces/matter you own.
//
// The write lands at `qualities.render.model` (the same render namespace set-render owns) as
// the resolved block { matterId, hash, url, name }: matterId is the source pointer; hash + url
// are snapshotted so renderers load bytes straight from the content store with immutable
// caching, no second lookup.
//
// Who may set what:
//   being  — the being itself (your body is yours), or the root owner.
//   matter — the matter's author, or the root owner. (Extension authors set DEFAULTS for all
//            matter of their type via the type def's render.model; this op is the per-matter
//            override beings write into the story's history.)
//   space  — the space's owner, or the root owner. A space's model is its body in the PARENT's
//            scene (the pyramid you click to enter).
//
// WORD-SOURCED (handler-less, Tabor's no-mirror law): set-model has NO JS handler. Its world
// strand is model.word — the ONLY path. The op registers a `word` descriptor + its `hostEnv`
// (modelHostEnv); the dispatcher's generic runOpWord (do.js) resolves the word, runs it with
// the standard trigger { target, targetKind, targetId, caller, branch, ... }, and promotes the
// word-authored fact (factParams { field, value, merge } + factTarget { kind, id }) via
// stampsWordFact. There is no `_setModelViaWord` adapter and no JS body — apart from
// ensureSkinsSpace (genesis furniture, below) this file is registration only.
//
// DYNAMIC fact kind: the target is being | space | matter, so the fact reel varies. model.word
// names both via a {kind,id} factTarget (stampsWordFact honors the object kind, not the op's
// noun), so NO idFrom — the word authors its own target. `noun: "being"` is the registry's
// required default; the word's factTarget overrides it per set. The compute (the per-kind auth
// gate, the model-matter resolve + snapshot, the set-<kind> field/value/merge) lives in
// modelHost.js as the `see` escapes the word reaches — pure reads, they lay NO fact.

import { randomUUID as uuidv4 } from "node:crypto";
import { registerOperation } from "../../../ibp/operations.js";
import { IbpError, IBP_ERR } from "../../../ibp/protocol.js";
import { I } from "../../../materials/being/seedBeings.js";
import { registerAbleWord } from "../../../present/word/ableWordRegistry.js";
import { modelHostEnv } from "./modelHost.js";

// Self-register this slice's co-located WORLD strand (CONVERTING.md): the bridge resolves
// ("render", "set-model") to model.word, its host escapes wired by modelHost.js. Registered
// at module load (services.js imports this file at seed boot).
registerAbleWord("render", "set-model", new URL("./model.word", import.meta.url));

const SKINS_SPACE_NAME = "skins";

/**
 * Find (or mint) the story root's `skins` space — the model catalog. A normal space, not
 * heaven: it forks with histories like everything else, so each history shows its own models.
 * Called at boot (genesis background furniture) so uploads always have a home; idempotent by
 * name-under-root.
 */
export async function ensureSkinsSpace(history = "0", moment = null) {
  const { getSpaceRootId } = await import("../../../sprout.js");
  const rootId = getSpaceRootId();
  if (!rootId)
    throw new IbpError(
      IBP_ERR.INTERNAL,
      "ensureSkinsSpace: story root not ready",
    );

  const { default: Projection } =
    await import("../../../materials/history/projection.js");
  // History-local first, then main's inherited row (the lazy-fill idiom): the catalog is
  // minted on main and inherited by histories.
  for (const b of history === "0" ? ["0"] : [history, "0"]) {
    const row = await Projection.findOne({
      history: b,
      type: "space",
      "state.parent": String(rootId),
      "state.name": SKINS_SPACE_NAME,
      tombstoned: { $ne: true },
    })
      .select("id")
      .lean();
    if (row) return String(row.id);
  }

  const id = uuidv4();
  const { emitFact } = await import("../../../past/fact/facts.js");
  await emitFact(
    {
      verb: "do",
      act: "create-space",
      through: I,
      of: { kind: "space", id },
      params: {
        name: SKINS_SPACE_NAME,
        type: "space",
        parent: String(rootId),
        size: { x: 100, y: 100 },
        qualities: {},
      },
      actId: moment?.actId || null,
      history,
    },
    moment,
  );
  return id;
}

// WORD-SOURCED registration — no handler. do.js routes this through runOpWord (CALLER mode),
// which runs model.word and stamps the one caller-attributed do:set-model fact on the target
// (dynamic kind via the word's factTarget).
registerOperation("set-model", {
  targets: ["being", "space", "matter"],
  ownerExtension: "seed",
  factAction: "set-model",
  args: {
    modelMatterId: {
      type: "text",
      label: "Model matter id (a type=model matter, e.g. from /skins)",
      required: false,
    },
    forMatterType: {
      type: "text",
      label:
        "Space targets only: set as the default for all matter of this type in the space",
      required: false,
    },
    scale: {
      type: "json",
      label: "Scale (positive number, optional)",
      required: false,
    },
    rotation: {
      type: "json",
      label: "Rotation {x,y,z} (optional)",
      required: false,
    },
    clear: {
      type: "bool",
      label: "Remove the model",
      default: false,
      required: false,
    },
  },
  word: { noun: "being", able: "render" },
  hostEnv: modelHostEnv,
});
