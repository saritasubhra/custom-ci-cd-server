/**
 * Custom modules
 */
import { deployToVercel, promoteDeployment } from "./vercel_service.js";
import { runHealthCheck } from "./health_service.js";
import { getLKG, saveLKG, setNeedsPromote } from "./lkg_service.js";
import { rollbackToLKG } from "./rollback_service.js";

// If Vercel says the deployment is already live, promoting it again is fine
const ALREADY_LIVE = /already (the )?(current|promoted|live|production)|is (already )?current/i;

/**
 * Deploys one component and checks that it works.
 *
 *  1. Deploy to Vercel. If Vercel's build fails, production was never
 *     touched, so there is nothing to roll back.
 *  2. If an earlier rollback paused automatic deploys, promote this one.
 *  3. Run the health check.
 *  4. Healthy   → remember it as the last known good.
 *     Unhealthy → roll production back to the last known good.
 *
 * Never throws. Returns { status, url, message } where status is:
 *  - "deployed":        live and healthy
 *  - "failed":          the deploy itself failed; production is unchanged
 *  - "rolled-back":     unhealthy, production restored to the last good version
 *  - "unhealthy":       unhealthy and there was nothing to roll back to (bad version live!)
 *  - "rollback-failed": unhealthy and the rollback failed (bad version live!)
 *
 * @param {Object} project - Project config
 * @param {Object} component - Component config
 * @param {string} commitSha - The commit being deployed
 */
export const deployComponent = async (project, component, commitSha) => {
  const id = `${project.name}/${component.name}`;
  const isProduction = component.vercel.target === "production";

  // 1. Deploy
  let url;
  try {
    url = await deployToVercel(project, component);
  } catch (error) {
    return { status: "failed", url: null, message: error.message, stage: error.stage };
  }

  // 2. Promote if an earlier rollback paused automatic production deploys
  if (isProduction && getLKG(project.name, component.name)?.needsPromote) {
    try {
      console.log(`[Deploy] ${id}: promoting the new deployment (an earlier rollback paused auto-deploys)`);
      await promoteDeployment(project, component, url);
      setNeedsPromote(project.name, component.name, false);
    } catch (error) {
      if (ALREADY_LIVE.test(error.message)) {
        setNeedsPromote(project.name, component.name, false);
      } else {
        return {
          status: "failed",
          url,
          stage: error.stage,
          message: `Deployed, but could not make it live: ${error.message}`,
        };
      }
    }
  }

  // 3. Health check
  const health = await runHealthCheck(component, project);

  // 4a. Healthy
  if (health.healthy) {
    if (isProduction) saveLKG(project.name, component.name, { sha: commitSha, deploymentUrl: url });
    return { status: "deployed", url };
  }

  // 4b. Unhealthy: roll back
  console.error(`[Deploy] ✗ ${id} failed its health check (${health.reason}), rolling back`);
  const rollback = await rollbackToLKG(project, component);
  const base = `Health check failed (${health.reason}). ${rollback.message}`;

  if (rollback.status === "rolled-back") return { status: "rolled-back", url, message: base };
  if (rollback.status === "failed") return { status: "rollback-failed", url, message: base };
  return { status: "unhealthy", url, message: base };
};
