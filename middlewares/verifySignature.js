/**
 * Node modules
 */
import crypto from "crypto";

/**
 * Middleware to verify the GitHub webhook signature.
 * GitHub signs the RAW request body, so we hash req.rawBody
 * (captured in index.js) and not the parsed JSON.
 */
export const verifySignature = (req, res, next) => {
  const secret = process.env.GITHUB_SECRET;

  if (!secret) {
    console.error("[Webhook] GITHUB_SECRET is not set");
    return res.status(500).send("Server misconfigured");
  }

  const originalSignature = req.headers["x-hub-signature-256"];
  if (!originalSignature || !req.rawBody) {
    return res.status(401).send("Invalid signature");
  }

  const generatedSignature =
    "sha256=" +
    crypto.createHmac("sha256", secret).update(req.rawBody).digest("hex");

  const buf1 = Buffer.from(generatedSignature);
  const buf2 = Buffer.from(originalSignature);

  // timingSafeEqual requires equal lengths
  if (buf1.length !== buf2.length || !crypto.timingSafeEqual(buf1, buf2)) {
    return res.status(401).send("Invalid signature");
  }

  next();
};
