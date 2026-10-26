const TIMEOUT_MS = 10000;
const MAX_LENGTH = 4000; // Telegram's limit is 4096 characters per message

let warnedAboutConfig = false;

/**
 * Sends a plain-text message to your Telegram chat.
 *
 * Never throws. If the bot token or chat ID is missing, or Telegram can't
 * be reached, it logs a short message and returns false so the deploy
 * carries on. The bot token is never written to the logs.
 *
 * @param {string} text - The message
 * @returns {Promise<boolean>} - True if Telegram accepted the message
 */
export const sendTelegram = async (text) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    if (!warnedAboutConfig) {
      console.log("[Telegram] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not set, skipping messages");
      warnedAboutConfig = true;
    }
    return false;
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH - 1)}…` : text,
        disable_web_page_preview: true,
      }),
    });

    if (!response.ok) {
      let detail = "";
      try {
        detail = (await response.json()).description || "";
      } catch {
        // not JSON, ignore
      }
      console.error(`[Telegram] Message was rejected (HTTP ${response.status})${detail ? `: ${detail}` : ""}`);
      return false;
    }

    console.log("[Telegram] Message sent");
    return true;
  } catch (error) {
    const reason = error.name === "TimeoutError" ? "timed out" : "could not reach Telegram";
    console.error(`[Telegram] Message failed: ${reason}`);
    return false;
  }
};
