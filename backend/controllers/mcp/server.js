import { z } from "zod";

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { getTreeForAi, getNodeForAi } from '../treeDataFetching.js'; // import from your real backend

// Create and configure the MCP server
function getMcpServer() {
  
  const server = new McpServer({
    name: "tree-helper", version: "1.0.0", capabilities: {
      resources: {},
      tools: {},
      prompts: {},
    }
  });


  server.resource(
    "tree",
    new ResourceTemplate("tree://{rootId}", {
      async list() {
        return {
          resources: [
            { uri: "tree://91b8c878-3008-4a27-bd43-d93babf077b8", name: "Demo Tree" },
            { uri: "tree://example", name: "Example Tree" },
          ]
        };
      },
    }),
    {
      title: "Tree Resource",
      description: "Full hierarchical structure of nodes starting from a root.",
      mimeType: "application/json",
    },
    async (uri, { rootId }) => {
      const treeData = await getTreeForAi(rootId);
      if (!treeData) {
        return {
          contents: [{
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({ error: "Tree not found", rootId }),
          }]
        };
      }
      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(treeData, null, 2),
        }]
      };
    }
  );

  server.resource(
    "tree-node",
    new ResourceTemplate("tree://{rootId}/node/{nodeId}", {
      async list() {
        // Optional: You could list a few demo nodes for discovery
        return {
          resources: [
            { uri: "tree://91b8c878-3008-4a27-bd43-d93babf077b8/node/1234", name: "Demo Node 1234" },
          ],
        };
      },
    }),
    {
      title: "Tree Node Resource",
      description: "Fetch a specific node (with notes and versions) within a tree.",
      mimeType: "application/json",
    },
    async (uri, { rootId, nodeId }) => {
      try {
        const nodeData = await getNodeForAi(nodeId);
        if (!nodeData) {
          return {
            contents: [
              {
                uri: uri.href,
                mimeType: "application/json",
                text: JSON.stringify({ error: "Node not found", rootId, nodeId }),
              },
            ],
          };
        }

        // Return node data
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(
                {
                  rootId,
                  ...nodeData,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        console.error("Error fetching tree-node resource:", error);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify({ error: "Server error while fetching node", rootId, nodeId }),
            },
          ],
        };
      }
    }
  );



  /*
    server.tool(
      "ask-tree-question",
      "Ask a question about the user's tree",
      {
        question: { type: "string" },
        rootId: { type: "string" },
      },
      async (args) => {
        const { question, rootId } = args;
        const treeData = await getTreeForAi(rootId);
  
        if (!treeData) {
          return {
            content: [{ type: "text", text: "❌ Could not fetch tree data." }],
          };
        }
  
        return { content: [{ type: "text", text: JSON.stringify(treeData) }] };
      }
    ); */

  server.prompt(
    "root-workflow",
    "Main workflow for root perspective operations (Treefficiency MCP)",
    {
      user_request: z.string().describe("The user's natural language request"),
      //username: z.string(),
      // tokenId: z.string(),
      rootId: z.string(),
    },
    ({ user_request, /*username, tokenId, */rootId }) => ({
      resources: [
        `tree://${rootId}`,              // main root tree
      ],
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `You are the **Tree-Builder**, a workflow orchestrator that manages a user's hierarchical knowledge and project structure called a "Tree".

You work by reading and manipulating **resources** within the tree namespace.



---

### 🧠 Your Role
You will receive user input like:
> "Show me my progress on the climbing branch"  
> "What’s next on my focus plan?"



### 🌲 Input Context

- **Root ID:** ${rootId}

Now, handle this request:
`,
          },
        },
        {
          role: "user",
          content: {
            type: "text",
            text: `${user_request}`,
          },
        },
      ],
    })
  );

  server.prompt(
    "node-workflow",
    "Workflow for managing a specific node",
    {
      nodeId: z.string(),
      user_request: z.string(),
      rootId: z.string(),
    },
    ({ nodeId, user_request, rootId }) => ({
      messages: [
        {
          role: "system",
          content: {
            type: "text",
            text: `You are editing a single node in the tree (nodeId: ${nodeId}).

### Available Node Resources:
- Direct lineage → \`tree://\${rootId}/node/${nodeId}/directLineage\`
- Siblings → \`tree://\${rootId}/node/${nodeId}/siblings\`
- Notes → \`tree://\${rootId}/node/${nodeId}/notes\`
- Contributions → \`tree://\${rootId}/node/${nodeId}/contributions\`

### Available Tools:
- \`editValue(nodeId, key, value)\` — update numerical or text values
- \`addChat(nodeId, text)\` — add user reflections or comments
- \`editSchedule(nodeId, schedule)\` — adjust timing
- \`addPrestige(nodeId)\` — prestige this node for mastery
- \`editStatus(nodeId, status)\` — complete or reactivate nodes
- \`createBranch(nodeId, name)\` — generate new branches under this node

---

### Decision Logic
1. fetch data using \`tree://\${rootId}/node/${nodeId}\`
2. If user asks to update, add, or complete → call relevant edit or add tool.
3. If the request relates to ** creating new detail or sub- branch or futher planning **, use \`create-branch-chain\` with node context.
4. If the request feels unrelated to this node, escalate back to **root-workflow**.

---

Interpret the user’s intent and perform the correct operation or reasoning.`,
          },
        },
        {
          role: "user",
          content: {
            type: "text",
            text: `${user_request}`,
          },
        },
      ],
    })
  );



  return server;
}





// Main handler that Express can mount
async function handleMcpRequest(req, res) {
  try {
    const server = getMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    await server.connect(transport);


    res.on("close", () => {
      transport.close();
      server.close();
    });

    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("[MCP] Error:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603 },
        id: req.body.id || null,
      });
    }
  }
}

export { getMcpServer, handleMcpRequest };
