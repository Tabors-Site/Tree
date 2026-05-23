// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Folding older sub-moments inside one being's running moment.
// When a being's tool loop has run long enough that the next
// provider call would push the assembled frame past the context
// window, I collapse the older internal messages into one summary
// so the moment can keep going. The being is still in its single
// moment; I am keeping the assembled frame survivable.
//
// (Note: this is mid-moment compression — folding within one
// running summon's tool loop. Across moments, the
// CARRY_MESSAGES-length tail is the only thread, and the rest of
// the past lives on the reel as Act rows, not in any
// in-memory tail.)
//
// Default behavior is mechanical: pull assistant prose from the
// compress range, concat, cap near 2000 chars, replace the range
// with one system message tagged `_compressed`. No LLM call.
// Extensions wanting smarter summaries register the `onCompress`
// hook; it receives the raw messages and the mechanical summary,
// and may write a better one back through the same field.
//
// Why ON by default. A branch summon that reads four sibling
// files stacks enough tool results to blow past a remote
// provider's context window on the next sub-call inside the
// moment. The old default (off) meant compression never ran
// unless the operator turned it on; the symptom was cryptic
// 413/402 errors from failover providers mid-swarm. Now
// operators who want compression off set
// `conversationCompression: false` in place config. The default
// threshold (20 messages) catches the branch-summon case without
// touching short moments.
//
// What I preserve. The system prompt (always index 0 — the
// rendered being-frame's standing identity) and the last `keep`
// messages. Everything between gets summarized. The compressed
// marker sits at index 1 so a second pass detects "already
// compressed recently" and skips.
//
// Pure history operation. I read and mutate session.messages and
// nothing else: no LLM client, no scheduler, no inbox. I am
// in-moment maintenance machinery.

import log from "../../../parentReality/log.js";
import { getFactoryConfigValue } from "../../../factoryConfig.js";
import { hooks } from "../../../hooks.js";
import { getRealityConfigValue } from "../../../realityConfig.js";

// Getters resolve from place config at call time so an operator
// flip lands without restart.
export const COMPRESSION_ENABLED = () => {
  const v = getFactoryConfigValue("conversationCompression");
  return v !== false; // default true; only off when explicitly false
};
export const COMPRESSION_THRESHOLD = () =>
  Number(getFactoryConfigValue("compressionThreshold")) || 20;
export const COMPRESSION_KEEP = () =>
  Number(getFactoryConfigValue("compressionKeep")) || 8;

/**
 * Fold the middle of session.messages into a summary. Idempotent
 * on already-compressed buffers; mutates in place. I preserve the
 * system prompt at index 0 and the last `keep` messages at the
 * tail.
 */
export async function compressConversation(session, threshold, keep) {
  const msgs = session.messages;
  if (msgs.length < threshold) return;

  // Already-compressed marker at index 1. A second pass would just
  // re-compress the same range, so I skip.
  if (msgs[1]?.role === "system" && msgs[1]?._compressed) return;

  const systemPrompt = msgs[0];
  const preserveStart = Math.max(1, msgs.length - keep);
  const toCompress = msgs.slice(1, preserveStart);
  const toKeep = msgs.slice(preserveStart);

  // Below four messages there's nothing to gain — the summary
  // overhead would equal what it replaced.
  if (toCompress.length < 4) return;

  // Mechanical pass: assistant prose only. Skip tool-call-only
  // messages (their string content is too short to add signal).
  const summaryParts = [];
  for (const msg of toCompress) {
    if (
      msg.role === "assistant" &&
      msg.content &&
      typeof msg.content === "string"
    ) {
      const text = msg.content.trim();
      if (text.length > 20) summaryParts.push(text);
    }
  }

  if (summaryParts.length === 0) return;

  // Cap near 2000 chars so the summary is useful but doesn't itself
  // dominate the next call's context.
  let summary = summaryParts.join("\n").slice(0, 2000);
  if (summaryParts.join("\n").length > 2000)
    summary += "\n... (earlier context compressed)";

  // onCompress lets an extension replace the mechanical summary
  // with an LLM-powered one. It writes back through hookData.summary;
  // if no handler is registered, the mechanical version stands.
  try {
    const hookData = {
      messages: toCompress,
      mechanicalSummary: summary,
      summary,
    };
    await hooks.run("onCompress", hookData);
    summary = hookData.summary;
  } catch {}

  const compressedMsg = {
    role: "system",
    content: `[Compressed context from ${toCompress.length} earlier messages]\n${summary}`,
    _compressed: true,
  };

  session.messages = [systemPrompt, compressedMsg, ...toKeep];

  log.verbose(
    "LLM",
    `Compressed ${toCompress.length} messages into summary (${summary.length} chars), kept ${toKeep.length}`,
  );
}
