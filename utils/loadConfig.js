/**
 * Node modules
 */
import fs from "node:fs";
import path from "node:path";

const CONFIG_PATH = path.join(process.cwd(), "config", "cicd_config.json");

/**
 * Fields every project must have
 */
const REQUIRED_FIELDS = ["name", "repository", "branch", "localPath"];

/**
 * Resolves a Vercel ID. Prefers the env var named in `<field>Env`
 * (e.g. orgIdEnv: "VERCEL_ORG_ID"), and falls back to a literal value.
 * @param {Object} vercel - The component's vercel block
 * @param {string} field - "orgId" or "projectId"
 * @param {string} label - Component label for error messages
 * @returns {string} - The resolved ID
 */
const resolveId = (vercel, field, label) => {
  const envName = vercel[`${field}Env`];

  if (envName) {
    const value = process.env[envName];
    if (!value) {
      throw new Error(
        `Component '${label}': env variable ${envName} (for vercel.${field}) is not set in .env`,
      );
    }
    return value;
  }

  if (vercel[field]) return vercel[field];

  throw new Error(
    `Component '${label}' needs vercel.${field}Env (env var name) or vercel.${field}`,
  );
};

/**
 * Loads and validates the CI/CD config file.
 * Throws a clear error at startup if something is wrong.
 * @returns {{ projects: Array }} - The validated config
 */
export const loadConfig = () => {
  let config;

  try {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
  } catch (err) {
    throw new Error(`Could not read config at ${CONFIG_PATH}: ${err.message}`);
  }

  if (!Array.isArray(config.projects) || config.projects.length === 0) {
    throw new Error("Config must contain a non-empty 'projects' array");
  }

  const names = new Set();

  for (const project of config.projects) {
    for (const field of REQUIRED_FIELDS) {
      if (!project[field]) {
        throw new Error(
          `Project '${project.name || "(unnamed)"}' is missing required field: ${field}`,
        );
      }
    }

    if (names.has(project.name)) {
      throw new Error(`Duplicate project name: ${project.name}`);
    }
    names.add(project.name);

    if (!Array.isArray(project.components) || project.components.length === 0) {
      throw new Error(
        `Project '${project.name}' needs a non-empty 'components' array`,
      );
    }

    for (const component of project.components) {
      const label = `${project.name}/${component.name || "(unnamed)"}`;

      // path may be "" (the whole repo), but it must be present as a string
      if (!component.name || typeof component.path !== "string") {
        throw new Error(
          `Component '${label}' needs 'name' and 'path' (use "" for the repo root)`,
        );
      }
      if (!component.vercel) {
        throw new Error(`Component '${label}' needs a 'vercel' block`);
      }

      // target is "production" (default) or "preview"
      component.vercel.target = component.vercel.target || "production";
      if (!["production", "preview"].includes(component.vercel.target)) {
        throw new Error(
          `Component '${label}': vercel.target must be "production" or "preview"`,
        );
      }

      // Optional health check: { url, expectedStatus, timeout, retries, delay }
      if (component.healthCheck !== undefined) {
        const hc = component.healthCheck;
        let validUrl = false;

        try {
          validUrl = ["http:", "https:"].includes(new URL(hc.url).protocol);
        } catch {
          validUrl = false;
        }

        if (!validUrl) {
          throw new Error(
            `Component '${label}': healthCheck.url must be a full http(s) address`,
          );
        }

        for (const field of ["expectedStatus", "timeout", "retries", "delay"]) {
          if (
            hc[field] !== undefined &&
            (!Number.isInteger(hc[field]) || hc[field] < 0)
          ) {
            throw new Error(
              `Component '${label}': healthCheck.${field} must be a whole number`,
            );
          }
        }

        if (hc.retries !== undefined && hc.retries < 1) {
          throw new Error(
            `Component '${label}': healthCheck.retries must be at least 1`,
          );
        }
      }

      // Resolve IDs: read from the env var named in orgIdEnv / projectIdEnv
      component.vercel.orgId = resolveId(component.vercel, "orgId", label);
      component.vercel.projectId = resolveId(
        component.vercel,
        "projectId",
        label,
      );
    }
  }

  return config;
};
