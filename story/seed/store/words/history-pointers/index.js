// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// history-pointers store bundle. Carved from history-manager/ops.js.
//
// The two named-pointer registry ops — set-pointer / delete-pointer —
// plus their bridge runners and their co-located `.word` slices. The
// pointer map lives on the `.histories` heaven space's qualities.pointers.
// The IBP address parser resolves named pointers (#main, #prod) through
// this map via resolveHistoryPointers (the wire-layer async step).
// Canonical paths (#0, #1a2) bypass.
//
// These ops were briefly hosted on a dedicated @history-registry
// delegate; retired 2026-06-04 when "heaven never branches" landed.
// The storage is heaven; the ops live with the history-manager
// workflow they participate in (merging frequently re-points main).

import { registerOperation } from "../../../ibp/operations.js";
import { IbpError, IBP_ERR } from "../../../ibp/protocol.js";
import {
  readPointers,
  POINTER_NAME_MAX_LENGTH,
  RESERVED_POINTERS,
  findPointersSpaceId,
  isPointerName,
} from "../../../materials/history/historyRegistry.js";
import { doVerb } from "../../../ibp/verbs/do.js";
import { registerRoleWord } from "../../../present/word/roleWordRegistry.js";
import log from "../../../seedStory/log.js";

// Self-register this bundle's co-located `.word` slices (CONVERTING.md): importing
// this module (at seed boot, or in a DRY harness) registers them so resolveRoleWord(
// "history-manager", "set-pointer") finds it. The cut wires the bridge into the
// set-pointer handler (run the .word's CONTROL strand through runRoleWord with
// historyManagerHostEnv; JS handler stays as the clean-miss fallback).
registerRoleWord(
  "history-manager",
  "set-pointer",
  new URL("./history-manager.word", import.meta.url),
);
registerRoleWord(
  "history-manager",
  "delete-pointer",
  new URL("./delete-pointer.word", import.meta.url),
);

// Canonical-path grammar (mirrors history_RE in address.js). Used by
// set-pointer to reject structurally-invalid `canonical` arguments.
const CANONICAL_PATH_RE = /^(?:0|\d+(?:[a-z]+\d+)*(?:[a-z]+)?)$/;

// set-pointer's world strand is history-manager.word (the gate chain), run through the
// bridge in CALLER mode (no `through` — the pointer write attributes to the setter). The
// heaven reads + the lone set-space stay host. Returns {set,name,canonical,previous}, or
// null on a clean miss so the JS body below runs.
async function _setPointerViaWord({ caller, name, canonical, moment }) {
  if (!moment) return null;
  const { resolveRoleWord, runRoleWord } =
    await import("../../../present/word/roleWordRegistry.js");
  const ir = resolveRoleWord(
    "history-manager",
    "set-pointer",
    moment?.actorAct?.history,
  );
  if (!ir) return null;
  const { historyManagerHostEnv } = await import("./historyManagerHost.js");
  const history = moment?.actorAct?.history || "0";
  try {
    const { result } = await runRoleWord(ir, {
      moment,
      history,
      trigger: {
        caller: caller ? String(caller) : null,
        name,
        canonical,
        history,
      },
      env: { host: historyManagerHostEnv() },
    });
    return result || null;
  } catch (e) {
    if (e && e.__wordRefusal)
      throw new IbpError(e.code || IBP_ERR.INVALID_INPUT, e.message);
    throw e;
  }
}

registerOperation("set-pointer", {
  targets: ["being", "stance"],
  ownerExtension: "seed",
  skipAudit: false,
  args: {
    name: {
      type: "text",
      label: 'Pointer name (e.g. "main", "prod", "release-v2")',
      required: true,
    },
    canonical: {
      type: "text",
      label:
        'Canonical history path the pointer should resolve to (e.g. "0", "7", "1a2")',
      required: true,
    },
  },
  handler: async ({ params, identity, moment }) => {
    // THE CONVERSION: prefer the bridge; the JS below is the clean-miss fallback.
    const viaWord = await _setPointerViaWord({
      caller: identity?.beingId,
      name: params?.name,
      canonical: params?.canonical,
      moment,
    });
    if (viaWord) return viaWord;

    if (!identity?.beingId) {
      throw new IbpError(
        IBP_ERR.UNAUTHORIZED,
        "set-pointer requires an authenticated being",
      );
    }
    const name = String(params?.name || "")
      .trim()
      .toLowerCase();
    const canonical = String(params?.canonical || "").trim();
    if (!isPointerName(name)) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        `set-pointer: name "${name}" is invalid. ` +
          `Must start with a lowercase letter, end with a letter or digit, ` +
          `and contain only lowercase letters, digits, and single hyphens ` +
          `(no consecutive or trailing hyphens). Max ${POINTER_NAME_MAX_LENGTH} chars.`,
      );
    }
    if (!CANONICAL_PATH_RE.test(canonical)) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        `set-pointer: canonical "${canonical}" is not a structurally valid path (expected "0", "1", "1a", "7b3", etc.)`,
      );
    }

    const current = await readPointers();
    const next = { ...current, [name]: canonical };

    const historiesSpaceId = await findPointersSpaceId();
    if (!historiesSpaceId) {
      throw new IbpError(
        IBP_ERR.INTERNAL,
        "set-pointer: .histories heaven space not found . story is not properly bootstrapped",
      );
    }
    await doVerb(
      { kind: "space", id: historiesSpaceId },
      "set-space",
      { field: "qualities.pointers", value: next, merge: false },
      { identity, moment },
    );

    log.verbose(
      "history-manager",
      `set-pointer #${name} → #${canonical} (by ${identity.beingId.slice(0, 8)})`,
    );
    return { set: true, name, canonical, previous: current[name] || null };
  },
});

// delete-pointer's world strand is delete-pointer.word (the gate chain), run through the
// bridge in CALLER mode. The heaven read + the lone pointer-map set-space stay host.
// Returns {name, deleted, alreadyAbsent} or null on a clean miss so the JS body runs.
async function _deletePointerViaWord({ caller, name, moment }) {
  if (!moment) return null;
  const { resolveRoleWord, runRoleWord } =
    await import("../../../present/word/roleWordRegistry.js");
  const ir = resolveRoleWord(
    "history-manager",
    "delete-pointer",
    moment?.actorAct?.history,
  );
  if (!ir) return null;
  const { historyManagerHostEnv } = await import("./historyManagerHost.js");
  const history = moment?.actorAct?.history;
  try {
    const { result } = await runRoleWord(ir, {
      moment,
      history,
      trigger: { caller: caller ? String(caller) : null, name, history },
      env: { host: historyManagerHostEnv() },
    });
    return result || null;
  } catch (e) {
    if (e && e.__wordRefusal)
      throw new IbpError(e.code || IBP_ERR.INVALID_INPUT, e.message);
    throw e;
  }
}

registerOperation("delete-pointer", {
  targets: ["being", "stance"],
  ownerExtension: "seed",
  skipAudit: false,
  args: {
    name: {
      type: "text",
      label: "Pointer name to delete",
      required: true,
    },
  },
  handler: async ({ params, identity, moment }) => {
    // THE CONVERSION: prefer the bridge; the JS below is the clean-miss fallback.
    const viaWord = await _deletePointerViaWord({
      caller: identity?.beingId,
      name: params?.name,
      moment,
    });
    if (viaWord) return viaWord;

    if (!identity?.beingId) {
      throw new IbpError(
        IBP_ERR.UNAUTHORIZED,
        "delete-pointer requires an authenticated being",
      );
    }
    const name = String(params?.name || "")
      .trim()
      .toLowerCase();
    if (!isPointerName(name)) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        `delete-pointer: name "${name}" is invalid. ` +
          `Must start with a lowercase letter, end with a letter or digit, ` +
          `and contain only lowercase letters, digits, and single hyphens. ` +
          `Max ${POINTER_NAME_MAX_LENGTH} chars.`,
      );
    }
    if (RESERVED_POINTERS.includes(name)) {
      throw new IbpError(
        IBP_ERR.FORBIDDEN,
        `delete-pointer: "${name}" is reserved and cannot be deleted. Re-point it via set-pointer instead.`,
      );
    }

    const current = await readPointers();
    if (!Object.prototype.hasOwnProperty.call(current, name)) {
      return { deleted: false, name, alreadyAbsent: true };
    }
    const next = { ...current };
    delete next[name];

    const historiesSpaceId = await findPointersSpaceId();
    if (!historiesSpaceId) {
      throw new IbpError(
        IBP_ERR.INTERNAL,
        "delete-pointer: .histories heaven space not found",
      );
    }
    await doVerb(
      { kind: "space", id: historiesSpaceId },
      "set-space",
      { field: "qualities.pointers", value: next, merge: false },
      { identity, moment },
    );

    log.verbose(
      "history-manager",
      `delete-pointer #${name} (by ${identity.beingId.slice(0, 8)})`,
    );
    return { deleted: true, name };
  },
});
