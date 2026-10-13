/**
 * Custom modules
 */
import { syncRepo, detectChangedFiles } from "./git_service.js";
import { deployToVercel } from "./vercel_service.js";
import { getChangedComponents } from "../utils/pathMatcher.js";
import { updateRun, updateComponent } from "../store/runs.js";

/**
 * One queue per project. Two quick pushes to the same project would
 * otherwise run git commands in the same folder at the same time.
 */
const queues = new Map();

const enqueue = (key, task) => {
  const previous = queues.get(key) || Promise.resolve();
  const next = previous.then(task);
  queues.set(
    key,
    next.catch(() => {}),
  );
  return next;
};

/**
 * Runs the pipeline for one push. Never throws: failures are saved on the run.
 * Step 4: sync code → detect changed components → deploy each to Vercel.
 * @param {Object} project - Project config
 * @param {Object} push - { commitSha, before, commits, cloneUrl }
 */
export const runPipeline = (project, push) =>
  enqueue(project.name, async () => {
    const { commitSha, before, commits, cloneUrl } = push;
    const label = `${project.name}@${commitSha.slice(0, 7)}`;

    updateRun(project.name, commitSha, { status: "running" });

    try {
      // 1. Get the latest code
      console.log(`[Pipeline] ${label} syncing repository...`);
      await syncRepo(project, cloneUrl);

      // 2. Find what changed
      const files = await detectChangedFiles(project, {
        before,
        after: commitSha,
        commits,
      });

      const changed = getChangedComponents(project, files);

      console.log(
        `[Pipeline] ${label} ${files.length} file(s) changed → ` +
          `components: ${changed.map((c) => c.name).join(", ") || "none"}`,
      );

      updateRun(project.name, commitSha, {
        changedFiles: files,
        components: changed.map((c) => ({
          name: c.name,
          path: c.path,
          status: "pending",
          url: null,
          error: null,
        })),
      });

      if (changed.length === 0) {
        console.log(`[Pipeline] ${label} nothing to deploy`);
        updateRun(project.name, commitSha, {
          status: "skipped",
          finishedAt: new Date().toISOString(),
        });
        return;
      }

      // 3. Deploy each changed component.
      // They are separate Vercel projects, so one failing doesn't stop the others.
      let failed = 0;

      for (const component of changed) {
        const id = `${project.name}/${component.name}`;
        updateComponent(project.name, commitSha, component.name, {
          status: "deploying",
        });

        try {
          console.log(`[Deploy] ${id} deploying to Vercel...`);
          const url = await deployToVercel(project, component);

          updateComponent(project.name, commitSha, component.name, {
            status: "deployed",
            url,
          });
          console.log(`[Deploy] ✓ ${id} deployed${url ? ` → ${url}` : ""}`);
        } catch (error) {
          failed++;
          updateComponent(project.name, commitSha, component.name, {
            status: "failed",
            error: error.message,
          });
          console.error(
            `[Deploy] ✗ ${id} failed at ${error.stage || "unknown"}: ${error.message}`,
          );
        }
      }

      updateRun(project.name, commitSha, {
        status: failed > 0 ? "failure" : "success",
        finishedAt: new Date().toISOString(),
        error: failed > 0 ? `${failed} component(s) failed to deploy` : null,
      });
    } catch (error) {
      console.error(
        `[Pipeline] ${label} failed at ${error.stage || "unknown"}: ${error.message}`,
      );

      updateRun(project.name, commitSha, {
        status: "failure",
        finishedAt: new Date().toISOString(),
        error: error.message,
      });
    }
  });
