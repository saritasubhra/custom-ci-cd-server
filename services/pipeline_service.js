/**
 * Custom modules
 */
import { syncRepo, detectChangedFiles } from "./git_service.js";
import { deployComponent } from "./deploy_service.js";
import {
  notifyPipelineStarted,
  notifyPipelineFinished,
} from "./notification_service.js";
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
 * Step 6: tell GitHub "pending" → sync code → detect changed components →
 * deploy each → health check → roll back if unhealthy → tell GitHub and
 * Telegram how it went.
 * @param {Object} project - Project config
 * @param {Object} push - { commitSha, before, commits, cloneUrl }
 */
export const runPipeline = (project, push) => {
  // Mark the commit "pending" straight away, even if the push has to wait in the queue
  const pendingStatus = notifyPipelineStarted(project, push.commitSha);

  return enqueue(project.name, async () => {
    // Make sure "pending" has reached GitHub before the final status is sent
    await pendingStatus;

    try {
      await execute(project, push);
    } catch (error) {
      const label = `${project.name}@${push.commitSha.slice(0, 7)}`;
      console.error(
        `[Pipeline] ${label} failed at ${error.stage || "unknown"}: ${error.message}`,
      );

      updateRun(project.name, push.commitSha, {
        status: "failure",
        finishedAt: new Date().toISOString(),
        error: error.message,
      });
    }

    await notifyPipelineFinished(project, push.commitSha);
  });
};

/**
 * The actual work. Throws if something goes wrong before deploying starts.
 */
const execute = async (project, push) => {
  const { commitSha, before, commits, cloneUrl } = push;
  const label = `${project.name}@${commitSha.slice(0, 7)}`;

  updateRun(project.name, commitSha, { status: "running" });

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
  let problems = 0;

  for (const component of changed) {
    const id = `${project.name}/${component.name}`;
    updateComponent(project.name, commitSha, component.name, {
      status: "deploying",
    });

    console.log(`[Deploy] ${id} deploying to Vercel...`);
    const result = await deployComponent(project, component, commitSha);

    updateComponent(project.name, commitSha, component.name, {
      status: result.status,
      url: result.url || null,
      error: result.status === "deployed" ? null : result.message,
    });

    if (result.status === "deployed") {
      console.log(
        `[Deploy] ✓ ${id} deployed${result.url ? ` → ${result.url}` : ""}`,
      );
    } else {
      problems++;
      console.error(`[Deploy] ✗ ${id} ${result.status}: ${result.message}`);
    }
  }

  updateRun(project.name, commitSha, {
    status: problems > 0 ? "failure" : "success",
    finishedAt: new Date().toISOString(),
    error:
      problems > 0 ? `${problems} component(s) did not deploy cleanly` : null,
  });
};
