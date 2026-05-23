// food/modes/daily.js
// The advisor. Read-only. Reads the assembled picture from macro node
// values, recent meals from Log, and profile from root. Responds to
// questions about intake, suggestions, and patterns.

import { findFoodNodes, getDailyPicture, getHistory, STRUCTURAL_ROLES } from "../core.js";
import { findExtensionRoot } from "../../../seed/tree/extensionMetadata.js";

export default {
  name: "tree:food-daily",
  emoji: "\u{1F4CA}",
  label: "Daily Summary",
  bigMode: "tree",
  hidden: true,

  maxMessagesBeforeLoop: 6,
  preserveContextOnLoop: true,

  toolNames: [],

  async buildSystemPrompt({ username, rootId, currentNodeId }) {
    const Node = (await import("../../../seed/models/node.js")).default;
    const foodRootId = await findExtensionRoot(currentNodeId || rootId, "food") || rootId;
    const picture = foodRootId ? await getDailyPicture(foodRootId) : null;

    // Build today's macro summary
    let todayBlock = "No data yet today.";
    if (picture?.calories) {
      const lines = [];
      for (const role of (picture._valueRoles || [])) {
        const m = picture[role];
        if (!m) continue;
        const pct = m.goal > 0 ? ` (${Math.round((m.today / m.goal) * 100)}%)` : "";
        const avg = m.weeklyAvg > 0 ? `, weekly avg ${m.weeklyAvg}g` : "";
        const hit = m.weeklyHitRate > 0 ? `, hit rate ${Math.round(m.weeklyHitRate * 100)}%` : "";
        lines.push(`${m.name || role}: ${m.today}${m.goal > 0 ? `/${m.goal}g` : "g"}${pct}${avg}${hit}`);
      }
      const cal = picture.calories;
      const calPct = cal.goal > 0 ? ` (${Math.round((cal.today / cal.goal) * 100)}%)` : "";
      lines.push(`Calories: ${cal.today}${cal.goal > 0 ? `/${cal.goal}` : ""}${calPct}`);
      if (cal.goal > 0) lines.push(`Remaining: ${Math.max(0, cal.goal - cal.today)} cal`);
      todayBlock = lines.join("\n");
    }

    // Recent meals
    let mealsBlock = "";
    if (picture?.recentMeals?.length > 0) {
      mealsBlock = "RECENT MEALS:\n" + picture.recentMeals.map(m => `- ${m.text}`).join("\n");
    }

    // Profile
    let profileBlock = "";
    if (picture?.profile) {
      const p = picture.profile;
      const parts = [];
      if (p.goal) parts.push(`goal: ${p.goal}`);
      if (p.restrictions) parts.push(`restrictions: ${p.restrictions}`);
      if (p.calorieGoal) parts.push(`target: ${p.calorieGoal} cal`);
      if (parts.length > 0) profileBlock = `PROFILE: ${parts.join(", ")}`;
    }

    // Weekly trends from history
    let weeklyBlock = "";
    const weeklySummaries = await getHistory(foodRootId, { limit: 4, type: "weekly" });
    if (weeklySummaries.length > 0) {
      const latest = weeklySummaries[0];
      const lines = [`Week of ${latest.weekStart} to ${latest.weekEnd} (${latest.daysTracked} days tracked)`];
      if (latest.calories) lines.push(`Avg calories: ${latest.calories.avg}`);
      if (latest.averages) {
        for (const [role, avg] of Object.entries(latest.averages)) {
          const hit = latest.hitRates?.[role];
          const hitStr = hit != null ? ` (hit rate ${Math.round(hit * 100)}%)` : "";
          lines.push(`Avg ${role}: ${avg}g${hitStr}`);
        }
      }
      weeklyBlock = "WEEKLY TRENDS:\n" + lines.join("\n");
    }

    // Recent daily history
    let historyBlock = "";
    if (picture?.recentHistory?.length > 0) {
      const days = picture.recentHistory.filter(d => (d.type || "daily") === "daily").slice(0, 7);
      if (days.length > 0) {
        historyBlock = "PAST 7 DAYS:\n" + days.map(d => {
          const parts = [`${d.date}: ${d.calories || 0} cal`];
          if (d.protein != null) parts.push(`P:${d.protein}`);
          if (d.carbs != null) parts.push(`C:${d.carbs}`);
          if (d.fats != null) parts.push(`F:${d.fats}`);
          return parts.join(" ");
        }).join("\n");
      }
    }

    return `You are ${username}'s nutrition advisor at the Daily node.

TODAY:
${todayBlock}
${mealsBlock ? `\n${mealsBlock}` : ""}
${profileBlock ? `\n${profileBlock}` : ""}
${weeklyBlock ? `\n${weeklyBlock}` : ""}
${historyBlock ? `\n${historyBlock}` : ""}

YOUR ROLE
- Answer questions about today's intake: "how am I doing", "am I on track"
- Suggest meals that fit remaining macros: "what should I eat for dinner"
- Spot patterns from history: "you've been low on protein 4 of the last 7 days"
- Be practical and specific. Use actual numbers. "You need 52g protein. Chicken thigh would cover it."

RULES
- Never mention node IDs, metadata, tools, or internal structure
- Reference meals by name, not by technical identifier
- Use the profile for context: goal (cut/bulk/maintain), restrictions, preferences
- If history shows a pattern, mention it naturally: "you usually skip breakfast on Wednesdays"
- Match the user's energy. "How am I doing" gets a quick summary. "Plan my week" gets detail.
- When suggesting meals, use foods from their recent history when possible
- Be honest about overages: "you went 300 over yesterday, mostly from the pizza at dinner"`.trim();
  },
};
