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

/**
 * Configurations (validated at startup)
 */
const config = loadConfig();

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
 * Health Check endpoint
 * Used to confirm the CI/CD server itself is running
 */
app.get("/health", (_, res) => {
  res.status(200).json({
    status: "OK",
    success: true,
    message: "Server is healthy",
    timestamp: new Date().toISOString(),
  });
});

/**
 * GitHub Webhook endpoint
 * Step 2: verify, match the project, and log. Deployment comes in later steps.
 */
app.post("/webhook/github", verifySignature, (req, res) => {
  const event = req.headers["x-github-event"];

  // GitHub sends a "ping" when the webhook is first created
  if (event === "ping") return res.status(200).send("pong");

  // Only push events trigger deployments
  if (event !== "push") return res.status(200).send("Ignored");

  // Reply right away; the real work happens after this
  res.status(200).send("OK");

  const body = req.body || {};
  const repo = body.repository?.full_name;
  const branch = body.ref?.replace("refs/heads/", "");
  const commitSha = body.after;
  const commits = body.commits || [];

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

  console.log(
    `[Webhook] Matched project '${project.name}' ` +
      `(${repo}@${branch}) commit ${commitSha.slice(0, 7)} ` +
      `with ${commits.length} commit(s)`,
  );
});

app.listen(PORT, () => console.log(`CI/CD Server is running on PORT ${PORT}`));
