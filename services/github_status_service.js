const TIMEOUT_MS = 10000;
const MAX_DESCRIPTION = 140; // GitHub's limit for a status description

let warnedAboutToken = false;

/**
 * Sets the ✅ / ❌ / 🟡 status shown next to a commit on GitHub.
 *
 * Never throws. If GITHUB_TOKEN is missing or GitHub can't be reached,
 * it logs a short message and returns false so the deploy carries on.
 *
 * @param {Object} params
 * @param {string} params.repo - "owner/repo"
 * @param {string} params.sha - Commit SHA
 * @param {"pending"|"success"|"failure"|"error"} params.state
 * @param {string} params.description - Short text (cut to 140 characters)
 * @param {string} [params.targetUrl] - Link GitHub shows next to the status
 * @param {string} [params.context] - Name of the check shown on GitHub
 * @returns {Promise<boolean>} - True if GitHub accepted the status
 */
export const setCommitStatus = async ({
  repo,
  sha,
  state,
  description,
  targetUrl,
  context = "Custom CI/CD Server",
}) => {
  const token = process.env.GITHUB_TOKEN;

  if (!token) {
    if (!warnedAboutToken) {
      console.log("[GitHub] GITHUB_TOKEN is not set, skipping commit status updates");
      warnedAboutToken = true;
    }
    return false;
  }

  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/statuses/${sha}`, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "custom-cicd-server",
      },
      body: JSON.stringify({
        state,
        description: truncate(description, MAX_DESCRIPTION),
        target_url: targetUrl, // left out automatically when undefined
        context,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(
        `[GitHub] Status "${state}" was rejected (HTTP ${response.status}): ${text.slice(0, 200)}`
      );
      return false;
    }

    console.log(`[GitHub] Commit ${sha.slice(0, 7)} marked "${state}"`);
    return true;
  } catch (error) {
    const reason = error.name === "TimeoutError" ? "timed out" : "could not reach GitHub";
    console.error(`[GitHub] Status "${state}" failed: ${reason}`);
    return false;
  }
};

const truncate = (text = "", max) =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;
