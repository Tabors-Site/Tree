// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// moment.js — the act. A being is the momentum of the stamper.
// Beat three of the stamping.
//
// stamper.js handed off the prepared { role, summonCtx }. moment
// dispatches: role.summon emits the being's verbs.
//
// Everything past intake speaks raw IBP verbs. SEE / DO / SUMMON / BE
// is the universal currency; every act, every voice, expresses itself
// as one or more verb calls. moment.js doesn't invent a new abstraction
// above the verbs — it calls role.summon and returns what came back.
//
// One contract, three wirings:
//
//   llm voice      — the role's `summon` is auto-wrapped by the role
//                    registry to defaultSummon → runTurn. runTurn is
//                    the inference loop; it turns each tool call the
//                    LLM emits into a raw IBP verb dispatched through
//                    the verb dispatcher. The translation step lives
//                    inside runTurn — not here.
//
//   scripted voice — the role's `summon` is the role's own code (cherub,
//                    llm-assigner, extension-defined scripted roles).
//                    The code calls core.do / core.see / core.summon /
//                    core.be directly. Already verb-shaped at write
//                    time; no translation needed.
//
//   human          — the human role's `summon` returns null. The SUMMON
//                    lands in the human's inbox; the human responds
//                    out-of-band by emitting fresh verb calls from
//                    their own transport. moment.js still runs for
//                    humans (uniform dispatch), it just doesn't have
//                    a synchronous act to wait on. See
//                    [roles/human.js](../roles/human.js).

/**
 * Run the moment: dispatch role.summon and return what came back.
 *
 * @param {object} prepared          — the result of assign(...)
 * @param {object} prepared.role     — the active role spec
 * @param {object} prepared.summonCtx — the summon context the role expects
 *
 * @returns {Promise<{ result, role }>}
 */
export async function moment({ role, summonCtx } = {}) {
  const result = await role.summon(summonCtx.message, summonCtx);
  return { result, role };
}
