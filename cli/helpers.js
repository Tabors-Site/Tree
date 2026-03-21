const chalk = require("chalk");

/** Extract children array from a getNode API response */
function getChildren(data) {
  const node = data.node || data;
  return node.children || [];
}

// Flatten a full tree into [{node, pathStack}] entries for tree-wide search
function flattenTree(node, pathStack = []) {
  const results = [];
  const entry = { node, pathStack: [...pathStack, { id: node._id, name: node.name }] };
  results.push(entry);
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      if (child && typeof child === "object" && child._id) {
        results.push(...flattenTree(child, entry.pathStack));
      }
    }
  }
  return results;
}

function findChild(children, query) {
  const q = query.toLowerCase();

  // Exact ID match
  const byId = children.find((c) => c._id === query);
  if (byId) return byId;

  // ID prefix match
  const byIdPrefix = children.filter((c) => c._id.startsWith(query));
  if (byIdPrefix.length === 1) return byIdPrefix[0];

  // Exact name match (case-insensitive)
  const byName = children.filter((c) => c.name && c.name.toLowerCase() === q);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) {
    console.error(
      chalk.yellow(`Multiple matches for "${query}". Use an ID to disambiguate (tip: rename one with: rename <name> <newname>):`),
    );
    byName.forEach((c) =>
      console.log(`  ${chalk.cyan(c.name)}  ${chalk.dim(c._id)}`),
    );
    return null;
  }

  // Partial name match — name starts with query
  const byStart = children.filter((c) => c.name && c.name.toLowerCase().startsWith(q));
  if (byStart.length === 1) return byStart[0];
  if (byStart.length > 1) {
    console.error(
      chalk.yellow(`Multiple matches for "${query}". Use an ID to disambiguate (tip: rename one with: rename <name> <newname>):`),
    );
    byStart.forEach((c) =>
      console.log(`  ${chalk.cyan(c.name)}  ${chalk.dim(c._id)}`),
    );
    return null;
  }

  // Substring match — query appears anywhere in name
  const bySub = children.filter((c) => c.name && c.name.toLowerCase().includes(q));
  if (bySub.length === 1) return bySub[0];
  if (bySub.length > 1) {
    console.error(
      chalk.yellow(`Multiple matches for "${query}". Use an ID to disambiguate (tip: rename one with: rename <name> <newname>):`),
    );
    bySub.forEach((c) =>
      console.log(`  ${chalk.cyan(c.name)}  ${chalk.dim(c._id)}`),
    );
    return null;
  }

  // Nothing found
  console.error(chalk.red(`No child matching "${query}"`));
  const list = children.map((c) => `  ${chalk.cyan(c.name)}  ${chalk.dim(c._id)}`).join("\n");
  if (list) console.log("Children:\n" + list);
  return null;
}

/**
 * Parse friendly date strings into ISO 8601.
 * Accepts: "01/22/2025 5:45pm", "01/22/2025 17:45", "2025-01-22T17:45:00Z", etc.
 */
function parseDate(input) {
  // Already ISO 8601
  if (/^\d{4}-\d{2}-\d{2}T/.test(input)) return input;

  // MM/DD/YYYY with optional time → defaults to midnight
  const mDate = input.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(am|pm)?)?$/i,
  );
  if (mDate) {
    const [, month, day, year, rawHour, min, ampm] = mDate;
    let hour = rawHour ? parseInt(rawHour, 10) : 0;
    const minute = min ? parseInt(min, 10) : 0;
    if (ampm) {
      const ap = ampm.toLowerCase();
      if (ap === "pm" && hour < 12) hour += 12;
      if (ap === "am" && hour === 12) hour = 0;
    }
    const d = new Date(
      parseInt(year, 10),
      parseInt(month, 10) - 1,
      parseInt(day, 10),
      hour,
      minute,
    );
    return d.toISOString();
  }

  // Time only (e.g. "5:45pm", "17:45") → defaults to today
  const mTime = input.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
  if (mTime) {
    const [, rawHour, min, ampm] = mTime;
    let hour = parseInt(rawHour, 10);
    const minute = parseInt(min, 10);
    if (ampm) {
      const ap = ampm.toLowerCase();
      if (ap === "pm" && hour < 12) hour += 12;
      if (ap === "am" && hour === 12) hour = 0;
    }
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute);
    return d.toISOString();
  }

  // Fallback — let JS try to parse it
  const d = new Date(input);
  if (isNaN(d.getTime())) throw new Error(`Cannot parse date: "${input}"`);
  return d.toISOString();
}

// Helper to print a clickable OSC 8 hyperlink in the terminal
function termLink(url, label) {
  return `\u001B]8;;${url}\u001B\\${label}\u001B]8;;\u001B\\`;
}

module.exports = { getChildren, flattenTree, findChild, parseDate, termLink };
