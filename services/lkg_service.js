/**
 * LKG (Last Known Good) store.
 * Remembers, per project and component, the last production deployment
 * that passed its health check. This is what we roll back to.
 *
 * Saved in store/lkg.json so it survives server restarts:
 * {
 *   "Noted": {
 *     "Client": {
 *       "sha": "abc123...",
 *       "deploymentUrl": "https://noted-xxxx.vercel.app",
 *       "deployedAt": "2026-10-15T...",
 *       "needsPromote": false
 *     }
 *   }
 * }
 */

/**
 * Node modules
 */
import fs from "node:fs";
import path from "node:path";

const LKG_FILE = path.join(process.cwd(), "store", "lkg.json");

const readStore = () => {
  try {
    return JSON.parse(fs.readFileSync(LKG_FILE, "utf-8"));
  } catch {
    return {};
  }
};

// Write to a temp file first, then swap it in, so a crash can't corrupt the store
const writeStore = (data) => {
  fs.mkdirSync(path.dirname(LKG_FILE), { recursive: true });
  const temp = `${LKG_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2));
  fs.renameSync(temp, LKG_FILE);
};

/**
 * Gets the last known good deployment, or null if there is none
 */
export const getLKG = (projectName, componentName) =>
  readStore()[projectName]?.[componentName] || null;

/**
 * Saves a healthy production deployment as the new last known good
 */
export const saveLKG = (projectName, componentName, { sha, deploymentUrl }) => {
  const store = readStore();
  store[projectName] = store[projectName] || {};

  const previous = store[projectName][componentName];

  store[projectName][componentName] = {
    sha,
    deploymentUrl: deploymentUrl || null,
    deployedAt: new Date().toISOString(),
    // Keep the flag: it is only cleared once a new deployment is promoted
    needsPromote: previous?.needsPromote || false,
  };

  writeStore(store);
  console.log(`[LKG] Saved ${projectName}/${componentName} → ${sha.slice(0, 7)}`);
};

/**
 * After a rollback, Vercel stops making new deployments live by themselves.
 * This flag tells the next deploy to promote itself.
 */
export const setNeedsPromote = (projectName, componentName, value) => {
  const store = readStore();
  const entry = store[projectName]?.[componentName];
  if (!entry) return;

  entry.needsPromote = value;
  writeStore(store);
};
