// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// ableManagerHost.js — the host floor for set-able.word / delete-able.word (able-manager, the live
// able-authoring DO ops). These ops are MANIFEST-ORCHESTRATION, not field-setters: each writes the
// `.ables/<name>` manifest child (addManifestChild / removeManifestChild — a chain write on the
// .ables space reel) AND mutates the in-memory able registry (registerAble / unregisterAble — the
// hot-register that makes the able live without a restart). That genuine EFFECT is the op; the .word
// is the thin control strand (the `name` gate + the audit return). The two see-ops below REUSE the
// EXACT primitives the JS handlers called — addManifestChild / registerAble / removeManifestChild /
// unregisterAble / findAbleReferences — with ZERO reimplementation, so behavior is byte-identical.
//
// (Honest note: a `see` is meant to be inert, and these lay the manifest fact + hot-register. The
// manifest write is the op's genuine effect, reached the SAME way the handler reached it; a future
// purify could split the manifest write into explicit `do create-space` / `do set-space` deeds. For
// now this is the no-mirror, no-JS-handler, behavior-preserving word-sole cut — the board move.)
//
// The do:set-able / do:delete-able AUDIT fact lands on the able's pseudo-reel {space, name}: each
// see returns `name`, and set-able.word / delete-able.word surface it as `spaceId` so the dispatcher's
// resolveAuditTarget targets {space, name} (the shape the handler's targetsFact produced); the fact's
// params stay ctx.params, exactly as before.

import { addManifestChild, removeManifestChild } from "../../manifest.js";
import { HEAVEN_SPACE } from "../../../materials/space/heavenSpaces.js";
import { IbpError, IBP_ERR } from "../../../ibp/protocol.js";
import { registerAble, unregisterAble, getAble } from "../registry.js";
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
    // author-live-able(params) — the set-able EFFECT. Validate name/cognition, build the granted
    // word-set `can` + ableQualities, write the .ables/<name> manifest child (addManifestChild) and
    // hot-register the able (registerAble). Returns { written, name, origin, hotRegistered }. The
    // .word surfaces `name` as `spaceId` so the audit fact lands on {space, name}. Throws the SAME
    // IbpErrors the handler threw.
    "author-live-able": async ({ args: [params] }, ctx) => {
      const moment = ctx?.moment;
      const name = String(params?.name || "").trim();
      if (!name || !ABLE_NAME_RE.test(name)) {
        throw new IbpError(
          IBP_ERR.INVALID_INPUT,
          `set-able: name must be kebab-case (e.g. "judge" or "ext:able"); got "${name}"`,
        );
      }
      const requiredCognition = String(params?.requiredCognition || "").trim();
      if (requiredCognition && !VALID_COGNITION.has(requiredCognition)) {
        throw new IbpError(
          IBP_ERR.INVALID_INPUT,
          `set-able: requiredCognition must be one of llm/human/scripted or empty; got "${requiredCognition}"`,
        );
      }
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
        requiredCognition: requiredCognition || null,
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

      // Hot-register: makes the able available to the next moment-open WITHOUT a restart (the manifest
      // write above is the durable truth boot rebuilds from). Overwrites silently on name collision.
      try {
        registerAble(
          name,
          {
            description: `Live able authored via @able-manager.`,
            requiredCognition: requiredCognition || null,
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

    // remove-live-able(name, force) — the delete-able EFFECT. Origin check (only live ables delete at
    // runtime), reference safety (refuse if any being's flow/defaultAble names it, unless force),
    // then remove the manifest child + unregister. Returns { deleted, name }. Throws the SAME errors.
    "remove-live-able": async ({ args: [nameArg, force] }, ctx) => {
      const moment = ctx?.moment;
      const name = String(nameArg || "").trim();
      if (!name) {
        throw new IbpError(IBP_ERR.INVALID_INPUT, "delete-able: `name` is required");
      }
      const existing = getAble(name);
      if (!existing) {
        throw new IbpError(IBP_ERR.INVALID_INPUT, `delete-able: able "${name}" not registered`);
      }
      if (existing.origin && existing.origin !== "live") {
        throw new IbpError(
          IBP_ERR.INVALID_INPUT,
          `delete-able: able "${name}" is ${existing.origin}-owned. ` +
            `Only live-authored ables can be deleted at runtime.`,
        );
      }
      const forced = force === true || force === "true";
      if (!forced) {
        const referrers = await findAbleReferences(name);
        if (referrers.length) {
          throw new IbpError(
            IBP_ERR.INVALID_INPUT,
            `delete-able: able "${name}" is referenced by ${referrers.length} being(s): ` +
              `${referrers.slice(0, 5).map((r) => `@${r.name}`).join(", ")}` +
              `${referrers.length > 5 ? ` (+${referrers.length - 5} more)` : ""}. ` +
              `Update those beings' flows first, or pass force:true.`,
          );
        }
      }
      await removeManifestChild({
        heavenSpace: HEAVEN_SPACE.ABLES,
        name,
        itemType: "resource",
        moment,
      });
      unregisterAble(name);
      return { deleted: true, name };
    },
  };
}
