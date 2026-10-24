/**
 * Custom modules
 */
import { getLKG, setNeedsPromote } from "./lkg_service.js";
import { rollbackDeployment } from "./vercel_service.js";

/**
 * Puts a component's production site back to its last known good deployment.
 *
 * Never throws. The result is one of:
 *  - "rolled-back": production now serves the last known good deployment
 *  - "failed":      the rollback was tried and failed (bad version still live)
 *  - "no-lkg":      there is no earlier good deployment to go back to
 *  - "skipped":     not a production deployment, so there is nothing to roll back
 *
 * @param {Object} project - Project config
 * @param {Object} component - Component config
 * @returns {Promise<{status: string, message: string}>}
 */
export const rollbackToLKG = async (project, component) => {
  const id = `${project.name}/${component.name}`;

  if (component.vercel.target !== "production") {
    return {
      status: "skipped",
      message: "Not a production deployment, so there is nothing to roll back",
    };
  }

  const lkg = getLKG(project.name, component.name);

  if (!lkg?.deploymentUrl) {
    console.error(`[Rollback] ${id}: no last known good deployment recorded`);
    return {
      status: "no-lkg",
      message:
        "No earlier good deployment is recorded, so it could not be rolled back. Fix it manually in Vercel",
    };
  }

  try {
    console.log(`[Rollback] ${id}: rolling back to ${lkg.deploymentUrl} (commit ${lkg.sha?.slice(0, 7)})`);
    await rollbackDeployment(project, component, lkg.deploymentUrl);

    // Vercel now pauses automatic production deploys for this project.
    // The next deployment has to promote itself.
    setNeedsPromote(project.name, component.name, true);

    console.log(`[Rollback] ✓ ${id} is back on ${lkg.deploymentUrl}`);
    return {
      status: "rolled-back",
      message: `Rolled back to the last good deployment ${lkg.deploymentUrl}`,
    };
  } catch (error) {
    console.error(`[Rollback] ✗ ${id} failed: ${error.message}`);
    return {
      status: "failed",
      message: `Rollback failed (${error.message}). The bad version may still be live, fix it manually in Vercel`,
    };
  }
};
