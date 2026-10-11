/**
 * Node modules
 */
import { execFile } from "node:child_process";

/**
 * Custom modules
 */
import { CICDError } from "./CICDError.js";

/**
 * Runs a program with arguments (no shell involved).
 * Passing arguments as an array means values like branch names or URLs
 * can never be interpreted as extra shell commands.
 *
 * @param {string} file - Program to run (e.g. "git")
 * @param {string[]} args - Arguments for the program
 * @param {Object} options
 * @param {string} [options.cwd] - Working directory
 * @param {Object} [options.context] - Error context (stage, project, component)
 * @returns {Promise<string>} - Trimmed stdout, or rejects with a CICDError
 */
export const run = (file, args = [], { cwd, context = {} } = {}) => {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { cwd, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          return reject(
            new CICDError({
              ...context,
              command: [file, ...args].join(" "),
              originalError: stderr?.trim() || err.message,
            })
          );
        }

        resolve(stdout.trim());
      }
    );
  });
};
