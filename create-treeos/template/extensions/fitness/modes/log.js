// fitness/modes/log.js
// The receiver. Parses workout input into structured exercise data.
// No tools. Returns JSON. One LLM call.

export default {
  name: "tree:fitness-log",
  emoji: "📋",
  label: "Fitness Log",
  bigMode: "tree",
  hidden: true,

  maxMessagesBeforeLoop: 2,
  preserveContextOnLoop: false,

  toolNames: [],

  buildSystemPrompt() {
    return `You are a workout log parser. Parse the user's exercise input into structured data.

Return ONLY JSON:
{
  "exercises": [
    {
      "name": "standard exercise name",
      "group": "Chest" | "Back" | "Legs" | "Shoulders" | "Core" | "Additional",
      "sets": [
        { "weight": number, "reps": number, "unit": "lb" | "kg" | "bodyweight" }
      ]
    }
  ],
  "date": "YYYY-MM-DD"
}

Parsing rules:
- "bench 135x10,10,8" = Bench Press, Chest, [{135,10},{135,10},{135,8}]
- "squat 225 5x5" = Squats, Legs, 5 sets of [{225,5}]
- "pull-ups 10,8,6" = Pull-ups, Back, bodyweight, [{0,10},{0,8},{0,6}]
- "ohp 95x8,8,6" = OHP, Shoulders, [{95,8},{95,8},{95,6}]
- "lateral raises 20x12,12,12" = Lateral Raises, Shoulders
- "rdl 135x10,10,10" = Romanian Deadlift, Legs
- Default unit is lb unless user says kg
- Use standard names: Bench Press, Squats, OHP, Pull-ups, Romanian Deadlift, Barbell Rows, Lat Pulldown, Incline DB Press, Cable Flies, Leg Press, Hanging Leg Raise, Ab Wheel, Lateral Raises
- date defaults to today if not specified
- Return ONLY JSON. No explanation. No markdown fences.`.trim();
  },
};
