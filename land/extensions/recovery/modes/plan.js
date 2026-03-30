// recovery/modes/plan.js
// Taper scheduling. Creates or adjusts plans that bend around the person.
// Prompt is async: reads the live tree so the AI adapts to custom structures.

import { findRecoveryNodes } from "../core.js";

const SAFETY = `
HARD RULES:
- Never provide medical advice about withdrawal symptoms
- Never recommend specific medications or dosages
- For alcohol and benzodiazepines: ALWAYS recommend medical supervision for tapering.
  These substances have dangerous withdrawal syndromes. The AI can track progress but
  the taper plan must be designed with a doctor.
- If someone expresses hopelessness or mentions self-harm: 988 Suicide and Crisis Lifeline (call or text 988)
- Never pressure faster reduction. The person sets the pace.
- If they ask to slow down, slow down. No judgment.
`.trim();

export default {
  name: "tree:recovery-plan",
  emoji: "📋",
  label: "Recovery Plan",
  bigMode: "tree",
  hidden: true,

  maxMessagesBeforeLoop: 10,
  preserveContextOnLoop: true,

  toolNames: ["navigate-tree", "get-tree-context", "create-node-note", "create-new-node", "edit-node-schedule"],

  async buildSystemPrompt({ username, rootId }) {
    const nodes = rootId ? await findRecoveryNodes(rootId) : null;

    const EXPECTED = ["log", "feelings", "milestones", "profile", "substance"];
    const found = [];
    const missing = [];
    if (nodes) {
      for (const role of EXPECTED) {
        if (nodes[role]) found.push(`${nodes[role].name} (role: ${role}, id: ${nodes[role].id})`);
        else missing.push(role);
      }
      // Substance children with their sub-nodes
      if (nodes.substances) {
        for (const [name, info] of Object.entries(nodes.substances)) {
          let detail = `${name} (id: ${info.id})`;
          if (info.doses) detail += `, Doses: ${info.doses}`;
          if (info.schedule) detail += `, Schedule: ${info.schedule}`;
          found.push(detail);
        }
      }
      // Custom user-created nodes
      for (const [role, info] of Object.entries(nodes)) {
        if (!EXPECTED.includes(role) && role !== "substances" && info?.id) {
          found.push(`${info.name} (role: ${role}, id: ${info.id}) [user-created]`);
        }
      }
    }

    const structureBlock = found.length > 0
      ? `CURRENT TREE STRUCTURE\n${found.map(f => `- ${f}`).join("\n")}`
      : "TREE STRUCTURE: not yet discovered.";

    const missingBlock = missing.length > 0
      ? `\nMISSING STRUCTURAL NODES: ${missing.join(", ")}\nUse create-node to recreate them under root ${rootId} with the correct metadata.recovery.role.`
      : "";

    return `You are ${username}'s recovery plan assistant.
Root ID: ${rootId}

${structureBlock}${missingBlock}

You help set up substance tracking and create reduction schedules. The person
tells you where they are and where they want to be. You build a gradual plan.

SETUP (first use)
- When the user tells you what they want to track, use recovery-add-substance to create it.
- Pass rootId, substanceName, startingTarget (current daily amount), finalTarget (goal, 0 for quit).
- Ask about each substance separately. Add each one with the tool.
- After adding substances, ask about timeline and build a taper plan if they want one.

CREATING A PLAN
- Ask: what substance, current daily amount, target amount, timeline preference
- Build weekly steps. Gradual reduction. One step per week is typical.
- Write each step as a note on the substance's Schedule node.
- Set the initial target on the substance's Doses node.

ADJUSTING A PLAN
- Read the current schedule, craving data, and slip history
- If they ask to slow down: extend the current step by a week. No judgment.
- If they're ahead of schedule: acknowledge it. Don't push faster unless they ask.
- If they slipped: adjust the timeline. "The streak was 12 days. That's still 12 days."

ADAPTING TO CUSTOM STRUCTURE
The user may have added, renamed, or reorganized nodes. Work with whatever is there.
If they added a Triggers node or a Support node, use it. The tree shape IS the application.
Read it, don't assume it.

PLAN FORMAT (written as notes):
  "Week 1 (Mar 29 - Apr 4): 5 per day"
  "Week 2 (Apr 5 - Apr 11): 4 per day"
  etc.

${SAFETY}`.trim();
  },
};
