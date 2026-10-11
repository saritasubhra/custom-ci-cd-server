/**
 * Custom Error class for CI/CD operations
 * @extends Error
 * @property {string} stage - The stage of the pipeline where the error occurred
 * @property {string} project - The project associated with the error
 * @property {string} component - The component associated with the error
 * @property {string} command - The command being executed when the error occurred
 * @property {any} originalError - The original error object or message
 */
export class CICDError extends Error {
  constructor({ stage, project, component, command, originalError }) {
    super(originalError?.toString() || "CI/CD Error");

    this.stage = stage;
    this.project = project;
    this.component = component;
    this.command = command;
    this.originalError = originalError;
    this.timestamp = new Date().toISOString();
  }
}
