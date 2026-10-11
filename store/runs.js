/**
 * In-memory store for pipeline runs.
 * Keyed by "<project>/<commitSha>" so the same commit on two projects
 * never overwrites each other. Runs are lost when the server restarts.
 */
const runs = new Map();

// Keep memory bounded: drop the oldest runs beyond this many
const MAX_RUNS = 200;

const keyOf = (project, sha) => `${project}/${sha}`;

/**
 * Creates a new run in "pending" state
 */
export const createRun = ({ project, repository, branch, commitSha, commitMessage, commitAuthor }) => {
  const run = {
    project,
    repository,
    branch,
    commitSha,
    commitMessage: commitMessage || null,
    commitAuthor: commitAuthor || null,
    status: "pending", // pending → running → synced | failure
    startedAt: new Date().toISOString(),
    finishedAt: null,
    changedFiles: [],
    components: [],
    error: null,
  };

  runs.set(keyOf(project, commitSha), run);

  if (runs.size > MAX_RUNS) {
    runs.delete(runs.keys().next().value);
  }

  return run;
};

/**
 * Updates fields on an existing run
 */
export const updateRun = (project, sha, patch) => {
  const run = runs.get(keyOf(project, sha));
  if (run) Object.assign(run, patch);
  return run;
};

/**
 * Gets a run, or undefined if it doesn't exist
 */
export const getRun = (project, sha) => runs.get(keyOf(project, sha));
