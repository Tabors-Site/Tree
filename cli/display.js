const chalk = require("chalk");

function printNode(node, indent = 0, isLast = true) {
  const prefix =
    indent === 0 ? "" : "  ".repeat(indent - 1) + (isLast ? "└─ " : "├─ ");
  const status = node.status || "active";
  const statusColor =
    {
      active: chalk.green,
      completed: chalk.gray,
      trimmed: chalk.dim,
    }[status] || chalk.white;

  const nodeId = node._id || node.id || "";
  const name = statusColor(node.name || "unnamed");
  const id = chalk.dim(`(${nodeId})`);
  console.log(prefix + name + "  " + id);

  const d = node.data || node;
  const children = d.children || node.children || [];
  children.forEach((child, i) => {
    printNode(child, indent + 1, i === children.length - 1);
  });
}

function printTable(rows, cols) {
  // rows: array of objects; cols: array of { key, label, width }
  const header = cols.map((c) => c.label.padEnd(c.width)).join("  ");
  console.log(chalk.bold(header));
  console.log(chalk.dim("─".repeat(header.length)));
  rows.forEach((row) => {
    const line = cols
      .map((c) => {
        const val = String(row[c.key] ?? "");
        return val.length > c.width
          ? val.slice(0, c.width - 1) + "…"
          : val.padEnd(c.width);
      })
      .join("  ");
    console.log(line);
  });
}

function printNotes(notes) {
  if (!notes.length) {
    console.log(chalk.dim("  (no notes)"));
    return;
  }
  notes.forEach((n, i) => {
    const ts = n.createdAt
      ? chalk.dim(new Date(n.createdAt).toLocaleString())
      : "";
    console.log(`  ${chalk.cyan(i + 1 + ".")} ${chalk.dim(n._id)}  ${ts}`);
    if (n.content) console.log(`     ${n.content.slice(0, 120)}`);
  });
}

function printContributions(contributions) {
  if (!contributions.length) {
    console.log(chalk.dim("  (no contributions)"));
    return;
  }
  contributions.forEach((c, i) => {
    const ts = c.createdAt
      ? chalk.dim(new Date(c.createdAt).toLocaleString())
      : "";
    const action = c.action ? chalk.yellow(c.action) : "";
    const type = c.type ? chalk.cyan(c.type) : "";
    const label = [type, action].filter(Boolean).join(" ");
    console.log(`  ${chalk.cyan(i + 1 + ".")} ${label}  ${ts}`);
    if (c.summary) console.log(`     ${c.summary.slice(0, 120)}`);
    if (c.nodeName) console.log(`     ${chalk.dim("node:")} ${c.nodeName}`);
  });
}

function printChats(sessions) {
  if (!sessions.length) {
    console.log(chalk.dim("  (no chat sessions)"));
    return;
  }
  sessions.forEach((s, i) => {
    const chats = s.chats || [];
    const ts = s.startTime
      ? chalk.dim(new Date(s.startTime).toLocaleString())
      : "";

    // Find the user input (chainIndex 0, source "api")
    const root = chats.find((c) => c.chainIndex === 0) || chats[0];
    const input = root?.startMessage?.content || "";

    // Find the final response (last chat with a non-JSON endMessage)
    let output = "";
    for (let j = chats.length - 1; j >= 0; j--) {
      const msg = chats[j].endMessage?.content || "";
      if (msg && !msg.startsWith("{")) {
        output = msg;
        break;
      }
    }

    // Get tree context
    const treeName = root?.treeContext?.targetNodeId?.name || "";

    // Header
    console.log(
      `  ${chalk.cyan(i + 1 + ".")} ${ts}` +
        (treeName ? `  ${chalk.dim("on")} ${chalk.cyan(treeName)}` : "") +
        `  ${chalk.dim(`(${chats.length} steps)`)}`,
    );

    // Input
    console.log(`     ${chalk.bold("›")} ${input}`);

    // Steps (middle chain, skip first and last)
    const steps = chats.filter(
      (c) => c.chainIndex > 0 && c.aiContext?.path,
    );
    steps.forEach((step) => {
      const path = step.aiContext.path;
      const node = step.treeContext?.targetNodeId?.name || "";
      const label = node ? `${path} → ${node}` : path;
      console.log(`     ${chalk.dim("  ↳ " + label)}`);
    });

    // Output
    if (output) {
      console.log(`     ${chalk.green("‹")} ${output.slice(0, 200)}`);
    }

    // Contributions
    const contribs = chats.flatMap((c) => c.contributions || []);
    if (contribs.length) {
      contribs.forEach((c) => {
        const nodeName = c.nodeId?.name || c.nodeId?._id || "";
        console.log(
          `     ${chalk.yellow("★")} ${c.action}${nodeName ? " → " + nodeName : ""}`,
        );
      });
    }

    // Tool calls — the AI's step-by-step tool loop stored per chat.
    // Flattens across all chats in the session (chainIndex 0 + any
    // orchestrator sub-steps). Renders terse arrow lines similar to
    // the live server log but scannable after the fact.
    const allToolCalls = chats.flatMap((c) => c.toolCalls || []);
    if (allToolCalls.length) {
      for (const tc of allToolCalls) {
        const okMark = tc.success === false
          ? chalk.red("✗")
          : chalk.dim("→");
        const toolName = tc.success === false
          ? chalk.red(tc.tool)
          : chalk.cyan(tc.tool);
        const argHint = formatToolArgs(tc.args);
        const ms = tc.ms ? chalk.dim(` (${tc.ms}ms)`) : "";
        const errPart = tc.success === false && tc.error
          ? chalk.red(" — " + String(tc.error).slice(0, 60))
          : "";
        console.log(`     ${okMark} ${toolName}${argHint}${ms}${errPart}`);
      }
    }

    console.log("");
  });
}

// Format a short one-line arg hint for display. Pulls the most
// identifying field (filePath, path, name, query) or falls back to
// a compact key list.
function formatToolArgs(args) {
  if (!args || typeof args !== "object") return "";
  if (args._truncated) return chalk.dim(" (truncated)");
  for (const key of ["filePath", "path", "subdir", "name", "query", "command", "binary"]) {
    if (args[key] != null && typeof args[key] !== "object") {
      const v = String(args[key]);
      const short = v.length > 50 ? v.slice(0, 47) + "..." : v;
      return " " + chalk.dim(short);
    }
  }
  const keys = Object.keys(args).filter(
    (k) => !["userId", "rootId", "nodeId", "chatId", "sessionId"].includes(k),
  );
  if (!keys.length) return "";
  return " " + chalk.dim("(" + keys.slice(0, 3).join(",") + ")");
}

function printBook(node, indent = 0) {
  const pad = "  ".repeat(indent);
  const name = node.nodeName || node.name || "unnamed";
  console.log(pad + chalk.bold.cyan(name));

  const notes = node.notes || [];
  if (notes.length) {
    notes.forEach((n) => {
      if (n.content) console.log(pad + "  " + n.content);
    });
  }

  const children = node.children || [];
  if (children.length) {
    if (notes.length) console.log(""); // spacing between notes and children
    children.forEach((child) => {
      printBook(child, indent + 1);
    });
  } else if (notes.length) {
    console.log(""); // spacing after leaf node notes
  }
}

module.exports = { printNode, printTable, printNotes, printContributions, printChats, printBook };
