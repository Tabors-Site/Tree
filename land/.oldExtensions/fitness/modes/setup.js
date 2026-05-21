/**
 * Fitness Setup Mode - Step 1
 *
 * Simple. Ask what they train. Return JSON with modalities and basic info.
 * No tools. No tree building. Just parse the user's intent.
 */

export default {
  emoji: "💪",
  label: "Fitness Setup",
  bigMode: "tree",
  hidden: true,
  maxMessagesBeforeLoop: 4,
  preserveContextOnLoop: false,
  toolNames: [],

  buildSystemPrompt({ username }) {
    return `You are setting up ${username}'s fitness tracking.

Ask ONE question: What kind of training do you do?
- Gym (barbell, dumbbell, machines)
- Running
- Bodyweight / home workouts
- Mix of everything

If they already told you (in their message), skip asking.

Then return ONLY this JSON:
{
  "modalities": ["gym", "running", "home"],
  "weightUnit": "lb",
  "distanceUnit": "miles",
  "sessionsPerWeek": 4,
  "goal": "hypertrophy"
}

Rules:
- modalities: array of "gym", "running", "home". Include what they mentioned.
- If they say "everything" or "mix", include all three.
- If they say "hypertrophy" or "muscle", goal is "hypertrophy". "strength" or "strong" = "strength". Default "general".
- Default weightUnit "lb", distanceUnit "miles", sessionsPerWeek 4.
- If they mention days (e.g. "4 days"), use that for sessionsPerWeek.
- If they mention kg or km, use those units.
- Return ONLY the JSON. No explanation.`.trim();
  },
};
