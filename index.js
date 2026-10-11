/**
 * Node modules
 */
import "dotenv/config";
import express from "express";

const app = express();
const PORT = process.env.PORT || 5001;

app.use(express.json());

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

app.listen(PORT, () => console.log(`CI/CD Server is running on PORT ${PORT}`));
