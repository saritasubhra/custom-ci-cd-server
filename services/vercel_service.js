/**
 * Custom modules
 */
import { CICDError } from "../utils/CICDError.js";
import { run } from "../utils/run.js";

// A deploy includes Vercel's build, so give it plenty of time
const DEPLOY_TIMEOUT_MS = 15 * 60 * 1000;
const SWITCH_TIMEOUT_MS = 5 * 60 * 1000;

// A plain web address: no spaces, quotes or shell characters.
// URLs are checked against this before being passed to the CLI.
const SAFE_URL = /^https?:\/\/[A-Za-z0-9._-]+(:\d+)?\/?$/;

/**
 * Runs the Vercel CLI for one component.
 *
 * - Runs from the repo's main folder (localPath). Your Vercel projects have
 *   a Root Directory set (client / server), so Vercel itself moves into that
 *   folder. Running from inside it would double the path.
 * - The token and IDs are passed as environment variables, not command-line
 *   arguments, so they don't show up in process lists or logs.
 */
const runVercel = async (project, component, args, { stage, timeout }) => {
  const context = { stage, project: project.name, component: component.name };

  const token = process.env.VERCEL_TOKEN;

  if (!token) {
    throw new CICDError({
      ...context,
      stage: "env-validation",
      originalError: "VERCEL_TOKEN is not set in .env",
    });
  }

  const { orgId, projectId } = component.vercel;

  try {
    return await run("vercel", args, {
      cwd: project.localPath,
      env: {
        VERCEL_TOKEN: token,
        VERCEL_ORG_ID: orgId,
        VERCEL_PROJECT_ID: projectId,
      },
      // On Windows, `vercel` is a .cmd file and needs a shell.
      // Safe here because every argument is fixed or checked against SAFE_URL.
      shell: process.platform === "win32",
      timeout,
      secrets: [token],
      context,
    });
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

/**
 * Makes sure a URL is safe to hand to the CLI
 */
const requireSafeUrl = (project, component, url, stage) => {
  if (!url || !SAFE_URL.test(url)) {
    throw new CICDError({
      stage,
      project: project.name,
      component: component.name,
      originalError: `No valid deployment URL available (got: ${url || "nothing"})`,
    });
  }
};

/**
 * Deploys one component to Vercel.
 * The CLI waits for Vercel's build to finish. If the build fails, the
 * command fails, and so does this deploy.
 * @returns {Promise<string|null>} - The deployment URL
 */
export const deployToVercel = async (project, component) => {
  // --yes skips questions, --prod makes it a production deployment
  const args = ["deploy", "--yes"];
  if (component.vercel.target === "production") args.push("--prod");

  const output = await runVercel(project, component, args, {
    stage: "vercel-deploy",
    timeout: DEPLOY_TIMEOUT_MS,
  });

  // The CLI prints the deployment URL as the last line of stdout
  const lastLine = output
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .pop();
  return SAFE_URL.test(lastLine || "") ? lastLine : null;
};

/**
 * Makes a deployment the live production version (no rebuild).
 * Also switches Vercel's automatic production deploys back on.
 */
export const promoteDeployment = async (project, component, url) => {
  requireSafeUrl(project, component, url, "vercel-promote");

  await runVercel(project, component, ["promote", url, "--yes"], {
    stage: "vercel-promote",
    timeout: SWITCH_TIMEOUT_MS,
  });
};

/**
 * Switches production back to an earlier deployment that was live before
 * (instant, no rebuild).
 */
export const rollbackDeployment = async (project, component, url) => {
  requireSafeUrl(project, component, url, "vercel-rollback");

  await runVercel(project, component, ["rollback", url], {
    stage: "vercel-rollback",
    timeout: SWITCH_TIMEOUT_MS,
  });
};
