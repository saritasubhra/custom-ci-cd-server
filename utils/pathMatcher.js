/**
 * Turns a path into a clean form: forward slashes, no leading "./" or "/"
 */
const clean = (p = "") => p.replace(/\\/g, "/").replace(/^(\.\/|\/)+/, "");

/**
 * Collects changed file paths from the commits in a webhook payload.
 * Used as a fallback when `git diff` can't be used.
 * @param {Array} commits - Commits from the webhook payload
 * @returns {string[]} - Unique list of changed file paths
 */
export const getFilesFromCommits = (commits = []) => {
  const files = commits.flatMap((c) => [
    ...(c.added || []),
    ...(c.modified || []),
    ...(c.removed || []),
  ]);
  return [...new Set(files)];
};

/**
 * Checks if a component has changed.
 * A path of "" or "/" means the component is the whole repo.
 * "client/" matches "client/app.js" but NOT "client-old/app.js".
 * @param {Object} component - Component config (uses component.path)
 * @param {string[]} files - Changed file paths
 * @returns {boolean}
 */
export const componentChanged = (component, files) => {
  const base = clean(component.path);

  if (!base) return files.length > 0;

  const prefix = base.endsWith("/") ? base : `${base}/`;
  return files.some((file) => clean(file).startsWith(prefix));
};

/**
 * Returns only the components of a project that have changed files.
 * @param {Object} project - Project config
 * @param {string[]} files - Changed file paths
 * @returns {Array} - Changed components
 */
export const getChangedComponents = (project, files) => {
  return project.components.filter((c) => componentChanged(c, files));
};
