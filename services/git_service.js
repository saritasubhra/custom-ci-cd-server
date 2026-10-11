/**
 * Node modules
 */
import fs from "node:fs";
import path from "node:path";

/**
 * Custom modules
 */
import { CICDError } from "../utils/CICDError.js";
import { run } from "../utils/run.js";
import { getFilesFromCommits } from "../utils/pathMatcher.js";

// GitHub sends a "before" of all zeros when a branch is newly created
const ZERO_SHA = /^0+$/;

/**
 * Syncs the local copy of the repository with GitHub.
 * - First time: clones the repo into project.localPath
 * - After that: fetches and hard-resets to origin/<branch>
 * @param {Object} project - Project config
 * @param {string} cloneUrl - Clone URL from the webhook payload
 */
export const syncRepo = async (project, cloneUrl) => {
  const { localPath, branch, repository, name } = project;
  const ctx = (stage) => ({ stage, project: name });

  // Make sure the folder exists and we can write to it
  try {
    fs.mkdirSync(localPath, { recursive: true });
    fs.accessSync(localPath, fs.constants.W_OK);
  } catch {
    throw new CICDError({
      ...ctx("workspace-permission"),
      originalError: `No write access to localPath: ${localPath}`,
    });
  }

  // First time: clone
  if (!fs.existsSync(path.join(localPath, ".git"))) {
    if (!cloneUrl) {
      throw new CICDError({
        ...ctx("git-clone"),
        originalError: "No clone URL available in the webhook payload",
      });
    }

    await run("git", ["clone", "--branch", branch, cloneUrl, "."], {
      cwd: localPath,
      context: ctx("git-clone"),
    });
    return;
  }

  // Make sure this folder really is the expected repository
  const remote = await run("git", ["config", "--get", "remote.origin.url"], {
    cwd: localPath,
    context: ctx("git-remote-check"),
  });

  if (!remote.toLowerCase().includes(repository.toLowerCase())) {
    throw new CICDError({
      ...ctx("git-remote-check"),
      originalError: `localPath contains a different repository (${remote}), expected ${repository}`,
    });
  }

  // Get the latest code and match the remote branch exactly
  await run("git", ["fetch", "origin", "--prune"], {
    cwd: localPath,
    context: ctx("git-fetch"),
  });

  await run("git", ["checkout", "-B", branch, `origin/${branch}`], {
    cwd: localPath,
    context: ctx("git-checkout"),
  });

  await run("git", ["reset", "--hard", `origin/${branch}`], {
    cwd: localPath,
    context: ctx("git-reset"),
  });

  // Remove untracked files (ignored files like node_modules are kept)
  await run("git", ["clean", "-fd"], {
    cwd: localPath,
    context: ctx("git-clean"),
  });
};

/**
 * Finds which files changed in this push.
 * Prefers `git diff before..after` (always complete).
 * Falls back to the commits in the webhook payload, which GitHub
 * limits to 20 commits, and which is all we have for a brand-new branch.
 * @param {Object} project - Project config
 * @param {Object} push - { before, after, commits }
 * @returns {Promise<string[]>} - Changed file paths
 */
export const detectChangedFiles = async (project, { before, after, commits }) => {
  if (before && after && !ZERO_SHA.test(before)) {
    try {
      const output = await run("git", ["diff", "--name-only", before, after], {
        cwd: project.localPath,
        context: { stage: "git-diff", project: project.name },
      });

      return output ? output.split("\n").map((f) => f.trim()).filter(Boolean) : [];
    } catch {
      console.warn(
        `[Git] git diff failed for ${project.name}, using webhook commits instead`
      );
    }
  }

  return getFilesFromCommits(commits);
};
