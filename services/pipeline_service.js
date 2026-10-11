/**
 * Custom modules
 */
import { syncRepo, detectChangedFiles } from "./git_service.js";
import { getChangedComponents } from "../utils/pathMatcher.js";
import { updateRun } from "../store/runs.js";

/**
 * One queue per project. Two quick pushes to the same project would
 * otherwise run git commands in the same folder at the same time.
 */
const queues = new Map();

const enqueue = (key, task) => {
  const previous = queues.get(key) || Promise.resolve();
  const next = previous.then(task);
  queues.set(key, next.catch(() => {}));
  return next;
};

/**
 * Runs the pipeline for one push. Never throws: failures are saved on the run.
 * Step 3: sync code → detect changed components.
 * (Deploying them comes in the next steps.)
 * @param {Object} project - Project config
 * @param {Object} push - { commitSha, before, commits, cloneUrl }
 */
export const runPipeline = (project, push) =>
  enqueue(project.name, async () => {
    const { commitSha, before, commits, cloneUrl } = push;
    const label = `${project.name}@${commitSha.slice(0, 7)}`;

    updateRun(project.name, commitSha, { status: "running" });

    try {
      console.log(`[Pipeline] ${label} syncing repository...`);
      await syncRepo(project, cloneUrl);

      const files = await detectChangedFiles(project, {
        before,
        after: commitSha,
        commits,
      });

      const changed = getChangedComponents(project, files);

      console.log(
        `[Pipeline] ${label} ${files.length} file(s) changed → ` +
          `components: ${changed.map((c) => c.name).join(", ") || "none"}`
      );

      updateRun(project.name, commitSha, {
        status: "synced",
        finishedAt: new Date().toISOString(),
        changedFiles: files,
        components: changed.map((c) => ({
          name: c.name,
          path: c.path,
          status: "pending", // updated by the deploy step later
        })),
      });
    } catch (error) {
      console.error(`[Pipeline] ${label} failed at ${error.stage || "unknown"}: ${error.message}`);

      updateRun(project.name, commitSha, {
        status: "failure",
        finishedAt: new Date().toISOString(),
        error: error.message,
      });
    }
  });
