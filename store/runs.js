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
export const createRun = ({
  project,
  repository,
  branch,
  commitSha,
  commitMessage,
  commitAuthor,
}) => {
  const run = {
    project,
    repository,
    branch,
    commitSha,
    commitMessage: commitMessage || null,
    commitAuthor: commitAuthor || null,
    // pending → running → success | failure | skipped (nothing changed)
    status: "pending",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    changedFiles: [],
    // Each: { name, path, status: pending|deploying|deployed|failed, url, error }
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
 * Updates fields on one component inside a run
 */
export const updateComponent = (project, sha, componentName, patch) => {
  const component = runs
    .get(keyOf(project, sha))
    ?.components.find((c) => c.name === componentName);

  if (component) Object.assign(component, patch);
  return component;
};

/**
 * Gets a run, or undefined if it doesn't exist
 */
export const getRun = (project, sha) => runs.get(keyOf(project, sha));
