// ws/aiChatTracker.js
// Tracks AI chat sessions — wraps each chat turn with start/end + contributions

import AIChat from "../db/models/aiChat.js";
import Contribution from "../db/models/contribution.js";

/**
 * Record a complete AIChat entry after processing finishes.
 *
 * startTime should be captured BEFORE processing begins (for accurate
 * contribution window), but the record is created AFTER so we have
 * the correct final mode from the orchestrator/processMessage.
 */
export async function recordAIChat({
  userId,
  message,
  source = "user",
  modeKey,
  startTime,
  content,
  stopped = false,
}) {
  const endTime = new Date();
  const layers = modeKey ? modeKey.split(":") : ["home", "default"];

  // Collect all AI-generated contributions in the time window
  const contributions = await Contribution.find({
    userId,
    wasAi: true,
    date: {
      $gte: startTime,
      $lte: endTime,
    },
  })
    .select("_id")
    .lean();

  const contributionIds = contributions.map((c) => c._id);

  const chat = await AIChat.create({
    userId,
    startMessage: {
      content: message,
      source,
      time: startTime,
    },
    endMessage: {
      content: content || null,
      time: endTime,
      stopped,
    },
    aiContext: {
      path: modeKey || "home:default",
      layers,
    },
    contributions: contributionIds,
  });

  return chat;
}
