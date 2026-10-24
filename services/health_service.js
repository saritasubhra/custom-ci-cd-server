/**
 * Runs the health check configured for a component.
 *
 * It calls a URL and checks the HTTP status. Use your PUBLIC production
 * address (for example https://my-app.vercel.app), not the long unique
 * deployment URL: Vercel often protects those with a login page, which
 * would answer 401 and look like a failure.
 *
 * @param {Object} component - Component config (uses component.healthCheck)
 * @param {Object} project - Project config
 * @returns {Promise<{healthy: boolean, skipped?: boolean, reason?: string}>}
 */
export const runHealthCheck = async (component, project) => {
  const id = `${project.name}/${component.name}`;
  const healthCheck = component.healthCheck;

  if (!healthCheck) {
    console.log(`[Health] ${id}: no health check configured, skipping`);
    return { healthy: true, skipped: true };
  }

  const {
    url,
    expectedStatus = 200,
    timeout = 10000,
    retries = 3,
    delay = 5000,
  } = healthCheck;

  console.log(`[Health] ${id}: checking ${url} (expecting HTTP ${expectedStatus})`);

  let reason = "";

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const status = await fetchStatus(url, timeout);

      if (status === expectedStatus) {
        console.log(`[Health] ✓ ${id} is healthy (HTTP ${status})`);
        return { healthy: true };
      }

      reason = `got HTTP ${status}, expected ${expectedStatus}`;
    } catch (error) {
      reason =
        error.name === "AbortError"
          ? `no answer within ${timeout}ms`
          : error.cause?.code || error.message;
    }

    console.log(`[Health] ${id}: attempt ${attempt}/${retries} failed (${reason})`);

    if (attempt < retries) await sleep(delay);
  }

  console.log(`[Health] ✗ ${id} failed the health check`);
  return { healthy: false, reason };
};

/**
 * Requests the URL and returns the HTTP status code
 */
const fetchStatus = async (url, timeout) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "Cache-Control": "no-cache" },
    });
    await response.body?.cancel();
    return response.status;
  } finally {
    clearTimeout(timer);
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
