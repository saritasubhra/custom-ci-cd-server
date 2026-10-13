/**
 * Node modules
 */
import { execFile } from "node:child_process";

/**
 * Custom modules
 */
import { CICDError } from "./CICDError.js";

/**
 * Runs a program with arguments.
 * Passing arguments as an array means values like branch names or URLs
 * can never be interpreted as extra shell commands.
 *
 * @param {string} file - Program to run (e.g. "git")
 * @param {string[]} args - Arguments for the program
 * @param {Object} options
 * @param {string} [options.cwd] - Working directory
 * @param {Object} [options.env] - Extra environment variables (added on top of process.env)
 * @param {boolean} [options.shell] - Run through a shell. Needed on Windows for .cmd programs
 *                                    like `vercel`. Only use with fixed, trusted arguments.
 * @param {number} [options.timeout] - Kill the program after this many milliseconds
 * @param {string[]} [options.secrets] - Values to hide as *** in errors (e.g. tokens)
 * @param {Object} [options.context] - Error context (stage, project, component)
 * @returns {Promise<string>} - Trimmed stdout, or rejects with a CICDError
 */
export const run = (
  file,
  args = [],
  { cwd, env, shell = false, timeout, secrets = [], context = {} } = {},
) => {
  // Replaces any secret value with *** so it never ends up in logs or alerts
  const hide = (text = "") =>
    secrets.reduce(
      (out, secret) => (secret ? out.split(secret).join("***") : out),
      text,
    );

  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        cwd,
        shell,
        timeout,
        env: env ? { ...process.env, ...env } : process.env,
        maxBuffer: 10 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        if (err) {
          const reason = err.killed
            ? `Timed out after ${Math.round(timeout / 1000)}s`
            : stderr?.trim() || err.message;

          return reject(
            new CICDError({
              ...context,
              command: hide([file, ...args].join(" ")),
              originalError: hide(reason),
            }),
          );
        }

        resolve(stdout.trim());
      },
    );
  });
};
