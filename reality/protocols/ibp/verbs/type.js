// IBP TYPE — the statement bar's wire adapter. The live Word press.
//
// Envelope: { id, verb: "type", address, payload: { text } }
//
// A Name with a being types a Word statement in any view; this opens a moment under that
// being, runs typeIntoBook (parse → evaluate → lay the fact(s) at the live edge), and seals it.
// The subject is always FIRST PERSON — it is that Name speaking — so a statement that does not
// start with "I" gets it prepended ("create a space named Art" → "I create a space named Art").
// INVALID Word (a parse error or a Word refusal / gate saying no) lays NOTHING: the moment is
// dropped (zero facts → no Act) and the hint goes back to the bar so the typist sees why it was
// rejected. This is the human half of the scribe — the scribe drafts, you press; the bar IS you
// pressing. The four views are renders of what lands here.

import log from "../../../seed/seedReality/log.js";
import { IBP_ERR, isIbpError } from "../../../seed/ibp/protocol.js";
import { ackOk, ackError } from "../envelope.js";

export async function handleType(socket, env, ack) {
  const id = env?.id || null;
  try {
    // The statement bar belongs to a Name with a being — only a being can speak the Word.
    if (!socket.beingId) {
      return ackError(ack, id, IBP_ERR.UNAUTHORIZED, "You need a being to speak the Word.");
    }
    const raw = String(env?.payload?.text ?? env?.payload?.word ?? "").trim();
    if (!raw) {
      return ackError(ack, id, IBP_ERR.INVALID_INPUT, "Nothing to say.");
    }
    // First person, always — it is this Name speaking. Prepend "I" when the typist omits it.
    let wordText = /^I\b/.test(raw) ? raw : `I ${raw}`;
    // The Word's statements terminate with a period; the typist needn't type it.
    if (!/[.!?]$/.test(wordText)) wordText += ".";

    const branch = socket.currentBranch || "0";
    const identity = { beingId: socket.beingId, name: socket.name, nameId: socket.nameId || null };

    // Where the typist stands — "make here" parents a new space/matter to this position.
    const { loadOrFold } = await import("../../../seed/materials/projections.js");
    const slot = await loadOrFold("being", String(socket.beingId), branch);
    const position = slot?.state?.position || slot?.state?.homeSpace || null;

    const { withBeingAct } = await import("../../../seed/sprout.js");
    const { typeIntoBook } = await import("../../../seed/present/book/type.js");

    let result;
    await withBeingAct(String(socket.beingId), `typed: ${wordText.slice(0, 60)}`, branch, async (moment) => {
      result = await typeIntoBook(wordText, { moment, identity, branch, position });
      // Reject invalid Word: drop the moment's deltaF so nothing lands (withBeingAct no-ops on 0 facts).
      if (!result.ok) moment.deltaF.length = 0;
    });

    if (!result || !result.ok) {
      // The hint — a parse error or a gate's refusal. The bar shows it; no fact was laid.
      return ackError(
        ack, id, IBP_ERR.INVALID_INPUT,
        (result && result.error) || "That isn't valid Word.",
        { where: result?.where || "parse", refusal: !!result?.refusal },
      );
    }
    return ackOk(ack, id, { laid: result.laid, statements: result.statements, result: result.result ?? null });
  } catch (err) {
    if (isIbpError(err)) return ackError(ack, id, err.code, err.message);
    log.warn("IBP:type", `handleType threw: ${err?.message || err}`);
    return ackError(ack, id, IBP_ERR.INTERNAL, "The press failed.");
  }
}
