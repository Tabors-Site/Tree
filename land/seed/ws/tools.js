import log from "../log.js";
// ws/tools.js
// Complete tool catalog - modes reference these by name

const TOOL_DEFS = {
  // ── READ ──────────────────────────────────────────────────────────────
  "get-tree": {
    type: "function",
    function: {
      name: "get-tree",
      description:
        "Fetch a tree's structure. Use filters to show active/trimmed/completed nodes.",
      parameters: {
        type: "object",
        properties: {
          nodeId: {
            type: "string",
            description: "Root node ID to fetch tree from",
          },
          filters: {
            type: "object",
            properties: {
              active: { type: "boolean" },
              trimmed: { type: "boolean" },
              completed: { type: "boolean" },
            },
            description: "Status filters. Default shows active and completed.",
          },
        },
        required: ["nodeId"],
      },
    },
  },
  // ── READ ──────────────────────────────────────────────────────────────
  // ── READ ──────────────────────────────────────────────────────────────
  "get-active-leaf-execution-frontier": {
    type: "function",
    function: {
      name: "get-active-leaf-execution-frontier",
      description:
        "Get the next executable leaf node for BE mode. This function is authoritative and determines what step should be worked on next.",
      parameters: {
        type: "object",
        properties: {
          rootNodeId: {
            type: "string",
            description: "Root node ID of the active tree",
          },
        },
        required: ["rootNodeId"],
      },
    },
  },

  "get-node": {
    type: "function",
    function: {
      name: "get-node",
      description: "Fetch detailed information for a specific node.",
      parameters: {
        type: "object",
        properties: {
          nodeId: { type: "string", description: "The node ID to fetch" },
        },
        required: ["nodeId"],
      },
    },
  },

  "get-node-notes": {
    type: "function",
    function: {
      name: "get-node-notes",
      description: "Get notes for a node at a specific prestige version.",
      parameters: {
        type: "object",
        properties: {
          nodeId: { type: "string" },
          prestige: {
            type: "number",
            description: "Version number (0 = first)",
          },
          limit: { type: "number", description: "Max notes to return" },
          startDate: { type: "string", description: "ISO date filter start" },
          endDate: { type: "string", description: "ISO date filter end" },
        },
        required: ["nodeId"],
      },
    },
  },

  "get-node-contributions": {
    type: "function",
    function: {
      name: "get-node-contributions",
      description: "Get contribution history for a node version.",
      parameters: {
        type: "object",
        properties: {
          nodeId: { type: "string" },
          version: { type: "number" },
          limit: { type: "number" },
          startDate: { type: "string" },
          endDate: { type: "string" },
        },
        required: ["nodeId", "version"],
      },
    },
  },

  "get-unsearched-notes-by-user": {
    type: "function",
    function: {
      name: "get-unsearched-notes-by-user",
      description: "Get recent notes by the user (limit 20 max).",
      parameters: {
        type: "object",
        properties: {
          userId: { type: "string" },
          limit: { type: "number" },
          startDate: { type: "string" },
          endDate: { type: "string" },
        },
        required: ["userId"],
      },
    },
  },

  "get-searched-notes-by-user": {
    type: "function",
    function: {
      name: "get-searched-notes-by-user",
      description: "Search user's notes by text content.",
      parameters: {
        type: "object",
        properties: {
          userId: { type: "string" },
          query: { type: "string", description: "Search query" },
          limit: { type: "number" },
          startDate: { type: "string" },
          endDate: { type: "string" },
        },
        required: ["userId", "query"],
      },
    },
  },

  "get-all-tags-for-user": {
    type: "function",
    function: {
      name: "get-all-tags-for-user",
      description: "Get notes where user was tagged (mail).",
      parameters: {
        type: "object",
        properties: {
          userId: { type: "string" },
          limit: { type: "number" },
          startDate: { type: "string" },
          endDate: { type: "string" },
        },
        required: ["userId"],
      },
    },
  },

  "get-contributions-by-user": {
    type: "function",
    function: {
      name: "get-contributions-by-user",
      description: "Get user's contribution history.",
      parameters: {
        type: "object",
        properties: {
          userId: { type: "string" },
          limit: { type: "number" },
          startDate: { type: "string" },
          endDate: { type: "string" },
        },
        required: ["userId"],
      },
    },
  },

  "get-raw-ideas-by-user": {
    type: "function",
    function: {
      name: "get-raw-ideas-by-user",
      description: "Get user's raw ideas inbox.",
      parameters: {
        type: "object",
        properties: {
          userId: { type: "string" },
          limit: { type: "number" },
          startDate: { type: "string" },
          endDate: { type: "string" },
        },
        required: ["userId"],
      },
    },
  },

  "get-root-nodes": {
    type: "function",
    function: {
      name: "get-root-nodes",
      description: "Get all root trees owned by user.",
      parameters: {
        type: "object",
        properties: {
          userId: { type: "string" },
        },
        required: ["userId"],
      },
    },
  },

  // ── WRITE ─────────────────────────────────────────────────────────────
  "edit-node-version-value": {
    type: "function",
    function: {
      name: "edit-node-version-value",
      description: "Set or update a numeric value on a node version.",
      parameters: {
        type: "object",
        properties: {
          nodeId: { type: "string" },
          key: { type: "string", description: "Value key name" },
          value: { type: "number", description: "Numeric value" },
          prestige: { type: "number", description: "Version index" },
          userId: { type: "string" },
        },
        required: ["nodeId", "key", "value", "userId"],
      },
    },
  },

  "edit-node-version-goal": {
    type: "function",
    function: {
      name: "edit-node-version-goal",
      description: "Set a goal for an existing value key.",
      parameters: {
        type: "object",
        properties: {
          nodeId: { type: "string" },
          key: { type: "string", description: "Must match existing value key" },
          goal: { type: "number" },
          prestige: { type: "number" },
          userId: { type: "string" },
        },
        required: ["nodeId", "key", "goal", "userId"],
      },
    },
  },

  "edit-node-or-branch-status": {
    type: "function",
    function: {
      name: "edit-node-or-branch-status",
      description:
        "Change node status. Use isInherited=true to apply to children.",
      parameters: {
        type: "object",
        properties: {
          nodeId: { type: "string" },
          status: { type: "string", enum: ["active", "trimmed", "completed"] },
          prestige: { type: "number" },
          isInherited: {
            type: "boolean",
            description: "Apply to children recursively",
          },
          userId: { type: "string" },
        },
        required: ["nodeId", "status", "isInherited", "userId"],
      },
    },
  },

  "edit-node-version-schedule": {
    type: "function",
    function: {
      name: "edit-node-version-schedule",
      description: "Update schedule and reeffect time.",
      parameters: {
        type: "object",
        properties: {
          nodeId: { type: "string" },
          prestige: { type: "number" },
          newSchedule: { type: "string", description: "ISO 8601 date/time" },
          reeffectTime: {
            type: "number",
            description: "Hours until reschedule on prestige",
          },
          userId: { type: "string" },
        },
        required: [
          "nodeId",
          "newSchedule",
          "reeffectTime",
          "userId",
        ],
      },
    },
  },

  "add-node-prestige": {
    type: "function",
    function: {
      name: "add-node-prestige",
      description: "Increment prestige, creating a new version.",
      parameters: {
        type: "object",
        properties: {
          nodeId: { type: "string" },
          userId: { type: "string" },
        },
        required: ["nodeId", "userId"],
      },
    },
  },

  "create-node-version-note": {
    type: "function",
    function: {
      name: "create-node-version-note",
      description: "Create a text note on a node. Confirm exact wording first.",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "Note text content" },
          nodeId: { type: "string" },
          prestige: { type: "number" },
          userId: { type: "string" },
        },
        required: ["content", "nodeId", "userId"],
      },
    },
  },
  "edit-node-note" : {
  type: "function",
  function: {
    name: "edit-node-note",
    description:
      "Edit an existing text note. By default replaces all content. Optionally specify a line range to replace or insert at specific lines.",
    parameters: {
      type: "object",
      properties: {
        noteId: {
          type: "string",
          description: "The ID of the note to edit.",
        },
        content: {
          type: "string",
          description:
            "New content. Replaces entire note, or replaces the specified line range.",
        },
        lineStart: {
          type: "number",
          description:
            "Start line (0-indexed). If provided with lineEnd, replaces lines [start, end). If provided alone, inserts at that line.",
        },
        lineEnd: {
          type: "number",
          description:
            "End line (0-indexed, exclusive). Lines from lineStart to lineEnd are replaced with the new content.",
        },
        nodeId: { type: "string" },
          prestige: { type: "number" },
      },
      required: ["noteId", "content", "nodeId"],
    },
  },
},

  "transfer-node-note": {
    type: "function",
    function: {
      name: "transfer-node-note",
      description: "Transfer a note from its current node to a different node in the same tree.",
      parameters: {
        type: "object",
        properties: {
          noteId: { type: "string", description: "The ID of the note to transfer" },
          targetNodeId: { type: "string", description: "The destination node ID" },
          prestige: { type: "number", description: "Target version (defaults to latest)" },
        },
        required: ["noteId", "targetNodeId"],
      },
    },
  },

  "delete-node-note": {
    type: "function",
    function: {
      name: "delete-node-note",
      description: "Delete a note by ID.",
      parameters: {
        type: "object",
        properties: {
          noteId: { type: "string" },
           nodeId: { type: "string" },
          prestige: { type: "number" },
        },
        required: ["noteId", "nodeId"],
      },
    },
  },

  "create-new-node": {
    type: "function",
    function: {
      name: "create-new-node",
      description: "Create a single new node.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          parentNodeID: { type: "string" },
          userId: { type: "string" },
          schedule: { type: "string", description: "Optional ISO date" },
          reeffectTime: { type: "number" },
          values: {
            type: "object",
            description: "Key-value pairs for numbers",
          },
          goals: { type: "object", description: "Key-value pairs for goals" },
          note: { type: "string", description: "Optional initial note" },
          type: {
            type: "string",
            description:
              "Optional semantic type. Core types: goal, plan, task, knowledge, resource, identity. Custom types valid.",
          },
        },
        required: ["name", "parentNodeID", "userId"],
      },
    },
  },

  "create-tree": {
    type: "function",
    function: {
      name: "create-tree",
      description: "Create a new tree by creating a root node.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Name of the new tree (root node).",
          },
          note: {
            type: "string",
            description: "Optional initial note for the root node.",
          },
          type: {
            type: "string",
            description:
              "Optional semantic type. Core types: goal, plan, task, knowledge, resource, identity.",
          },
          userId: {
            type: "string",
            description: "Injected by server. Ignore.",
          },
        },
        required: ["name", "userId"],
      },
    },
  },

  "create-new-node-branch": {
    type: "function",
    function: {
      name: "create-new-node-branch",
      description: "Create a recursive tree structure.",
      parameters: {
        type: "object",
        properties: {
          nodeData: {
            type: "object",
            description: "Node with optional children array",
            properties: {
              name: { type: "string" },
              schedule: { type: "string" },
              reeffectTime: { type: "number" },
              values: { type: "object" },
              goals: { type: "object" },
              note: { type: "string" },
              type: {
                type: "string",
                description:
                  "Optional semantic type. Core types: goal, plan, task, knowledge, resource, identity.",
              },
              children: { type: "array" },
            },
            required: ["name"],
          },
          parentId: { type: "string" },
          userId: { type: "string" },
        },
        required: ["nodeData", "parentId", "userId"],
      },
    },
  },
  "delete-node-branch": {
    type: "function",
    function: {
      name: "delete-node-branch",
      description:
        "Retire (delete) a node branch and detach it from its parent.",
      parameters: {
        type: "object",
        properties: {
          nodeId: {
            type: "string",
            description: "ID of the node branch to be retired.",
          },
          userId: {
            type: "string",
            description: "User performing the delete action.",
          },
        },
        required: ["nodeId", "userId"],
      },
    },
  },
  "navigate-tree": {
    type: "function",
    function: {
      name: "navigate-tree",
      description:
        "Return minimal structural context for navigating a tree (current node, parent, children, siblings, root).",
      parameters: {
        type: "object",
        properties: {
          nodeId: {
            type: "string",
            description: "The current node ID to navigate from.",
          },
         
          search: {
            type: "string",
            description: "Search node names across the tree. Returns up to 10 matches with paths",
          },
          
        },
        required: ["nodeId"],
      },
    },
  },
 "get-tree-context" : {
  type: "function",
  function: {
    name: "get-tree-context",
    description:
      "Reads node data with configurable scope. Returns current version, notes, and optionally siblings, parent chain, scripts.",
    parameters: {
      type: "object",
      properties: {
        nodeId: {
          type: "string",
          description: "Node ID to read.",
        },
        includeNotes: {
          type: "boolean",
          description: "Include notes for current version. Default true.",
        },
        includeSiblings: {
          type: "boolean",
          description: "Include sibling node names. Default false.",
        },
        includeParentChain: {
          type: "boolean",
          description: "Include full path from root. Default false.",
        },
        includeChildren: {
          type: "boolean",
          description: "Include children names. Default true.",
        },
        includeValues: {
          type: "boolean",
          description: "Include version values and goals. Default true.",
        },
        includeScripts: {
          type: "boolean",
          description: "Include script names. Default false.",
        },
      },
      required: ["nodeId"],
    },
  },
},

  "edit-node-name": {
    type: "function",
    function: {
      name: "edit-node-name",
      description: "Rename a node.",
      parameters: {
        type: "object",
        properties: {
          nodeId: { type: "string" },
          newName: { type: "string" },
          userId: { type: "string" },
        },
        required: ["nodeId", "newName", "userId"],
      },
    },
  },

  "edit-node-type": {
    type: "function",
    function: {
      name: "edit-node-type",
      description:
        "Set or clear a node's semantic type. Core types: goal, plan, task, knowledge, resource, identity. Custom types valid. Use null to clear.",
      parameters: {
        type: "object",
        properties: {
          nodeId: { type: "string" },
          newType: {
            type: ["string", "null"],
            description: "Type label or null to clear.",
          },
          userId: { type: "string" },
        },
        required: ["nodeId", "newType", "userId"],
      },
    },
  },

  "update-node-branch-parent-relationship": {
    type: "function",
    function: {
      name: "update-node-branch-parent-relationship",
      description: "Move a node to a new parent.",
      parameters: {
        type: "object",
        properties: {
          nodeChildId: { type: "string" },
          nodeNewParentId: { type: "string" },
          userId: { type: "string" },
        },
        required: ["nodeChildId", "nodeNewParentId", "userId"],
      },
    },
  },

  "transfer-raw-idea-to-note": {
    type: "function",
    function: {
      name: "transfer-raw-idea-to-note",
      description: "Convert a raw idea to a note on a node.",
      parameters: {
        type: "object",
        properties: {
          rawIdeaId: { type: "string" },
          nodeId: { type: "string" },
          userId: { type: "string" },
        },
        required: ["rawIdeaId", "nodeId", "userId"],
      },
    },
  },

  // ── UNDERSTANDING ─────────────────────────────────────────────────────
  // ── UNDERSTANDING ─────────────────────────────────────────────────────
  "understanding-list": {
    type: "function",
    function: {
      name: "understanding-list",
      description:
        "List existing understanding runs (perspectives) for a tree root.",
      parameters: {
        type: "object",
        properties: {
          rootNodeId: {
            type: "string",
            description: "Root node ID to list understandings for.",
          },
        },
        required: ["rootNodeId"],
      },
    },
  },

  "understanding-create": {
    type: "function",
    function: {
      name: "understanding-create",
      description: "Create an understanding run for a tree.",
      parameters: {
        type: "object",
        properties: {
          rootNodeId: { type: "string" },
          perspective: {
            type: "string",
            description: "Perspective/focus for understanding",
          },
        },
        required: ["rootNodeId"],
      },
    },
  },

  "understanding-process": {
    type: "function",
    function: {
      name: "understanding-process",
      description:
        "Commits previous summary (if any) and returns next summarization task. Loop until done.",
      parameters: {
        type: "object",
        properties: {
          understandingRunId: { type: "string" },
          rootNodeId: { type: "string" },
          previousResult: {
            type: "object",
            description:
              "Omit on first call. Include your summary from previous task on subsequent calls.",
            properties: {
              mode: { type: "string", enum: ["leaf", "merge"] },
              encoding: { type: "string", description: "Your summary text" },
              understandingNodeId: {
                type: "string",
                description: "From target.understandingNodeId",
              },
              currentLayer: {
                type: "number",
                description: "Required for merge mode — from target.nextLayer",
              },
            },
            required: ["mode", "encoding"],
          },
        },
        required: ["understandingRunId", "rootNodeId"],
      },
    },
  },
};

/**
 * Given an array of tool name strings, return the OpenAI tool definition array.
 */
// Extension tools registered via loader (MCP tools from extensions)
const extensionToolDefs = {};

/**
 * Register an extension tool definition so resolveTools can find it.
 * Called by the extension loader when wiring MCP tools.
 */
export function registerToolDef(name, schema) {
  extensionToolDefs[name] = schema;
}

const _warnedTools = new Set();
export function resolveTools(toolNames) {
  return toolNames.map((name) => {
    const def = TOOL_DEFS[name] || extensionToolDefs[name];
    if (!def) {
      if (!_warnedTools.has(name)) {
        _warnedTools.add(name);
        log.warn("Tools", `Unknown tool: ${name} (skipped)`);
      }
      return null;
    }
    return def;
  }).filter(Boolean);
}

export default TOOL_DEFS;
