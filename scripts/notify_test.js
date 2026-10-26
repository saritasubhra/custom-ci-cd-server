/**
 * Helper for setting up notifications. Run from the project's main folder:
 *
 *   npm run notify:test     sends a test Telegram message and checks that
 *                           your GitHub token can see your repositories
 *   npm run notify:chatid   shows which bot your token belongs to and
 *                           your Telegram chat ID
 *
 * Secrets are never printed.
 */

/**
 * Node modules
 */
import "dotenv/config";
import fs from "node:fs";

/**
 * Custom modules
 */
import { sendTelegram } from "../services/telegram_service.js";

const mode = process.argv[2];

if (mode === "chatid") await showChatIds();
else await testEverything();

/**
 * Calls a Telegram Bot API method and returns its JSON answer
 */
async function callTelegram(token, method) {
  const response = await fetch(
    `https://api.telegram.org/bot${token}/${method}`,
    {
      signal: AbortSignal.timeout(10000),
    },
  );
  return response.json();
}

/**
 * Shows which bot the token belongs to, then lists the chats that have
 * recently messaged it
 */
async function showChatIds() {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    console.log("TELEGRAM_BOT_TOKEN is not set in .env yet.");
    return;
  }

  let bot;
  let updates;
  try {
    const me = await callTelegram(token, "getMe");

    if (!me.ok) {
      console.log(`Telegram said: ${me.description || "request rejected"}`);
      console.log(
        "The token in .env is wrong, or it was revoked. Copy it again from BotFather.",
      );
      return;
    }
    bot = me.result;

    const data = await callTelegram(token, "getUpdates");

    if (!data.ok) {
      console.log(`Telegram said: ${data.description || "request rejected"}`);
      return;
    }
    updates = data.result;
  } catch {
    console.log("Could not reach Telegram.");
    return;
  }

  console.log(
    `This token belongs to the bot @${bot.username} (${bot.first_name}).\n`,
  );

  const chats = new Map();
  for (const update of updates) {
    const chat =
      update.message?.chat ||
      update.channel_post?.chat ||
      update.my_chat_member?.chat;
    if (chat) chats.set(chat.id, chat);
  }

  if (chats.size === 0) {
    console.log(`No messages found for @${bot.username}.`);
    console.log(
      `1. Open https://t.me/${bot.username} in Telegram, press Start, and send "hi".`,
    );
    console.log("2. Run this command again.");
    console.log(
      "\nAlready did that? Then you probably messaged a different bot than the one",
    );
    console.log(
      `above. Check the bot's username at the top of your chat: it must be @${bot.username}.`,
    );
    return;
  }

  console.log("Chats that have messaged this bot:\n");
  for (const chat of chats.values()) {
    const name =
      chat.title ||
      [chat.first_name, chat.last_name].filter(Boolean).join(" ") ||
      chat.username ||
      "(no name)";
    console.log(`  TELEGRAM_CHAT_ID=${chat.id}    (${chat.type}: ${name})`);
  }
  console.log(
    "\nCopy the line for your own chat into .env, then restart the server.",
  );
}

/**
 * Checks both notification channels
 */
async function testEverything() {
  console.log("Telegram");
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    console.log(
      "  ✗ TELEGRAM_BOT_TOKEN and/or TELEGRAM_CHAT_ID is missing in .env",
    );
    console.log("    (run: npm run notify:chatid  to find your chat ID)");
  } else {
    const sent = await sendTelegram(
      "✅ Test message from your CI/CD server. Telegram notifications work.",
    );
    console.log(
      sent
        ? "  ✓ Test message sent. Check Telegram."
        : "  ✗ Sending failed, see the message above.",
    );
  }

  console.log("\nGitHub");
  const token = process.env.GITHUB_TOKEN;

  if (!token) {
    console.log("  ✗ GITHUB_TOKEN is missing in .env");
    return;
  }

  let repositories = [];
  try {
    const config = JSON.parse(
      fs.readFileSync("config/cicd_config.json", "utf-8"),
    );
    repositories = [...new Set(config.projects.map((p) => p.repository))];
  } catch {
    console.log(
      "  ✗ Could not read config/cicd_config.json (run this from the project's main folder)",
    );
    return;
  }

  for (const repo of repositories) {
    try {
      const response = await fetch(`https://api.github.com/repos/${repo}`, {
        signal: AbortSignal.timeout(10000),
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "custom-cicd-server",
        },
      });

      if (response.ok)
        console.log(`  ✓ ${repo}: token can access this repository`);
      else if (response.status === 401)
        console.log(`  ✗ ${repo}: token is invalid or expired`);
      else if (response.status === 404)
        console.log(
          `  ✗ ${repo}: not found, or the token was not given access to it`,
        );
      else console.log(`  ✗ ${repo}: GitHub answered HTTP ${response.status}`);
    } catch {
      console.log(`  ✗ ${repo}: could not reach GitHub`);
    }
  }

  console.log(
    '\nNote: this checks access only. The token also needs "Commit statuses: Read and write".',
  );
}
