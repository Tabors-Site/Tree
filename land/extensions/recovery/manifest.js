export default {
  name: "recovery",
  version: "1.0.2",
  builtFor: "TreeOS",
  description:
    "The tree that grows toward health. Track substances, feelings, cravings, " +
    "and patterns. Taper schedules that bend around you. Pattern detection that " +
    "finds what you can't see. A mirror, not a judge. Three modes: recovery-log " +
    "for daily check-ins, recovery-reflect for pattern analysis, recovery-plan " +
    "for taper scheduling. Milestone detection. Journal node for unstructured " +
    "writing the AI doesn't analyze. Safety boundaries for dangerous withdrawals " +
    "and crisis situations. Type 'be' at the Recovery tree to check in: the AI asks " +
    "how you're doing today. The person is always the agent.",

  territory: "rest, healing, soreness, sleep, substances, sobriety",

  // Territory vocabulary split by part of speech.
  //
  // Philosophy: recovery has deep collision risk with food ("drink", "drank",
  // "smoke") and with fitness ("quit", "sore", "recovery"). The strongest
  // signals are substance-specific nouns (alcohol, nicotine, benzos) and
  // recovery-specific nouns (sobriety, craving, relapse, withdrawal).
  //
  // Generic verbs like "drank" or "smoked" are only matched with recovery
  // context suffixes ("drank again", "drank too much", "smoked last night")
  // so "drank a smoothie" and "smoked salmon" don't hijack to recovery.
  //
  // Soft adjectives like "sober" / "clean" are kept because they're
  // ambiguous in isolation ("clean desk") but unambiguous at the recovery
  // tree (locality bonus dominates).
  vocabulary: {
    verbs: [
      // Recovery-specific action words
      /\b(craving|cravings?|craved|urged|tempted|relapsed|relapsing)\b/i,
      /\b(slipped|slip[- ]up|slipped\s+up)\b/i,
      // Quit/stop phrases (context required — bare "quit" is too generic)
      /\b(quit|quitting|stopped|stopping|giving\s+up)\s+(?:drinking|smoking|using|vaping|drugs|the\s+(?:bottle|habit|cigarettes))\b/i,
      // Tapering and withdrawal
      /\b(tapered|tapering|weaned|weaning|withdrawing|withdrew|detoxed|detoxing)\b/i,
      // Abstinence
      /\b(abstained|abstaining|stayed\s+(?:clean|sober)|remained\s+(?:clean|sober)|kept\s+(?:clean|sober))\b/i,
      /\bcut\s+(?:down|back)\s+on\s+(?:drinking|smoking|using|alcohol|tobacco|weed|cigarettes)/i,
      // Past substance use with recovery context (avoid food collision)
      /\b(used\s+(?:again|last\s+night|today))\b/i,
      /\b(drank\s+(?:again|last\s+night|too\s+much|heavily|alone))\b/i,
      /\b(smoked\s+(?:again|last\s+night|too\s+much|alone))\b/i,
    ],
    nouns: [
      // Core recovery domain nouns (strong signals)
      /\b(recovery|sobriety|abstinence|addiction|withdrawal|withdrawals)\b/i,
      /\b(craving|cravings|urge|urges|temptation|temptations|trigger|triggers)\b/i,
      /\b(relapse|relapses|slip[- ]?ups?|slipup)\b/i,
      // Tapering and treatment nouns
      /\b(taper|taper\s+(?:plan|schedule)|detox|rehab|aa\s+meeting|na\s+meeting|twelve[- ]step|12[- ]step)\b/i,
      // Progress tracking
      /\b(days\s+(?:clean|sober)|sober\s+streak|clean\s+streak|sobriety\s+milestone|sober\s+(?:for|since)|clean\s+(?:for|since))\b/i,
      /\bmilestone|milestones\b/i,
      // Named substances (strongest cross-domain discriminator)
      /\b(alcohol|tobacco|nicotine|cigarettes?|weed|marijuana|cannabis|opioids?|benzos?|amphetamines?|stimulants?|ketamine|cocaine|heroin|meth)\b/i,
      // Substance category nouns
      /\b(substance|substances|addictive|dependency|dependencies|habit|habits)\b/i,
    ],
    adjectives: [
      // Sobriety states (ambiguous alone, strong at recovery tree)
      /\b(sober|drunk|buzzed|intoxicated|hungover|hung[- ]over|wasted|wasted\s+last)\b/i,
      /\bclean\s+(?:today|this\s+week|this\s+month|for\s+\d+\s+days)\b/i,
      // Struggle states (context required)
      /\b(struggling|tempted|vulnerable|overwhelmed)\s+(?:with\s+(?:cravings|sobriety|drinking|using|the\s+urge|quitting))\b/i,
      // Program states
      /\b(in\s+recovery|on\s+the\s+wagon|off\s+the\s+wagon|clean\s+and\s+sober)\b/i,
    ],
  },

  needs: {
    models: ["Node", "Note"],
    services: ["hooks", "llm", "metadata"],
  },

  optional: {
    extensions: [
      "values",
      "channels",
      "fitness",
      "food",
      "scheduler",
      "breath",
      "notifications",
      "html-rendering",  // dashboard page
      "treeos-base",     // slot registration
    ],
  },

  provides: {
    models: {},
    routes: "./routes.js",
    tools: true,
    jobs: true,
    modes: true,
    guidedMode: "tree:recovery-review",

    hooks: {
      fires: ["recovery:milestone", "recovery:patternDetected"],
      listens: ["enrichContext", "breath:exhale"],
    },

    cli: [
      {
        command: "recovery [message...]",
        scope: ["tree"],
        description: "Check in or log how you're doing.",
        method: "POST",
        endpoint: "/root/:rootId/recovery",
        body: ["message"],
      },
      {
        command: "recovery-check",
        scope: ["tree"],
        description: "Today's status.",
        method: "GET",
        endpoint: "/root/:rootId/recovery/check",
      },
      {
        command: "recovery-patterns",
        scope: ["tree"],
        description: "Detected patterns.",
        method: "GET",
        endpoint: "/root/:rootId/recovery/patterns",
      },
      {
        command: "recovery-milestones",
        scope: ["tree"],
        description: "Your milestones.",
        method: "GET",
        endpoint: "/root/:rootId/recovery/milestones",
      },
      {
        command: "recovery-taper",
        scope: ["tree"],
        description: "Show taper plan.",
        method: "GET",
        endpoint: "/root/:rootId/recovery/taper",
      },
    ],
  },
};
