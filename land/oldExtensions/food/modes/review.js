// food/modes/review.js
// The reviewer. Read-only. Reads macro values, weekly averages, History notes,
// Meals patterns, and fitness channel data. Analyzes trends and gives advice.

import { getDailyPicture, getHistory } from "../core.js";
import { findExtensionRoot } from "../../../seed/tree/extensionMetadata.js";

export default {
  name: "tree:food-review",
  emoji: "\u{1F4CA}",
  label: "Nutrition Review",
  bigMode: "tree",
  hidden: true,

  maxMessagesBeforeLoop: 8,
  preserveContextOnLoop: true,

  toolNames: [],

  async buildSystemPrompt({ username, rootId, currentNodeId }) {
    const foodRootId = await findExtensionRoot(currentNodeId || rootId, "food") || rootId;

    // Get today's picture with 30 days of daily history
    const picture = foodRootId ? await getDailyPicture(foodRootId, { historyDays: 30 }) : null;

    // Get weekly summaries for longer-term trends
    const weeklySummaries = await getHistory(foodRootId, { limit: 8, type: "weekly" });

    // Build today's snapshot
    let todayBlock = "";
    if (picture?.calories) {
      const lines = [];
      for (const role of (picture._valueRoles || [])) {
        const m = picture[role];
        if (!m) continue;
        const pct = m.goal > 0 ? ` (${Math.round((m.today / m.goal) * 100)}%)` : "";
        const avg = m.weeklyAvg > 0 ? `, avg ${m.weeklyAvg}g` : "";
        const hit = m.weeklyHitRate > 0 ? `, hit ${Math.round(m.weeklyHitRate * 100)}%` : "";
        lines.push(`${m.name || role}: ${m.today}${m.goal > 0 ? `/${m.goal}g` : "g"}${pct}${avg}${hit}`);
      }
      const cal = picture.calories;
      lines.push(`Calories: ${cal.today}${cal.goal > 0 ? `/${cal.goal}` : ""}`);
      todayBlock = "TODAY:\n" + lines.join("\n");
    }

    // Build weekly trends block
    let weeklyBlock = "";
    if (weeklySummaries.length > 0) {
      const weekLines = weeklySummaries.map(w => {
        const parts = [`${w.weekStart} to ${w.weekEnd} (${w.daysTracked}d)`];
        if (w.calories) parts.push(`${w.calories.avg} cal/day`);
        if (w.averages) {
          const macros = Object.entries(w.averages).map(([r, v]) => {
            const hit = w.hitRates?.[r];
            return `${r}:${v}g${hit != null ? `(${Math.round(hit * 100)}%)` : ""}`;
          });
          parts.push(macros.join(" "));
        }
        return parts.join(" | ");
      });
      weeklyBlock = "WEEKLY TRENDS:\n" + weekLines.join("\n");
    }

    // Build 30-day history block
    let historyBlock = "";
    if (picture?.recentHistory?.length > 0) {
      const days = picture.recentHistory.filter(d => (d.type || "daily") === "daily");
      if (days.length > 0) {
        historyBlock = `DAILY HISTORY (${days.length} days):\n` + days.map(d => {
          const parts = [d.date];
          if (d.calories != null) parts.push(`${d.calories}cal`);
          if (d.protein != null) parts.push(`P:${d.protein}`);
          if (d.carbs != null) parts.push(`C:${d.carbs}`);
          if (d.fats != null) parts.push(`F:${d.fats}`);
          return parts.join(" ");
        }).join("\n");
      }
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

    // Recent meals
    let mealsBlock = "";
    if (picture?.mealsBySlot) {
      const slotLines = [];
      for (const [slot, meals] of Object.entries(picture.mealsBySlot)) {
        if (meals?.length > 0) {
          slotLines.push(`${slot}: ${meals.map(m => m.text).join(", ")}`);
        }
      }
      if (slotLines.length > 0) mealsBlock = "MEALS BY SLOT:\n" + slotLines.join("\n");
    }

    return `You are ${username}'s nutrition reviewer.

${todayBlock}
${weeklyBlock ? `\n${weeklyBlock}` : ""}
${historyBlock ? `\n${historyBlock}` : ""}
${profileBlock ? `\n${profileBlock}` : ""}
${mealsBlock ? `\n${mealsBlock}` : ""}

TWO DIRECTIONS
If the user asks about past patterns, analyze history. Look at weekly trends, hit rates,
meal slot patterns, and daily history. "You've been under on protein 4 of the last 7 days.
You skip breakfast 3 days a week. On days you eat breakfast, your protein hits target."

If the user asks what to eat next, look forward. Read today's remaining macros against goals,
their meal slot history for variety, and fitness data for recovery needs. Be specific:
"You need 52g protein and 800 calories to hit your targets. You trained chest today so recovery
matters. You've had chicken five times this week. Try salmon and sweet potato."

YOUR ROLE
- Answer questions about today's intake and longer-term trends
- Suggest specific meals that fit remaining macros and respect restrictions
- Spot patterns from weekly trends and daily history
- Use meal slot patterns: "you eat eggs 4 out of 5 mornings, your protein is highest on egg days"
- Be practical and specific. Use actual numbers.
- When fitness data is in context, factor it in
- Suggest variety based on meal history

RULES
- Never mention node IDs, metadata, tools, or internal structure
- Reference meals by name, not by technical identifier
- Use the profile for context: goals, restrictions, preferences
- If weekly hit rate is below 60%, call it out with the pattern
- Match the user's energy. "How am I doing" gets a quick summary. "Plan my week" gets detail.
- When suggesting meals, use foods from their recent history when possible
- Be honest about overages and patterns. No false praise.`.trim();
  },
};
