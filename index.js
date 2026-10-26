/**
 * Node modules
 */
import "dotenv/config";
import express from "express";

/**
 * Custom modules
 */
import { verifySignature } from "./middlewares/verifySignature.js";
import { loadConfig } from "./utils/loadConfig.js";
import { runPipeline } from "./services/pipeline_service.js";
import { createRun, getRun } from "./store/runs.js";

/**
 * Configurations (validated at startup)
 */
// On Vercel, this server only shows a status page (it cannot run deployments there)
const IS_HOSTED_DEMO = Boolean(process.env.VERCEL);

let config = null;
let configError = null;

if (IS_HOSTED_DEMO) {
  configError =
    "Demo mode: deployments only run when the server is started locally";
} else {
  try {
    config = loadConfig();
  } catch (error) {
    configError = error.message;
  }
}

if (!IS_HOSTED_DEMO) {
  if (configError) {
    // Locally, a broken config should stop the server so you notice it
    console.error(`[Startup] ${configError}`);
    process.exit(1);
  }

  if (!process.env.VERCEL_TOKEN) {
    console.warn(
      "[Startup] VERCEL_TOKEN is not set in .env, deployments will fail",
    );
  }

  // Notifications are optional: the deploy works without them
  if (!process.env.GITHUB_TOKEN) {
    console.log(
      "[Startup] GITHUB_TOKEN is not set: no ✅/❌ on GitHub commits",
    );
  }
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    console.log("[Startup] Telegram is not set up: no Telegram messages");
  }
}

const app = express();
const PORT = process.env.PORT || 5001;

/**
 * Parse JSON and keep the raw body.
 * The raw body is needed to verify GitHub's signature.
 */
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

/**
 * Home page
 * A small status page so visitors see that the server is up
 */
app.get("/", (_, res) => {
  const note = IS_HOSTED_DEMO
    ? "This is a live preview. Real deployments run when the server is started on a machine with git and the Vercel CLI."
    : "Listening for GitHub push webhooks.";

  res
    .status(200)
    .json({ success: true, message: "CI/CD server is running..." });
});

/**
 * Health Check endpoint
 * Used to confirm the CI/CD server itself is running
 */
app.get("/health", (_, res) => {
  res.status(200).json({
    status: "OK",
    success: true,
    message: "CI/CD server is running",
    mode: IS_HOSTED_DEMO ? "demo" : "live",
    timestamp: new Date().toISOString(),
  });
});

/**
 * GitHub Webhook endpoint
 * Verify → match project → record a run → start the pipeline
 */
app.post(
  "/webhook/github",
  (req, res, next) => {
    if (!config) {
      return res.status(503).json({ success: false, message: configError });
    }
    next();
  },
  verifySignature,
  (req, res) => {
    const event = req.headers["x-github-event"];

    // GitHub sends a "ping" when the webhook is first created
    if (event === "ping") return res.status(200).send("pong");

    // Only push events trigger deployments
    if (event !== "push") return res.status(200).send("Ignored");

    // Reply right away; the pipeline continues in the background
    res.status(200).send("OK");

    const body = req.body || {};
    const repo = body.repository?.full_name;
    const branch = body.ref?.replace("refs/heads/", "");
    const commitSha = body.after;

    // Find the project that matches this repo and branch
    const project = config.projects.find(
      (p) => p.repository === repo && p.branch === branch,
    );

    if (!project || !commitSha) {
      console.log(
        `[Webhook] No matching project for ${repo}@${branch}, ignoring`,
      );
      return;
    }

    // A deleted branch has an all-zero "after" SHA, nothing to deploy
    if (/^0+$/.test(commitSha)) {
      console.log(`[Webhook] Branch ${branch} was deleted, ignoring`);
      return;
    }

    console.log(
      `[Webhook] Matched project '${project.name}' (${repo}@${branch}) commit ${commitSha.slice(0, 7)}`,
    );

    createRun({
      project: project.name,
      repository: repo,
      branch,
      commitSha,
      commitMessage: body.head_commit?.message,
      commitAuthor: body.head_commit?.author?.name,
    });

    runPipeline(project, {
      commitSha,
      before: body.before,
      commits: body.commits || [],
      cloneUrl: body.repository?.clone_url,
    });
  },
);

/**
 * Get Run Details endpoint
 * Returns the details of one run by project name and commit SHA
 */
app.get("/runs/:project/:sha", (req, res) => {
  const run = getRun(req.params.project, req.params.sha);

  if (!run) {
    return res.status(404).json({ success: false, message: "Run not found" });
  }

  res.status(200).json({ success: true, ...run });
});

// Locally: listen on a port. On Vercel: export the app and Vercel serves it.
if (!IS_HOSTED_DEMO) {
  app.listen(PORT, () =>
    console.log(`CI/CD Server is running on PORT ${PORT}`),
  );
}

export default app;
