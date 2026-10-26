/**
 * Custom modules
 */
import { setCommitStatus } from "./github_status_service.js";
import { sendTelegram } from "./telegram_service.js";
import { getRun } from "../store/runs.js";

const ICONS = {
  deployed: "✅",
  "rolled-back": "🔄",
  failed: "❌",
  unhealthy: "🚨",
  "rollback-failed": "🚨",
};

const LABELS = {
  deployed: "deployed",
  "rolled-back": "rolled back to the last good version",
  failed: "deploy failed",
  unhealthy: "unhealthy, nothing to roll back to",
  "rollback-failed": "rollback failed",
};

/**
 * Link to this run's details, or undefined if SERVER_URL isn't set
 */
const runLink = (project, sha) => {
  const base = process.env.SERVER_URL?.replace(/\/+$/, "");
  return base ? `${base}/runs/${encodeURIComponent(project.name)}/${sha}` : undefined;
};

/**
 * Marks the commit as "pending" on GitHub.
 * Start this as soon as the push arrives so GitHub shows progress while
 * the deploy waits in the queue. Never throws.
 */
export const notifyPipelineStarted = (project, sha) =>
  setCommitStatus({
    repo: project.repository,
    sha,
    state: "pending",
    description: "Deployment in progress",
    targetUrl: runLink(project, sha),
  });

/**
 * Reports the final result: the GitHub commit status, and a Telegram
 * message (unless nothing needed deploying). Never throws.
 */
export const notifyPipelineFinished = async (project, sha) => {
  try {
    const run = getRun(project.name, sha);
    if (!run) return;

    const targetUrl = runLink(project, sha);
    const { state, description } = githubSummary(run);

    await setCommitStatus({
      repo: project.repository,
      sha,
      state,
      description,
      targetUrl,
    });

    // A push that changed nothing deployable isn't worth a message
    if (run.status !== "skipped") {
      await sendTelegram(telegramReport(run, targetUrl));
    }
  } catch (error) {
    console.error(`[Notify] Could not send notifications: ${error.message}`);
  }
};

/**
 * The state and short text shown next to the commit on GitHub
 */
const githubSummary = (run) => {
  const components = run.components || [];

  if (run.status === "skipped") {
    return { state: "success", description: "No deployable changes in this push" };
  }

  if (run.status === "success") {
    return {
      state: "success",
      description: `Deployed ${components.map((c) => c.name).join(", ")}`,
    };
  }

  // Pipeline failed before any component was deployed (e.g. git problems)
  if (components.length === 0) {
    return { state: "failure", description: `Pipeline failed: ${run.error || "unknown error"}` };
  }

  return {
    state: "failure",
    description: components.map((c) => `${c.name}: ${c.status}`).join(", "),
  };
};

/**
 * The Telegram message (plain text)
 */
const telegramReport = (run, targetUrl) => {
  const components = run.components || [];

  const mustFixNow = components.some(
    (c) => c.status === "unhealthy" || c.status === "rollback-failed"
  );

  let header;
  if (run.status === "success") header = "✅ Deployment successful";
  else if (components.length === 0) header = "❌ Pipeline failed";
  else if (mustFixNow) header = "🚨 Deployment failed, a bad version may be live";
  else if (components.some((c) => c.status === "rolled-back")) header = "🔄 Deployment rolled back";
  else header = "❌ Deployment failed";

  const lines = [
    header,
    "",
    `Project: ${run.project}`,
    `Branch: ${run.branch}`,
    `Commit: ${run.commitSha.slice(0, 7)} ${firstLine(run.commitMessage)}`.trim(),
  ];

  if (run.commitAuthor) lines.push(`Author: ${run.commitAuthor}`);

  if (components.length > 0) {
    lines.push("");
    for (const c of components) {
      lines.push(`${ICONS[c.status] || "•"} ${c.name}: ${LABELS[c.status] || c.status}`);
      if (c.url) lines.push(`   ${c.url}`);
      if (c.error) lines.push(`   ${c.error}`);
    }
  } else if (run.error) {
    lines.push("", `Error: ${run.error}`);
  }

  if (targetUrl) lines.push("", `Details: ${targetUrl}`);
  lines.push("", `Time: ${new Date().toISOString()}`);

  return lines.join("\n");
};

const firstLine = (text) => (text || "").split("\n")[0].slice(0, 100);
