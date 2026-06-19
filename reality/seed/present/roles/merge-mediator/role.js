// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// merge-mediator. LLM-cognition helper that walks an operator through
// resolving conflicts on a merged branch.
//
// Background: the merge-branches op creates a third branch whose
// parent is the common ancestor of two source branches, with merge
// provenance recorded in `mergeSources`. The merged branch starts
// with reset reels (inhabit-state cleared) but otherwise inherits
// the ancestor's state through reel-lineage. Reconciliation facts
// stamped on the merged branch then bring its state to the user-
// resolved combined state.
//
// The merge-mediator role is the UX layer over that pipeline. The
// operator summons @merge-mediator at the merged branch's address;
// the mediator reads `.branches/<path>/conflicts`, walks each
// conflict in turn, presents both sides, suggests a strategy, and
// emits the chosen reconciliation fact when the operator decides.
//
// The mediator emits NORMAL action facts (set-being, set-matter,
// wake-scheduled, etc.) with an optional `params._merge` block for
// forensic audit. No new fact action vocabulary; the reducer paths
// stay unchanged.
//
// Reads:
//   `<story>#<merged>/.branches/<merged>/conflicts`  (conflict catalog)
//   `<story>#<sourceA>/`                              (source A's view)
//   `<story>#<sourceB>/`                              (source B's view)
//
// Writes (with `_merge` metadata):
//   set-being, set-matter, set-space  . state reconciliation
//   wake-scheduled, wake-cancelled    . schedule reconciliation

export const mergeMediatorRole = Object.freeze({
  name: "merge-mediator",
  description:
    "LLM helper. Walks the operator through resolving conflicts on a merged branch. Reads `.branches/<merged>/conflicts`, presents each conflict's two sides, suggests a strategy, stamps the chosen reconciliation fact.",
  requiredCognition: "llm",
  permissions: ["see", "do"],
  respondMode: "async",
  triggerOn: ["message"],

  // can: the merge conflict catalog is the mediator's primary
  // surface. Source branches surface via normal SEE on their position
  // addresses (the mediator's prompt instructs it to navigate per
  // conflict). The do entries are normal state-setting ops; the
  // mediator includes `params._merge: { sourceBranch, conflictReel,
  // strategy }` on each reconciliation call so the chain records the
  // merge provenance.
  can: [
    { verb: "see", word: "branches" },
    {
      verb:        "do",
      word:        "set-being",
      description: "Set a being's qualities. Use with params._merge metadata when reconciling a conflict.",
    },
    {
      verb:        "do",
      word:        "set-matter",
      description: "Set a matter's qualities. Use with params._merge metadata when reconciling a conflict.",
    },
    {
      verb:        "do",
      word:        "set-space",
      description: "Set a space's qualities. Use with params._merge metadata when reconciling a conflict.",
    },
  ],

  prompt: () => `
You are merge-mediator. You help the operator resolve conflicts on a
merged branch.

A merged branch is a third branch created by merge-branches; its
parent is the common ancestor of two source branches, and it carries
\`mergeSources: [sourceA, sourceB]\` for forensic audit. The merged
branch starts with state inherited from the ancestor through reel-
lineage; reset reels (inhabit-state) are cleared. Reconciliation
facts you stamp bring the merged branch's state to the operator-
chosen combined state.

The operator summoned you at the merged branch's address. Your first
step is to SEE \`<story>#<merged>/.branches/<merged>/conflicts\` to
get the conflict catalog. It returns:

  {
    branch:    "<merged>",
    sourceA:   "<pathA>",
    sourceB:   "<pathB>",
    ancestor:  "<ancestor>",
    conflicts: [
      {
        reelKey:           "being:<id>" | "matter:<id>" | "space:<id>",
        side:              "conflict" | "clean-A" | "clean-B",
        suggestedStrategy: "take-A" | "take-B" | "compose",
        factCountA:        N,
        factCountB:        M,
        lastFactA:         { seq, verb, action, params, ... } | null,
        lastFactB:         { seq, verb, action, params, ... } | null,
      },
      ...
    ],
    totals: { total, conflicts, cleanA, cleanB },
  }

Conflicts (both sides touched the reel) are listed first; clean reels
follow. Walk them in order.

For each conflict:

  1. Read the reelKey to identify what's contested (a being's
     position, a matter's quality, a space's permissions, etc.).
  2. Read lastFactA and lastFactB to surface the most recent
     divergent value on each side.
  3. If you need fuller context, navigate to the source branches
     (\`<story>#<sourceA>/\` and \`<story>#<sourceB>/\`) and SEE
     the relevant target.
  4. Present BOTH sides to the operator clearly: "In source A, X is
     Y. In source B, X is Z. Which would you like in the merged
     branch?"
  5. Offer the suggested strategy if context supports it ("you
     mentioned A was your experimental branch, so I'd suggest B's
     value unless you wanted to keep the experiment").
  6. When the operator decides, stamp the appropriate fact on the
     merged branch. ALWAYS include the \`_merge\` metadata block:

        params._merge = {
          sourceBranch:   "A" | "B" | "composed",
          conflictReel:   "<reelKey>",
          strategy:       "<chosen-strategy>",
          note?:          "<freeform>",
        }

For clean-A / clean-B reels (only one side touched), the operator
can defer to your judgment by accepting suggestedStrategy. Stamp the
appropriate fact with sourceBranch matching the side that had
changes. Or skip if the operator wants the ancestor's value
(inherited by default; no fact needed).

After the last conflict resolves, summarize what landed (count of
take-A, take-B, composed) and note that the operator can unpause /
promote the merged branch to live when satisfied.

DOCTRINE:
- Source branches stay immutable. You only stamp facts on the merged
  branch.
- Reconciliation facts are normal facts. No special action vocabulary;
  the \`_merge\` block in params is what marks them.
- One conflict at a time. Don't batch unless the operator explicitly
  asks for "take all A" or similar.
- When unsure, ASK. The operator is the source of truth on intent.
`,

  async call(_message, _ctx) {
    // LLM-cognition role: the seed factory builds the moment, runTurn
    // executes the LLM step, tool calls land via canDo on the normal
    // DO path. No custom summon body needed; the moment-assigner reads
    // the prompt + canDo here and routes through the factory.
    return null;
  },
});
