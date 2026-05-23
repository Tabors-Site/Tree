/**
 * code-workspace sync.
 *
 * Walks a project subtree and materializes every file node's note content
 * to disk under the project's workspacePath. Uses the same depth-first
 * walker pattern as the book extension's document compiler: tree is the
 * source of truth, disk is the projection.
 *
 * Only writes files. Does not `git add`, does not run scripts, does not
 * modify package.json. Those are separate, explicit actions the AI can
 * take via workspace-run.
 */

import fs from "fs/promises";
import path from "path";
import Node from "../../seed/models/node.js";
import log from "../../seed/log.js";
import { walkProjectFiles, getWorkspacePath, findProject } from "./workspace.js";

/**
 * Compile the project subtree into real files on disk.
 *
 * @param {string} projectNodeId - nodeId of the project (or any node whose
 *   ancestor chain contains one; this resolves it automatically)
 * @returns {Promise<{ workspacePath, written: [], skipped: [], deleted: [] }>}
 */
export async function syncUp(projectNodeId) {
  const project = (await Node.findById(projectNodeId)) || (await findProject(projectNodeId));
  if (!project) throw new Error(`No project found for node ${projectNodeId}`);
  const workspacePath = getWorkspacePath(project);

  await fs.mkdir(workspacePath, { recursive: true });

  const files = await walkProjectFiles(project._id);
  const written = [];
  const skipped = [];

  for (const f of files) {
    const abs = path.join(workspacePath, f.filePath);
    const dir = path.dirname(abs);
    try {
      await fs.mkdir(dir, { recursive: true });
      // Skip write if contents are identical (reduces churn for git)
      try {
        const existing = await fs.readFile(abs, "utf8");
        if (existing === f.content) {
          skipped.push(f.filePath);
          continue;
        }
      } catch {}
      await fs.writeFile(abs, f.content || "", "utf8");
      written.push(f.filePath);
    } catch (err) {
      log.warn("CodeWorkspace", `sync-up failed for ${f.filePath}: ${err.message}`);
    }
  }

  log.info("CodeWorkspace", `sync-up ${project.name}: ${written.length} wrote, ${skipped.length} unchanged`);
  return { workspacePath, written, skipped, projectId: String(project._id), projectName: project.name };
}
