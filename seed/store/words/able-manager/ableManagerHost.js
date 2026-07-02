// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// ableManagerHost.js — the host floor for set-able.word / delete-able.word (able-manager, the live
// able-authoring DO ops). The DECISIONS now live in the .word: every gate (valid-able-name /
// valid-able-cognition; able-registered / able-deletable / able-blocks-delete) is a pure boolean
// READ the word refuses on (the may-set-X pattern). The host keeps only those reads + the two
// genuine EFFECTS — author-able / remove-able — which write the `.ables/<name>` manifest child
// (addManifestChild / removeManifestChild — a chain write on the .ables space reel) AND mutate the
// in-memory able registry (registerAble / unregisterAble — the hot-register that makes the able live
// without a restart). They reuse the EXACT primitives the JS handlers called, ZERO reimplementation.
//
// (Honest note: a `see` is meant to be inert, and author-able / remove-able lay the manifest fact +
// hot-(un)register. A future purify splits that manifest write into explicit `do create-space` /
// `do set-space` deeds; for now the effect stays a host see, but the word carries every decision.)
//
// The do:set-able / do:delete-able AUDIT fact lands on the able's pseudo-reel {space, name}: each
// see returns `name`, and set-able.word / delete-able.word surface it as `spaceId` so the dispatcher's
// resolveAuditTarget targets {space, name} (the shape the handler's targetsFact produced); the fact's
// params stay ctx.params, exactly as before.

import { addManifestChild, removeManifestChild } from "../../../present/manifest.js";
import { HEAVEN_SPACE } from "../../../materials/space/heavenSpaces.js";
import { IbpError, IBP_ERR } from "../../../ibp/protocol.js";
import { registerAble, unregisterAble, getAble } from "../../../present/ables/registry.js";
import {
  listByType,
  loadProjection,
} from "../../../materials/projections.js";

// Same regex the able registry enforces via name validation.
const ABLE_NAME_RE = /^[a-z][a-z0-9-]*(:[a-z][a-z0-9-]+)?$/;
const VALID_COGNITION = new Set(["llm", "human", "scripted"]);

// Parse a textarea list — one entry per line, trim, drop blanks (canSee/canDo/canCall/canBe inputs).
function parseLines(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== "string") return [];
  return value
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Walk every being's flow + defaultAble for references to a able name (delete-able's safety check).
async function findAbleReferences(name) {
  // Curated cross-being scan on main: the prior Being.find({}) read the
  // whole beings collection; listByType("being","0") gives the live ids
  // and loadProjection reads each being's defaultAble/qualities/name.
  const occupants = await listByType("being", "0");
  const hits = [];
  for (const occ of occupants) {
    const slot = await loadProjection("being", occ.id, "0");
    if (!slot || slot.tombstoned) continue;
    const state = slot.state || {};
    const beingId = String(occ.id);
    if (state.defaultAble === name) {
      hits.push({ beingId, name: state.name, via: "defaultAble" });
      continue;
    }
    const quals = state.qualities;
    const flow = quals instanceof Map ? quals.get("flow") : quals?.flow;
    if (Array.isArray(flow)) {
      for (const clause of flow) {
        if (clause && clause.able === name) {
          hits.push({ beingId, name: state.name, via: "flow" });
          break;
        }
      }
    }
  }
  return hits;
}

export function ableManagerHostEnv() {
  return {
    // ── pure READS the .word GATES on (the decisions now live in the word, not the host) ──

    // valid-able-name(name) → kebab-case shape check (empty / missing → false).
    "valid-able-name": ({ args: [name] }) =>
      ABLE_NAME_RE.test(String(name || "").trim()),

    // valid-able-cognition(cog) → empty or one of llm/human/scripted.
    "valid-able-cognition": ({ args: [cog] }) => {
      const c = String(cog || "").trim();
      return c === "" || VALID_COGNITION.has(c);
    },

    // able-registered(name) → is this able currently in the registry?
    "able-registered": ({ args: [name] }) =>
      Boolean(getAble(String(name || "").trim())),

    // able-deletable(name) → registered AND live-authored (no origin or origin "live"): a
    // seed/extension able is not removable from the chain at runtime.
    "able-deletable": ({ args: [name] }) => {
      const a = getAble(String(name || "").trim());
      return Boolean(a && (!a.origin || a.origin === "live"));
    },

    // able-blocks-delete(name, force) → referenced by a being's flow/defaultAble AND not forced
    // (deleting would dangle the reference). force:true clears it.
    "able-blocks-delete": async ({ args: [name, force] }) => {
      if (force === true || force === "true") return false;
      const refs = await findAbleReferences(String(name || "").trim());
      return refs.length > 0;
    },

    // ── the genuine EFFECTS — a see that lays the .ables manifest fact + hot-(un)registers. Honest
    //    impurity (a future purify splits the manifest write into explicit do create-space/set-space
    //    deeds); the .word now carries EVERY gate, so these assume an already-validated request. ──

    // author-able(params) — compose the granted word-set from the picker inputs, write the
    // .ables/<name> manifest child (addManifestChild), hot-register (registerAble). The .word
    // surfaces the returned `name` as `spaceId` so the audit fact lands on {space, name}.
    "author-able": async ({ args: [params] }, ctx) => {
      const moment = ctx?.moment;
      const name = String(params?.name || "").trim();
      const requiredCognition =
        String(params?.requiredCognition || "").trim() || null;
      const canSee = parseLines(params?.canSee);
      const canDo = parseLines(params?.canDo);
      const canCall = Array.isArray(params?.canCall)
        ? params.canCall
        : parseLines(params?.canCall);
      const canBe = parseLines(params?.canBe);
      const prompt = typeof params?.prompt === "string" ? params.prompt : "";

      // Collapse the picker inputs into the canonical granted-word-set `can` — each carries its verb.
      const can = [
        ...canSee.map((w) => ({ verb: "see", word: w })),
        ...canDo.map((w) => ({ verb: "do", word: w })),
        ...canCall.map((w) =>
          typeof w === "string" ? { verb: "call", word: w } : { verb: "call", ...w },
        ),
        ...canBe.map((w) => ({ verb: "be", word: w })),
      ];

      const ableQualities = {
        cognition: null, // live ables don't carry cognition (it's on the being)
        requiredCognition,
        permissions: [...new Set(can.map((e) => e.verb))],
        respondMode: "async",
        triggerOn: ["message"],
        can,
        replyTo: null,
        prompt,
        origin: "live",
      };

      await addManifestChild({
        heavenSpace: HEAVEN_SPACE.ABLES,
        name,
        qualities: new Map([["able", ableQualities]]),
        itemType: "resource",
        moment,
      });

      // Hot-register: live without a restart (the manifest write is the durable truth boot rebuilds
      // from). Overwrites silently on name collision.
      try {
        registerAble(
          name,
          {
            description: `Live able authored via @able-manager.`,
            requiredCognition,
            can,
            replyTo: null,
            prompt: () => prompt,
          },
          "live",
        );
      } catch (err) {
        throw new IbpError(
          IBP_ERR.INVALID_INPUT,
          `set-able: persisted to .ables but in-memory register failed: ${err.message}`,
        );
      }

      return { written: true, name, origin: "live", hotRegistered: true };
    },

    // remove-able(name) — remove the .ables/<name> manifest child (removeManifestChild) + unregister.
    "remove-able": async ({ args: [name] }, ctx) => {
      const moment = ctx?.moment;
      const n = String(name || "").trim();
      await removeManifestChild({
        heavenSpace: HEAVEN_SPACE.ABLES,
        name: n,
        itemType: "resource",
        moment,
      });
      unregisterAble(n);
      return { deleted: true, name: n };
    },
  };
}
