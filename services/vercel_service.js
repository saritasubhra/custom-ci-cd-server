/**
 * Custom modules
 */
import { CICDError } from "../utils/CICDError.js";
import { run } from "../utils/run.js";

// A deploy includes Vercel's build, so give it plenty of time
const DEPLOY_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Deploys one component to Vercel using the Vercel CLI.
 *
 * - Runs from the repo's main folder (localPath). Your Vercel projects have
 *   a Root Directory set (client / server), so Vercel itself moves into that
 *   folder. Running from inside it would double the path.
 * - The token and IDs are passed as environment variables, not command-line
 *   arguments, so they don't show up in process lists or logs.
 * - The CLI waits for Vercel's build to finish. If the build fails, the
 *   command fails, and so does this deploy.
 *
 * @param {Object} project - Project config
 * @param {Object} component - Component config (uses component.vercel)
 * @returns {Promise<string|null>} - The deployment URL
 */
export const deployToVercel = async (project, component) => {
  const context = {
    stage: "vercel-deploy",
    project: project.name,
    component: component.name,
  };

  const token = process.env.VERCEL_TOKEN;

  if (!token) {
    throw new CICDError({
      ...context,
      stage: "env-validation",
      originalError: "VERCEL_TOKEN is not set in .env",
    });
  }

  const { orgId, projectId, target } = component.vercel;

  // --yes skips questions, --prod makes it a production deployment
  const args = ["deploy", "--yes"];
  if (target === "production") args.push("--prod");

  try {
    const output = await run("vercel", args, {
      cwd: project.localPath,
      env: {
        VERCEL_TOKEN: token,
        VERCEL_ORG_ID: orgId,
        VERCEL_PROJECT_ID: projectId,
      },
      // On Windows, `vercel` is a .cmd file and needs a shell.
      // Safe here because the arguments above are fixed, not user input.
      shell: process.platform === "win32",
      timeout: DEPLOY_TIMEOUT_MS,
      secrets: [token],
      context,
    });

    // The CLI prints the deployment URL as the last line of stdout
    const lastLine = output
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .pop();
    return /^https?:\/\//.test(lastLine || "") ? lastLine : null;
  } catch (error) {
    // Give a clear message when the CLI isn't installed
    if (/ENOENT|is not recognized|command not found/i.test(error.message)) {
      throw new CICDError({
        ...context,
        stage: "vercel-cli",
        command: error.command,
        originalError:
          "Vercel CLI not found. Install it with: npm install -g vercel",
      });
    }

    throw error;
  }
};
